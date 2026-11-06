import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-11-05T12:00:00Z");
const mocks = vi.hoisted(() => ({
  listSites: vi.fn(),
  listAlertState: vi.fn(),
  saveAlertState: vi.fn(),
  notifyOwner: vi.fn(),
  listScanCandidates: vi.fn(),
  getPreviousMonitors: vi.fn(),
  saveScan: vi.fn(),
  writeAudit: vi.fn(),
  scanUrl: vi.fn(),
  buildMonitorRow: vi.fn(),
  listVisualChecks: vi.fn(),
  getVisualPrevious: vi.fn(),
  saveVisualCheck: vi.fn(),
  downloadScreenshot: vi.fn(),
  uploadScreenshot: vi.fn(),
  runPagespeed: vi.fn(),
  screenshotDiff: vi.fn(),
}));

vi.mock("@/platform/audit/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/platform/db/server", () => ({ createAdminClient: () => ({}), createUserClient: async () => ({}) }));
vi.mock("./repo", () => ({
  listSites: mocks.listSites,
  listAlertState: mocks.listAlertState,
  saveAlertState: mocks.saveAlertState,
  listOpenIssues: vi.fn(),
  listScanCandidates: mocks.listScanCandidates,
  getPreviousMonitors: mocks.getPreviousMonitors,
  saveScan: mocks.saveScan,
  listVisualChecks: mocks.listVisualChecks,
  getVisualPrevious: mocks.getVisualPrevious,
  saveVisualCheck: mocks.saveVisualCheck,
  downloadScreenshot: mocks.downloadScreenshot,
  uploadScreenshot: mocks.uploadScreenshot,
}));
vi.mock("./visual-checks", () => ({ runPagespeed: mocks.runPagespeed, screenshotDiff: mocks.screenshotDiff }));
vi.mock("./checks", () => ({ scanUrl: mocks.scanUrl }));
vi.mock("./scan-rules", () => ({
  withScheme: (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`),
  buildMonitorRow: mocks.buildMonitorRow,
  unreachable: (message: string) => ({ status: "down", responseTimeMs: null, httpStatus: null, securityScore: 0, securityIssues: ["Site unreachable or SSL certificate invalid"], error: message }),
}));
vi.mock("@/domains/notifications/service", () => ({ notifyOwner: mocks.notifyOwner }));
vi.mock("@/domains/admin/service", () => ({ getCalendar: vi.fn() }));

import { buildScanTargets, checkSpeedNow, isScannable, pickScanUrl, runMonitorAlerts, runSiteChecks, runVisualChecks, scanNow, VISUAL_MIN_TIME_MS, SCAN_START_BUDGET_MS, SCAN_CONCURRENCY, SITE_SCAN_CAP_MS } from "./service";
import { PermissionError, RateLimitError, RuleError, ValidationError } from "@/platform/errors";

const downSite = {
  id: "s1", clientId: "c1", clientName: "Acme", url: "https://acme.com", status: "down" as const, responseTimeMs: null, httpStatus: 503,
  securityScore: null, brokenLinks: null, sslExpiresAt: null, domainExpiresAt: null, lastCheckedAt: new Date(NOW.getTime() - 60_000).toISOString(), lastError: null, alertsMuted: false,
};
const system = { type: "system", name: "monitor_alerts" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listSites.mockResolvedValue([downSite]);
  mocks.listAlertState.mockResolvedValue([{ key: "site:s1:status", state: "up" }]);
});

describe("runMonitorAlerts", () => {
  it("sends the alert and remembers it when delivered", async () => {
    mocks.notifyOwner.mockResolvedValue({ sent: 1, failed: 0, removed: 0, skipped: null });
    const r = await runMonitorAlerts(system, NOW);
    expect(r).toEqual({ sites: 1, planned: 1, sent: 1, held: 0 });
    expect(mocks.notifyOwner).toHaveBeenCalledWith(system, expect.objectContaining({ title: "Site down: Acme" }));
    expect(mocks.saveAlertState).toHaveBeenCalledWith({}, "site:s1:status", "down", NOW);
  });
  it("does not remember the alert when delivery failed, so the next run retries", async () => {
    mocks.notifyOwner.mockResolvedValue({ sent: 0, failed: 1, removed: 0, skipped: null });
    const r = await runMonitorAlerts(system, NOW);
    expect(r).toEqual({ sites: 1, planned: 1, sent: 0, held: 1 });
    expect(mocks.saveAlertState).not.toHaveBeenCalled();
  });
  it("remembers the alert without sending when no phone is registered, so old news is not replayed later", async () => {
    mocks.notifyOwner.mockResolvedValue({ sent: 0, failed: 0, removed: 0, skipped: "no_devices" });
    const r = await runMonitorAlerts(system, NOW);
    expect(r).toEqual({ sites: 1, planned: 1, sent: 0, held: 0 });
    expect(mocks.saveAlertState).toHaveBeenCalledWith({}, "site:s1:status", "down", null);
  });
  it("sends nothing when nothing changed", async () => {
    mocks.listAlertState.mockResolvedValue([{ key: "site:s1:status", state: "down" }]);
    const r = await runMonitorAlerts(system, NOW);
    expect(r.planned).toBe(0);
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
  });
});

// --- site scan job -------------------------------------------------------------

const candidate = (over: Partial<Parameters<typeof buildScanTargets>[0][number]> = {}) => ({
  clientId: "c1",
  clientName: "Acme Bakery",
  archivedAt: null,
  monitoringPausedAt: null,
  projectUrl: "acmebakery.com",
  websiteUrls: [],
  ...over,
});

describe("isScannable", () => {
  it("scans normal clients, not archived ones and not ones with monitoring stopped", () => {
    expect(isScannable({ archivedAt: null, monitoringPausedAt: null })).toBe(true);
    expect(isScannable({ archivedAt: "2026-01-01T00:00:00Z", monitoringPausedAt: null })).toBe(false);
    expect(isScannable({ archivedAt: null, monitoringPausedAt: "2026-01-01T00:00:00Z" })).toBe(false);
  });
});

describe("pickScanUrl", () => {
  it("prefers the project's production URL, then the oldest website, and adds https:// when missing", () => {
    expect(pickScanUrl("acme.com", ["https://other.com"])).toBe("https://acme.com");
    expect(pickScanUrl(null, ["http://first.com", "https://second.com"])).toBe("http://first.com");
    expect(pickScanUrl("  ", ["", "  second.com  "])).toBe("https://second.com");
  });
  it("is null when there is no URL at all", () => {
    expect(pickScanUrl(null, [])).toBeNull();
    expect(pickScanUrl("   ", [""])).toBeNull();
  });
});

describe("buildScanTargets", () => {
  it("leaves out archived, paused and URL-less clients, and keeps clients on hold (they are not in the rows at all)", () => {
    const targets = buildScanTargets([
      candidate(),
      candidate({ clientId: "c2", clientName: "Archived Co", archivedAt: "2026-01-01T00:00:00Z" }),
      candidate({ clientId: "c3", clientName: "Paused Co", monitoringPausedAt: "2026-01-01T00:00:00Z" }),
      candidate({ clientId: "c4", clientName: "No Site Co", projectUrl: null }),
      candidate({ clientId: "c5", clientName: "Site List Co", projectUrl: null, websiteUrls: ["listco.com"] }),
    ]);
    expect(targets).toEqual([
      { clientId: "c1", clientName: "Acme Bakery", url: "https://acmebakery.com" },
      { clientId: "c5", clientName: "Site List Co", url: "https://listco.com" },
    ]);
  });
});

describe("runSiteChecks", () => {
  const upScan = { status: "up", responseTimeMs: 200, httpStatus: 200, securityScore: 8, securityIssues: [], error: null, sslExpiresAt: null, domainExpiresAt: null, brokenLinks: 0 };
  const downScan = { ...upScan, status: "down", httpStatus: 500, securityScore: 0 };

  beforeEach(() => {
    mocks.listScanCandidates.mockResolvedValue([candidate(), candidate({ clientId: "c2", clientName: "Beta Co", projectUrl: "beta.com" })]);
    mocks.getPreviousMonitors.mockResolvedValue(new Map([["c1", { status: "up", sslExpiresAt: "2027-01-01T00:00:00Z", domainExpiresAt: null }]]));
    mocks.scanUrl.mockResolvedValue(upScan);
    mocks.buildMonitorRow.mockImplementation((target: { clientId: string }) => ({ monitor: { client_id: target.clientId }, check: { client_id: target.clientId } }));
    mocks.saveScan.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("scans every scannable client and saves the latest result and a history row for each", async () => {
    const r = await runSiteChecks(system, NOW);
    expect(r).toEqual({ targets: 2, scanned: 2, failed: 0, skippedForTime: 0, down: 0 });
    expect(mocks.scanUrl).toHaveBeenCalledWith("https://acmebakery.com");
    expect(mocks.scanUrl).toHaveBeenCalledWith("https://beta.com");
    expect(mocks.saveScan).toHaveBeenCalledTimes(2);
    expect(mocks.saveScan).toHaveBeenCalledWith({}, { client_id: "c1" }, { client_id: "c1" });
  });
  it("hands the previous row to the row builder, so a failed lookup can keep a known date", async () => {
    await runSiteChecks(system, NOW);
    expect(mocks.buildMonitorRow).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c1" }), upScan, { status: "up", sslExpiresAt: "2027-01-01T00:00:00Z", domainExpiresAt: null }, expect.any(Date));
    expect(mocks.buildMonitorRow).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c2" }), upScan, null, expect.any(Date));
  });
  it("counts sites found down", async () => {
    mocks.scanUrl.mockResolvedValueOnce(downScan).mockResolvedValueOnce(upScan);
    expect((await runSiteChecks(system, NOW)).down).toBe(1);
  });
  it("one site failing, in the scan or in saving, does not stop the others, and logs only the client id", async () => {
    mocks.listScanCandidates.mockResolvedValue([
      candidate({ clientId: "c1", projectUrl: "https://user:secret@acme.com" }),
      candidate({ clientId: "c2", clientName: "Beta Co", projectUrl: "beta.com" }),
      candidate({ clientId: "c3", clientName: "Gamma Co", projectUrl: "gamma.com" }),
    ]);
    mocks.scanUrl.mockImplementation(async (url: string) => {
      if (url.includes("acme.com")) throw new Error("boom https://user:secret@acme.com");
      return upScan;
    });
    mocks.saveScan.mockImplementation(async (_db: unknown, monitor: { client_id: string }) => {
      if (monitor.client_id === "c2") throw new Error("db down");
    });
    const r = await runSiteChecks(system, NOW);
    expect(r).toEqual({ targets: 3, scanned: 1, failed: 2, skippedForTime: 0, down: 0 });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("c1");
    expect(logged).toContain("c2");
    expect(logged).not.toContain("secret");
    expect(logged).not.toContain("acme.com");
  });
  it("stops starting new sites once the time budget is used up, and leaves them for the next run", async () => {
    mocks.listScanCandidates.mockResolvedValue(Array.from({ length: 8 }, (_, i) => candidate({ clientId: `c${i}`, clientName: `Client ${i}`, projectUrl: `site${i}.com` })));
    let t = 1_000_000;
    // Each scan "takes" 10 seconds on the fake clock; the start budget is 15 seconds.
    mocks.scanUrl.mockImplementation(async () => {
      t += 10_000;
      return upScan;
    });
    const r = await runSiteChecks(system, NOW, () => t);
    expect(r.targets).toBe(8);
    expect(r.scanned + r.skippedForTime + r.failed).toBe(8);
    expect(r.skippedForTime).toBeGreaterThan(0);
    expect(r.scanned).toBe(2);
    expect(SCAN_START_BUDGET_MS).toBe(15_000);
  });
  it("records a site that does not answer within the cap as down and carries on with the others", async () => {
    vi.useFakeTimers();
    try {
      mocks.listScanCandidates.mockResolvedValue([candidate({ clientId: "c1", projectUrl: "slow.com" }), candidate({ clientId: "c2", clientName: "Fast", projectUrl: "fast.com" })]);
      mocks.scanUrl.mockImplementation((url: string) => (url.includes("slow") ? new Promise(() => {}) : Promise.resolve(upScan)));
      const run = runSiteChecks(system, NOW);
      await vi.advanceTimersByTimeAsync(SITE_SCAN_CAP_MS + 1);
      const r = await run;
      expect(r).toMatchObject({ targets: 2, scanned: 2, failed: 0, down: 1 });
      const slowScan = mocks.buildMonitorRow.mock.calls.map((c) => c[1]).find((scan) => scan.status === "down");
      expect(slowScan?.error).toBe("No response within 22 seconds");
    } finally {
      vi.useRealTimers();
    }
  });
  it("scans up to ten sites at once, each for at most 22 seconds, so a run fits inside one tick", () => {
    expect(SCAN_CONCURRENCY).toBe(10);
    expect(SITE_SCAN_CAP_MS).toBe(22_000);
  });
  it("does nothing, without error, when there is nothing to scan", async () => {
    mocks.listScanCandidates.mockResolvedValue([candidate({ archivedAt: "2026-01-01T00:00:00Z" })]);
    expect(await runSiteChecks(system, NOW)).toEqual({ targets: 0, scanned: 0, failed: 0, skippedForTime: 0, down: 0 });
    expect(mocks.scanUrl).not.toHaveBeenCalled();
  });
  it("is allowed for the system actor and the owner, not for the ai actor or a client", async () => {
    await expect(runSiteChecks({ type: "owner", userId: "u", email: null, ip: null }, NOW)).resolves.toBeDefined();
    await expect(runSiteChecks({ type: "ai", name: "mcp" }, NOW)).rejects.toBeInstanceOf(PermissionError);
    await expect(runSiteChecks({ type: "client" } as never, NOW)).rejects.toBeInstanceOf(PermissionError);
    expect(mocks.listScanCandidates).toHaveBeenCalledTimes(1);
  });
});

describe("scanNow (the Scan now buttons)", () => {
  const owner = { type: "owner", userId: "owner-1", email: null, ip: null } as const;
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const upScan = { status: "up", responseTimeMs: 412, httpStatus: 200, securityScore: 8, securityIssues: [], error: null, sslExpiresAt: null, domainExpiresAt: null, brokenLinks: 0 };

  beforeEach(() => {
    mocks.listScanCandidates.mockResolvedValue([candidate({ clientId: A, clientName: "Acme Bakery", projectUrl: "acme.com" }), candidate({ clientId: B, clientName: "Beta Co", projectUrl: "beta.com" })]);
    mocks.getPreviousMonitors.mockResolvedValue(new Map());
    mocks.scanUrl.mockResolvedValue(upScan);
    mocks.buildMonitorRow.mockImplementation((target: { clientId: string }) => ({ monitor: { client_id: target.clientId }, check: { client_id: target.clientId } }));
    mocks.saveScan.mockResolvedValue(undefined);
    mocks.writeAudit.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("scans every monitored site and reports each one", async () => {
    const r = await scanNow(owner, {});
    expect(r.summary).toMatchObject({ targets: 2, scanned: 2, down: 0 });
    expect(r.outcomes.map((o) => [o.clientName, o.status, o.responseTimeMs])).toEqual([["Acme Bakery", "up", 412], ["Beta Co", "up", 412]]);
    expect(mocks.saveScan).toHaveBeenCalledTimes(2);
  });
  it("scans only the one site when a clientId is given", async () => {
    const r = await scanNow(owner, { clientId: B });
    expect(r.summary.targets).toBe(1);
    expect(mocks.scanUrl).toHaveBeenCalledTimes(1);
    expect(mocks.scanUrl).toHaveBeenCalledWith("https://beta.com");
    expect(r.outcomes[0]).toMatchObject({ clientId: B, status: "up" });
  });
  it("says so when the site is not monitored (archived, paused or no address), and scans nothing", async () => {
    mocks.listScanCandidates.mockResolvedValue([candidate({ clientId: A, archivedAt: "2026-01-01T00:00:00Z" })]);
    await expect(scanNow(owner, { clientId: A })).rejects.toBeInstanceOf(RuleError);
    await expect(scanNow(owner, { clientId: B })).rejects.toBeInstanceOf(RuleError);
    expect(mocks.scanUrl).not.toHaveBeenCalled();
  });
  it("refuses a bad id before doing anything", async () => {
    await expect(scanNow(owner, { clientId: "not-an-id" })).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.listScanCandidates).not.toHaveBeenCalled();
  });
  it("writes a manual-scan line in the audit log, and still returns the result if the audit write fails", async () => {
    await scanNow(owner, { clientId: A });
    expect(mocks.writeAudit).toHaveBeenCalledWith(owner, expect.objectContaining({ action: "site_check.run_manual", entityId: A, clientId: A }));
    mocks.writeAudit.mockRejectedValue(new Error("audit down"));
    await expect(scanNow(owner, {})).resolves.toMatchObject({ summary: { scanned: 2 } });
  });
  it("limits manual scans to ten a minute", async () => {
    const t = 5_000_000;
    for (let i = 0; i < 10; i++) await scanNow({ ...owner, userId: "limited-user" }, {}, () => t);
    await expect(scanNow({ ...owner, userId: "limited-user" }, {}, () => t)).rejects.toBeInstanceOf(RateLimitError);
    // another owner is not affected, and the limit clears after a minute
    await expect(scanNow({ ...owner, userId: "someone-else" }, {}, () => t)).resolves.toBeDefined();
    await expect(scanNow({ ...owner, userId: "limited-user" }, {}, () => t + 61_000)).resolves.toBeDefined();
  });
  it("is not allowed for the ai actor or a client", async () => {
    await expect(scanNow({ type: "ai", name: "mcp" } as never, {})).rejects.toBeInstanceOf(PermissionError);
    await expect(scanNow({ type: "client" } as never, {})).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("runVisualChecks (speed and visual job)", () => {
  const system = { type: "system", name: "visual_checks" } as const;
  const T0 = 1_000_000;
  const clock = () => T0;
  const ctx = { now: new Date(T0), deadline: new Date(T0 + 50_000) };
  const good = { ok: true, score: 87, lcpMs: 2100, cls: 0.05, tbtMs: 150, screenshotBase64: Buffer.from("new-jpeg").toString("base64") };

  beforeEach(() => {
    mocks.listScanCandidates.mockResolvedValue([
      candidate({ clientId: "c1", clientName: "Acme", projectUrl: "acme.com" }),
      candidate({ clientId: "c2", clientName: "Beta", projectUrl: "beta.com" }),
      candidate({ clientId: "c3", clientName: "Gone", projectUrl: "gone.com", archivedAt: "2026-01-01T00:00:00Z" }),
      candidate({ clientId: "c4", clientName: "Fresh", projectUrl: "fresh.com" }),
    ]);
    mocks.getVisualPrevious.mockResolvedValue([{ clientId: "c4", lastCheckedAt: new Date(T0 - 3_600_000).toISOString() }]);
    mocks.runPagespeed.mockResolvedValue(good);
    mocks.downloadScreenshot.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.uploadScreenshot.mockResolvedValue(undefined);
    mocks.screenshotDiff.mockReturnValue(4.5);
    mocks.saveVisualCheck.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("checks the due sites (not archived, not recently checked), stores the screenshot and writes the row", async () => {
    const r = await runVisualChecks(system, ctx, clock);
    expect(r).toEqual({ due: 2, checked: 2, failed: 0, skipped: null });
    expect(mocks.runPagespeed.mock.calls.map((c) => c[0]).sort()).toEqual(["https://acme.com", "https://beta.com"]);
    expect(mocks.uploadScreenshot).toHaveBeenCalledWith({}, "c1/latest.jpg", new Uint8Array(Buffer.from("new-jpeg")));
    expect(mocks.saveVisualCheck).toHaveBeenCalledWith({}, expect.objectContaining({ client_id: "c1", performance_score: 87, lcp_ms: 2100, cls: 0.05, tbt_ms: 150, screenshot_path: "c1/latest.jpg", diff_percent: 4.5, last_error: null }));
  });
  it("compares with the previous screenshot, read before the new one is stored", async () => {
    const order: string[] = [];
    mocks.downloadScreenshot.mockImplementation(async (_db: unknown, path: string) => (order.push(`download ${path}`), new Uint8Array([9])));
    mocks.uploadScreenshot.mockImplementation(async (_db: unknown, path: string) => void order.push(`upload ${path}`));
    await runVisualChecks(system, ctx, clock);
    for (const path of ["c1/latest.jpg", "c2/latest.jpg"]) expect(order.indexOf(`download ${path}`)).toBeLessThan(order.indexOf(`upload ${path}`));
    expect(order.filter((o) => o.startsWith("download"))).toHaveLength(2);
    expect(mocks.screenshotDiff).toHaveBeenCalledWith(new Uint8Array([9]), new Uint8Array(Buffer.from("new-jpeg")));
  });
  it("does nothing when there is not enough time left in the tick", async () => {
    const r = await runVisualChecks(system, { now: ctx.now, deadline: new Date(T0 + VISUAL_MIN_TIME_MS - 1) }, clock);
    expect(r).toEqual({ due: 0, checked: 0, failed: 0, skipped: "not enough time this tick" });
    expect(mocks.listScanCandidates).not.toHaveBeenCalled();
    expect(mocks.runPagespeed).not.toHaveBeenCalled();
  });
  it("writes the error on a failed check, keeps going with the other site", async () => {
    mocks.runPagespeed.mockImplementation(async (url: string) => (url.includes("acme") ? { ok: false, error: "quota used up" } : good));
    const r = await runVisualChecks(system, ctx, clock);
    expect(r).toMatchObject({ due: 2, checked: 1, failed: 1 });
    expect(mocks.saveVisualCheck).toHaveBeenCalledWith({}, { client_id: "c1", url: "https://acme.com", last_checked_at: new Date(T0).toISOString(), last_error: "quota used up" });
  });
  it("still records the numbers when the screenshot cannot be stored or the old one read", async () => {
    mocks.downloadScreenshot.mockRejectedValue(new Error("storage down"));
    mocks.uploadScreenshot.mockRejectedValue(new Error("storage down"));
    const r = await runVisualChecks(system, ctx, clock);
    expect(r.checked).toBe(2);
    expect(mocks.saveVisualCheck).toHaveBeenCalledWith({}, expect.objectContaining({ client_id: "c1", performance_score: 87, screenshot_path: null }));
  });
  it("counts a failed save as a failure without stopping the run", async () => {
    mocks.saveVisualCheck.mockImplementation(async (_db: unknown, row: { client_id: string }) => {
      if (row.client_id === "c1") throw new Error("db down");
    });
    expect(await runVisualChecks(system, ctx, clock)).toMatchObject({ checked: 1, failed: 1 });
  });
  it("is not allowed for the ai actor or a client", async () => {
    await expect(runVisualChecks({ type: "ai", name: "mcp" }, ctx, clock)).rejects.toBeInstanceOf(PermissionError);
    await expect(runVisualChecks({ type: "client" } as never, ctx, clock)).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("checkSpeedNow (the Check speed now button)", () => {
  const owner = { type: "owner", userId: "owner-speed", email: null, ip: null } as const;
  const A = "33333333-3333-4333-8333-333333333333";
  const B = "44444444-4444-4444-8444-444444444444";
  const good = { ok: true, score: 72, lcpMs: 3100, cls: 0.1, tbtMs: 300, screenshotBase64: null };

  beforeEach(() => {
    mocks.listScanCandidates.mockResolvedValue([candidate({ clientId: A, clientName: "Acme", projectUrl: "acme.com" }), candidate({ clientId: B, clientName: "Paused", projectUrl: "p.com", monitoringPausedAt: "2026-01-01T00:00:00Z" })]);
    mocks.runPagespeed.mockResolvedValue(good);
    mocks.saveVisualCheck.mockResolvedValue(undefined);
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  it("checks the one site and returns the outcome", async () => {
    expect(await checkSpeedNow(owner, { clientId: A })).toEqual({ clientName: "Acme", ok: true, score: 72, lcpMs: 3100, diff: null, error: null });
    expect(mocks.runPagespeed).toHaveBeenCalledTimes(1);
    expect(mocks.uploadScreenshot).not.toHaveBeenCalled();
  });
  it("refuses a site that is not monitored, and a bad id, without calling PageSpeed", async () => {
    await expect(checkSpeedNow(owner, { clientId: B })).rejects.toBeInstanceOf(RuleError);
    await expect(checkSpeedNow(owner, { clientId: "nope" })).rejects.toBeInstanceOf(ValidationError);
    await expect(checkSpeedNow(owner, {})).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.runPagespeed).not.toHaveBeenCalled();
  });
  it("writes an audit row, and still answers if the audit write fails", async () => {
    await checkSpeedNow(owner, { clientId: A });
    expect(mocks.writeAudit).toHaveBeenCalledWith(owner, expect.objectContaining({ action: "visual_check.run_manual", entityId: A, clientId: A }));
    mocks.writeAudit.mockRejectedValue(new Error("audit down"));
    await expect(checkSpeedNow(owner, { clientId: A })).resolves.toMatchObject({ ok: true });
  });
  it("limits manual speed checks to six a minute per owner", async () => {
    const who = { ...owner, userId: "speed-limited" };
    const t = 9_000_000;
    for (let i = 0; i < 6; i++) await checkSpeedNow(who, { clientId: A }, () => t);
    await expect(checkSpeedNow(who, { clientId: A }, () => t)).rejects.toBeInstanceOf(RateLimitError);
    await expect(checkSpeedNow(who, { clientId: A }, () => t + 61_000)).resolves.toBeDefined();
  });
  it("is not allowed for the ai actor or a client", async () => {
    await expect(checkSpeedNow({ type: "ai", name: "mcp" } as never, { clientId: A })).rejects.toBeInstanceOf(PermissionError);
    await expect(checkSpeedNow({ type: "client" } as never, { clientId: A })).rejects.toBeInstanceOf(PermissionError);
  });
});
