import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  getToday: vi.fn(),
  listClients: vi.fn(),
  getClientWorkspace: vi.fn(),
  getWorkOverview: vi.fn(),
  getGrowthOverview: vi.fn(),
  getMonitoringOverview: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("@/domains/today/service", () => ({ getToday: mocks.getToday }));
vi.mock("@/domains/clients/service", () => ({ listClients: mocks.listClients, getClientWorkspace: mocks.getClientWorkspace }));
vi.mock("@/domains/work/service", () => ({ getWorkOverview: mocks.getWorkOverview }));
vi.mock("@/domains/growth/service", () => ({ getGrowthOverview: mocks.getGrowthOverview }));
vi.mock("@/domains/monitoring/service", () => ({ getMonitoringOverview: mocks.getMonitoringOverview }));
vi.mock("@/platform/audit/audit", () => ({ writeAudit: mocks.writeAudit }));

import { assertNoBannedKeys } from "./redact";
import { callTool, listTools } from "./service";
import { TOOLS } from "./tools";

const ai = { type: "ai", name: "assistant" } as const;
const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const inDays = (d: number) => new Date(NOW + d * 86_400_000 + 3_600_000).toISOString();
const tool = (name: string) => {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

const monitoring = {
  sites: [{ id: "s1", clientId: "c1", clientName: "Acme Bakery", url: "https://www.acme.com/x?key=abc", status: "down", responseTimeMs: null, httpStatus: 503, securityScore: 5, brokenLinks: 2, sslExpiresAt: inDays(5), domainExpiresAt: inDays(300), lastCheckedAt: hoursAgo(0.1), lastError: "Bad gateway from jane@acme.com", alertsMuted: false }],
  issues: [{ id: "i1", clientId: "c1", title: "Crash for jane@acme.com", level: "error", lastSeen: hoursAgo(1), webUrl: "https://sentry.io/i/1" }],
  timeZone: "America/New_York",
  asOf: new Date(NOW).toISOString(),
};
const today = {
  today: "2026-11-06", timeZone: "America/New_York",
  attention: [{ key: "a", kind: "site_down", severity: 1, title: "Site down", detail: "acme.com", clientName: "Acme Bakery", href: "/monitoring", asOf: hoursAgo(1) }],
  attentionTotal: 1, todos: [], waiting: [],
  revenue: { planTotal: 100, paidThisMonth: 49, paidThisMonthCount: 1, latestPaidAt: hoursAgo(2), failedLast30Days: 0, pendingCount: 0 },
  generatedAt: new Date(NOW).toISOString(),
};
const work = { today: "2026-11-06", requests: [{ id: "r1", displayId: "LUM-1", title: "Call 803-555-0100 re hours", clientId: "c1", clientName: "Acme Bakery", status: "new", priority: null, source: "email", description: "secret description", websiteUrl: null, createdAt: hoursAgo(30) }], tasks: [], projects: [] };
const growth = { today: "2026-11-06", leads: [{ id: "l1", name: "Jane Smith", businessName: "Acme Bakery", email: "jane@acme.com", phone: "8035550100", stage: "new_lead", followUpDate: null, notes: "private", source: null, value: null, createdAt: hoursAgo(5) }], summary: { pipelineValue: 0, unvalued: 1, openCount: 1, followUpsDue: 0, followUpsOverdue: 0, proposalsOut: 0, proposalNames: [], won: 0, lost: 0, winRate: null, stages: [] }, dueNow: [] };
const listed = (name: string) => ({ id: `id-${name}`, businessName: name, contactName: "Jane Smith", email: "jane@acme.com", phone: "8035550100", status: "active", planName: null, subscriptionPrice: 49, openRequests: 0, websites: [], archived: false, onHold: false, monitor: { state: "up" } });
const workspace = {
  client: { id: "c1", businessName: "Acme Bakery", contactName: "Jane Smith", email: "jane@acme.com", phone: "8035550100", status: "active", planName: "Pro", subscriptionPrice: 49, clientSince: null, revisionsIncluded: 2, revisionsUsed: 0, onHoldSince: null, monitoringPausedAt: null, archivedAt: null, hasStripeCustomer: true },
  emails: [], phones: [], websites: [], projects: [], requests: [], openRequests: 0, payments: [], documents: [], activity: [],
  monitor: { state: "up", label: "Up", tone: "ok", url: "https://acme.com", lastCheckedAt: hoursAgo(1), httpStatus: 200, responseTimeMs: 200, sslExpiresAt: null, domainExpiresAt: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMonitoringOverview.mockResolvedValue(monitoring);
  mocks.getToday.mockResolvedValue(today);
  mocks.getWorkOverview.mockResolvedValue(work);
  mocks.getGrowthOverview.mockResolvedValue(growth);
  mocks.listClients.mockResolvedValue([listed("Acme Bakery")]);
  mocks.getClientWorkspace.mockResolvedValue(workspace);
});

describe("the tool list", () => {
  it("has the eight tools with unique snake_case names", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(["get_client", "get_financial_summary", "list_expiring", "list_leads", "list_needs_attention", "list_open_requests", "list_site_issues", "list_sites"]);
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
  });
  it("tells the assistant what each tool is for, and describes every argument", () => {
    for (const t of TOOLS) {
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.description.length).toBeGreaterThan(60);
      for (const [key, schema] of Object.entries(t.inputShape)) expect((schema as z.ZodType).description, `${t.name}.${key}`).toBeTruthy();
    }
  });
  it("is listed only for actors that may read", () => {
    expect(listTools(ai)).toHaveLength(8);
    expect(() => listTools({ type: "system", name: "x" })).toThrow();
  });
});

