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
  scanUrl: vi.fn(),
  buildMonitorRow: vi.fn(),
}));

vi.mock("@/platform/db/server", () => ({ createAdminClient: () => ({}), createUserClient: async () => ({}) }));
vi.mock("./repo", () => ({
  listSites: mocks.listSites,
  listAlertState: mocks.listAlertState,
  saveAlertState: mocks.saveAlertState,
  listOpenIssues: vi.fn(),
  listScanCandidates: mocks.listScanCandidates,
  getPreviousMonitors: mocks.getPreviousMonitors,
  saveScan: mocks.saveScan,
}));
vi.mock("./checks", () => ({ scanUrl: mocks.scanUrl }));
vi.mock("./scan-rules", () => ({
  withScheme: (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`),
  buildMonitorRow: mocks.buildMonitorRow,
  unreachable: (message: string) => ({ status: "down", responseTimeMs: null, httpStatus: null, securityScore: 0, securityIssues: ["Site unreachable or SSL certificate invalid"], error: message }),
}));
vi.mock("@/domains/notifications/service", () => ({ notifyOwner: mocks.notifyOwner }));
vi.mock("@/domains/admin/service", () => ({ getCalendar: vi.fn() }));

import { buildScanTargets, isScannable, pickScanUrl, runMonitorAlerts, runSiteChecks, SCAN_START_BUDGET_MS, SCAN_CONCURRENCY, SITE_SCAN_CAP_MS } from "./service";
import { PermissionError } from "@/platform/errors";

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