describe("limits on arguments", () => {
  const parse = (name: string, args: unknown) => z.object(tool(name).inputShape).strict().safeParse(args);
  it("rejects out-of-range numbers, over-long text and unknown fields", () => {
    expect(parse("list_expiring", { days: 121 }).success).toBe(false);
    expect(parse("list_expiring", { days: 0 }).success).toBe(false);
    expect(parse("list_expiring", { days: 120 }).success).toBe(true);
    expect(parse("list_needs_attention", { limit: 26 }).success).toBe(false);
    expect(parse("get_client", { name: "x".repeat(121) }).success).toBe(false);
    expect(parse("get_client", { name: "   " }).success).toBe(false);
    expect(parse("list_sites", { surprise: true }).success).toBe(false);
  });
});

describe("every tool reads as the ai actor and drops private fields", () => {
  const calls: [string, Record<string, unknown>][] = [
    ["list_needs_attention", {}],
    ["list_sites", {}],
    ["get_client", { name: "Acme Bakery" }],
    ["list_site_issues", {}],
    ["list_open_requests", { include_tasks: true }],
    ["list_expiring", { days: 30 }],
    ["get_financial_summary", {}],
    ["list_leads", {}],
  ];
  it.each(calls)("%s", async (name, args) => {
    // Through the service wrapper, as the connector does: free text is masked there.
    const result = await callTool(ai, name, args);
    expect(result.ok).toBe(true);
    const out = result.ok ? result.data : null;
    assertNoBannedKeys(out);
    const json = JSON.stringify(out);
    for (const secret of ["jane@acme.com", "8035550100", "Jane Smith", "secret description", "private", "key=abc"]) expect(json).not.toContain(secret);
    for (const m of [mocks.getToday, mocks.getWorkOverview, mocks.getGrowthOverview, mocks.getMonitoringOverview, mocks.listClients, mocks.getClientWorkspace]) {
      for (const call of m.mock.calls) expect(call[0]).toBe(ai);
    }
  });
});

describe("get_client", () => {
  const run = (name: string) => tool("get_client").run(ai, { name }) as Promise<Record<string, unknown>>;
  it("says so clearly when nobody matches, without throwing", async () => {
    mocks.listClients.mockResolvedValue([]);
    expect(await run("Nobody")).toEqual({ found: false, message: "No client matches that name.", matches: [] });
    expect(mocks.getClientWorkspace).not.toHaveBeenCalled();
  });
  it("lists the choices when several match and none is exact", async () => {
    mocks.listClients.mockResolvedValue([listed("Busy B Construction"), listed("Busy B Roofing")]);
    const r = await run("Busy B");
    expect(r).toMatchObject({ found: false, matches: [{ client: "Busy B Construction" }, { client: "Busy B Roofing" }] });
    expect(mocks.getClientWorkspace).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain("jane@acme.com");
  });
  it("picks the exact (case-insensitive) match among several", async () => {
    mocks.listClients.mockResolvedValue([listed("Acme"), listed("Acme Bakery")]);
    await run("acme bakery");
    expect(mocks.getClientWorkspace).toHaveBeenCalledWith(ai, "id-Acme Bakery");
  });
  it("is not found when the workspace has gone", async () => {
    mocks.getClientWorkspace.mockResolvedValue(null);
    expect(await run("Acme Bakery")).toMatchObject({ found: false });
  });
});

describe("through the service wrapper", () => {
  it("masks an email typed into free text, caps nothing it should not, and audits the call", async () => {
    const r = await callTool(ai, "list_site_issues", {});
    expect(r.ok).toBe(true);
    const json = JSON.stringify(r.ok ? r.data : null);
    expect(json).toContain("[email]");
    expect(json).not.toContain("jane@acme.com");
    expect(mocks.writeAudit).toHaveBeenCalledWith(ai, expect.objectContaining({ action: "assistant.tool_called", entityId: "list_site_issues" }));
  });
  it("answers a bad argument or unknown tool with a clear error, not a crash", async () => {
    expect(await callTool(ai, "list_expiring", { days: 500 })).toMatchObject({ ok: false });
    expect(await callTool(ai, "delete_everything", {})).toEqual({ ok: false, error: "Unknown tool." });
  });
  it("hides database errors from the assistant", async () => {
    mocks.getToday.mockRejectedValue(new Error("connection to db.internal:5432 refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await callTool(ai, "get_financial_summary", {})).toEqual({ ok: false, error: "The data could not be read right now." });
  });
});

describe("review fixes", () => {
  it("get_client matches on the business name only, so it cannot be used to look up an email address or phone number", async () => {
    // The directory search also matches contact details: it returns Acme for the email text below.
    mocks.listClients.mockResolvedValue([listed("Acme Bakery")]);
    for (const probe of ["jane@acme", "8035550100", "Jane Smith"]) {
      const r = (await tool("get_client").run(ai, { name: probe })) as Record<string, unknown>;
      expect(r).toMatchObject({ found: false });
      expect(mocks.getClientWorkspace).not.toHaveBeenCalled();
    }
  });
  it("get_client still finds a client by part of its business name, case-insensitively", async () => {
    mocks.listClients.mockResolvedValue([listed("Acme Bakery")]);
    mocks.getClientWorkspace.mockResolvedValue(workspace);
    const r = (await tool("get_client").run(ai, { name: "acme bak" })) as Record<string, unknown>;
    expect(r.found).not.toBe(false);
    expect(mocks.getClientWorkspace).toHaveBeenCalled();
  });
  it("list_needs_attention never sends a project blocker note", async () => {
    mocks.getToday.mockResolvedValue({
      ...today,
      attention: [{ key: "blk-1", kind: "blocker", severity: 2, title: "Project blocked", detail: "Client owes us $5,000 and is threatening to leave", clientName: "Acme Bakery", href: "/clients/c1", asOf: hoursAgo(3) }],
      attentionTotal: 1,
    });
    const out = JSON.stringify(await tool("list_needs_attention").run(ai, {}));
    expect(out).not.toContain("threatening");
    expect(out).not.toContain("$5,000");
    expect(out).toContain("A project blocker is recorded");
  });
});
