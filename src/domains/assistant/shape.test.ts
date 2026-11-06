import { describe, expect, it } from "vitest";
import { assertNoBannedKeys } from "./redact";
import {
  daysSince,
  isProblemSite,
  shapeAttention,
  shapeClientWorkspace,
  shapeExpiring,
  shapeFinancialSummary,
  shapeLeads,
  shapeOpenRequests,
  shapeSite,
  shapeSiteIssues,
  shapeSites,
} from "./shape";
import type { ClientWorkspace } from "@/domains/clients/types";
import type { GrowthOverview } from "@/domains/growth/types";
import type { MonitoringOverview, SiteMonitor } from "@/domains/monitoring/types";
import type { TodayData } from "@/domains/today/types";
import type { WorkOverview } from "@/domains/work/types";

const NOW = new Date("2026-11-06T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000 + 3_600_000).toISOString();

const site = (over: Partial<SiteMonitor> = {}): SiteMonitor => ({
  id: "s1", clientId: "c1", clientName: "Acme Bakery", url: "https://www.acmebakery.com/secret/path?token=abc", status: "up",
  responseTimeMs: 300, httpStatus: 200, securityScore: 7, brokenLinks: 0, sslExpiresAt: inDays(90), domainExpiresAt: inDays(200),
  lastCheckedAt: hoursAgo(0.1), lastError: null, alertsMuted: false, ...over,
});

const overview = (sites: SiteMonitor[]): MonitoringOverview => ({
  sites,
  issues: [
    { id: "i1", clientId: "c1", title: "TypeError at jane@acme.com checkout", level: "error", lastSeen: hoursAgo(2), webUrl: "https://sentry.io/organizations/x/issues/1/" },
    { id: "i2", clientId: null, title: "Unlinked error", level: "warning", lastSeen: hoursAgo(5), webUrl: null },
  ],
  timeZone: "America/New_York",
  asOf: NOW.toISOString(),
});

describe("daysSince", () => {
  it("counts whole days, never negative, and copes with junk", () => {
    expect(daysSince(hoursAgo(50), NOW)).toBe(2);
    expect(daysSince(new Date(NOW.getTime() + 1e9).toISOString(), NOW)).toBe(0);
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince("junk", NOW)).toBeNull();
  });
});

describe("sites", () => {
  it("keeps only the host, never the path or query of the site address", () => {
    const v = shapeSite(site(), NOW);
    expect(v.host).toBe("acmebakery.com");
    expect(JSON.stringify(v)).not.toContain("secret");
    expect(JSON.stringify(v)).not.toContain("token");
  });
  it("marks a stale check and counts days left", () => {
    const v = shapeSite(site({ lastCheckedAt: hoursAgo(5), sslExpiresAt: inDays(6) }), NOW);
    expect(v.stale).toBe(true);
    expect(v.sslDaysLeft).toBe(6);
  });
  it("only_problems keeps down, stale and soon-expiring sites, and hides muted ones by default", () => {
    const ov = overview([
      site({ id: "ok", clientName: "Fine Co" }),
      site({ id: "down", clientName: "Down Co", status: "down" }),
      site({ id: "stale", clientName: "Stale Co", lastCheckedAt: hoursAgo(9) }),
      site({ id: "ssl", clientName: "Cert Co", sslExpiresAt: inDays(3) }),
      site({ id: "muted", clientName: "Gone Co", status: "down", alertsMuted: true }),
    ]);
    const problems = shapeSites(ov, NOW, { onlyProblems: true, includeMuted: false });
    expect(problems.sites.map((s) => s.client).sort()).toEqual(["Cert Co", "Down Co", "Stale Co"]);
    expect(problems.total).toBe(5);
    expect(shapeSites(ov, NOW, { onlyProblems: false, includeMuted: true }).shown).toBe(5);
    expect(shapeSites(ov, NOW, { onlyProblems: false, includeMuted: false }).shown).toBe(4);
  });
  it("isProblemSite treats an unknown status as a problem", () => {
    expect(isProblemSite(shapeSite(site({ status: "unknown" }), NOW))).toBe(true);
    expect(isProblemSite(shapeSite(site(), NOW))).toBe(false);
  });
  it("clips and keeps a last error short", () => {
    const v = shapeSite(site({ lastError: "x".repeat(400) }), NOW);
    expect(v.lastError?.length).toBeLessThanOrEqual(160);
  });
});

describe("expiring", () => {
  it("lists ssl and domain dates inside the window, soonest first, expired included, muted left out", () => {
    const ov = overview([
      site({ id: "a", clientName: "A Co", sslExpiresAt: inDays(20), domainExpiresAt: inDays(5) }),
      site({ id: "b", clientName: "B Co", sslExpiresAt: new Date(NOW.getTime() - 3 * 86_400_000).toISOString() }),
      site({ id: "c", clientName: "C Co", sslExpiresAt: inDays(1), alertsMuted: true }),
    ]);
    const r = shapeExpiring(ov, NOW, 30);
    expect(r.expiring.map((e) => `${e.client}:${e.kind}`)).toEqual(["B Co:ssl", "A Co:domain", "A Co:ssl"]);
    expect(r.expiring[0]).toMatchObject({ expired: true });
    expect(shapeExpiring(ov, NOW, 10).count).toBe(2);
  });
});

describe("site issues", () => {
  it("maps the client name, keeps unlinked ones, and can filter by client", () => {
    const ov = overview([site()]);
    const all = shapeSiteIssues(ov, null);
    expect(all.count).toBe(2);
    expect(all.issues[0]).toMatchObject({ client: "Acme Bakery", level: "error" });
    expect(all.issues[1]).toMatchObject({ client: null });
    expect(shapeSiteIssues(ov, "acme").count).toBe(1);
    expect(shapeSiteIssues(ov, "nobody").count).toBe(0);
  });
});

describe("open requests", () => {
  const work: WorkOverview = {
    today: "2026-11-06",
    requests: [
      { id: "r1", displayId: "LUM-1052", title: "Update hours", clientId: "c1", clientName: "Acme Bakery", status: "waiting_on_client", priority: "high", source: "email", description: "Call jane@acme.com on 803-555-0100 about the thing", websiteUrl: "https://acme.com", createdAt: hoursAgo(72) },
    ],
    tasks: [
      { id: "t1", title: "Renew hosting", description: "private detail", clientId: null, clientName: null, status: "ready", priority: "urgent", dueDate: "2026-11-05", overdue: true, updatedAt: hoursAgo(1) },
    ],
    projects: [],
  };
  it("returns requests without descriptions, source or website, and only includes tasks when asked", () => {
    const r = shapeOpenRequests(work, NOW, false);
    expect(r).not.toHaveProperty("tasks");
    expect((r.requests as unknown[])[0]).toEqual({ id: "LUM-1052", client: "Acme Bakery", title: "Update hours", status: "waiting_on_client", priority: "high", waitingOnClient: true, daysOpen: 3 });
    expect(JSON.stringify(r)).not.toContain("803-555");
    const withTasks = shapeOpenRequests(work, NOW, true);
    expect((withTasks.tasks as unknown[])[0]).toEqual({ title: "Renew hosting", client: null, status: "ready", priority: "urgent", dueDate: "2026-11-05", overdue: true });
    expect(JSON.stringify(withTasks)).not.toContain("private detail");
    assertNoBannedKeys(withTasks);
  });
});

const today: TodayData = {
  today: "2026-11-06",
  timeZone: "America/New_York",
  attention: [
    { key: "a", kind: "payment_failed", severity: 1, title: "Payment failed", detail: "$49.00 did not go through", clientName: "Acme Bakery", href: "/clients/c1", asOf: hoursAgo(30) },
    { key: "b", kind: "request", severity: 3, title: "Request waiting", detail: "LUM-1052", clientName: null, href: "/work", asOf: null },
  ],
  attentionTotal: 40,
  todos: [{ id: "t", title: "Private todo", priority: "high", status: "ready", dueDate: null, overdue: false }],
  waiting: [{ key: "w", kind: "request", title: "Waiting thing", code: "LUM-9", clientName: "Acme Bakery", href: "/work", since: hoursAgo(100) }],
  revenue: { planTotal: 1234.5, paidThisMonth: 400, paidThisMonthCount: 4, latestPaidAt: hoursAgo(3), failedLast30Days: 1, pendingCount: 2 },
  generatedAt: NOW.toISOString(),
};

describe("attention", () => {
  it("ranks by the service order, names the level, drops links and caps the count", () => {
    const r = shapeAttention(today, NOW, 1);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toEqual({ rank: 1, level: "critical", kind: "payment_failed", title: "Payment failed", detail: "$49.00 did not go through", client: "Acme Bakery", ageDays: 1 });
    expect(r.total).toBe(40);
    expect(JSON.stringify(r)).not.toContain("href");
    expect(shapeAttention(today, NOW, 25).items[1]?.level).toBe("info");
    expect(r.waitingOnOthers[0]).toMatchObject({ code: "LUM-9", waitingDays: 4 });
  });
});

describe("financial summary", () => {
  it("labels the plan total as not collected, and lists what is unavailable instead of inventing it", () => {
    const r = shapeFinancialSummary(today);
    expect(r.planTotalPerMonth).toEqual({ amount: 1234.5, formatted: "$1,234.50" });
    expect(r.planTotalMeaning).toContain("NOT money collected");
    expect(r.paidThisMonth).toMatchObject({ amount: 400, payments: 4 });
    expect(r.unavailable).toEqual(expect.arrayContaining(["expenses", "net profit"]));
  });
});

describe("client workspace", () => {
  const ws: ClientWorkspace = {
    client: { id: "c1", businessName: "Acme Bakery", contactName: "Jane Smith", email: "jane@acme.com", phone: "803-555-0100", status: "active", planName: "Professional", subscriptionPrice: 49, clientSince: "2025-01-02", revisionsIncluded: 3, revisionsUsed: 1, onHoldSince: null, monitoringPausedAt: null, archivedAt: null, hasStripeCustomer: true },
    emails: ["jane@acme.com"], phones: ["803-555-0100"],
    websites: [{ id: "w1", label: "Production", url: "https://acme.com/private" }],
    projects: [{ id: "p1", name: "Acme site", productionUrl: "https://acme.com", stagingUrl: null, githubUrl: "https://github.com/x/acme", hostingPlatform: "vercel", supabaseProjectId: "abcdef", sentryProject: "acme", contractStatus: "signed", blockerNote: "Waiting on logo from jane@acme.com", buildValue: 5000, targetDate: "2026-12-01", launchedAt: null, lastDeployedAt: null }],
    requests: [
      { id: "r1", displayId: "LUM-1052", title: "Update hours", status: "new", category: "Content", billable: false, createdAt: hoursAgo(48), completedAt: null },
      { id: "r2", displayId: "LUM-1040", title: "Old thing", status: "completed", category: null, billable: false, createdAt: hoursAgo(900), completedAt: hoursAgo(800) },
    ],
    openRequests: 1,
    payments: Array.from({ length: 15 }, (_, i) => ({ id: `pay${i}`, amount: 49, status: "paid", eventType: "subscription", paidAt: hoursAgo(i * 24), createdAt: hoursAgo(i * 24) })),
    documents: [{ id: "d1", fileName: "contract-jane-smith.pdf", category: "contract", createdAt: hoursAgo(1) }],
    activity: [{ id: "a1", action: "note_added", entityType: "client", createdAt: hoursAgo(1) }],
    monitor: { state: "up", label: "Up", tone: "ok", url: "https://www.acme.com/private", lastCheckedAt: hoursAgo(0.2), httpStatus: 200, responseTimeMs: 250, sslExpiresAt: inDays(40), domainExpiresAt: inDays(300) },
  };
  it("keeps only the allow-listed fields and drops every contact detail, file name and id", () => {
    const r = shapeClientWorkspace(ws, NOW);
    const json = JSON.stringify(r);
    for (const secret of ["jane@acme.com", "803-555-0100", "Jane Smith", "contract-jane-smith", "github.com", "abcdef", "private"]) expect(json).not.toContain(secret);
    expect(r.client).toMatchObject({ name: "Acme Bakery", plan: "Professional", monthlyPrice: { amount: 49, formatted: "$49.00" }, onHold: false, archived: false });
    expect(r.projects[0]).toEqual({ name: "Acme site", contractStatus: "signed", hostingPlatform: "vercel", targetDate: "2026-12-01", launchedAt: null, hasBlocker: true });
    expect(r.monitor).toMatchObject({ host: "acme.com", sslDaysLeft: 40 });
    assertNoBannedKeys(r);
  });
  it("lists only open requests and at most 12 payments", () => {
    const r = shapeClientWorkspace(ws, NOW);
    expect(r.openRequests).toEqual([{ id: "LUM-1052", title: "Update hours", status: "new", daysOpen: 2 }]);
    expect(r.recentPayments).toHaveLength(12);
  });
});

describe("leads", () => {
  const g: GrowthOverview = {
    today: "2026-11-06",
    leads: [
      { id: "l1", name: "Jane Smith", businessName: "Acme Bakery", email: "jane@acme.com", phone: "803-555-0100", stage: "proposal_sent", followUpDate: "2026-11-04", notes: "Call her at home", source: "Website form", value: 1500, createdAt: hoursAgo(100) },
      { id: "l2", name: "Bob Jones", businessName: "Bob's Plumbing", email: null, phone: null, stage: "new_lead", followUpDate: null, notes: null, source: null, value: null, createdAt: hoursAgo(10) },
      { id: "l3", name: "Done Deal", businessName: "Won Co", email: null, phone: null, stage: "won", followUpDate: null, notes: null, source: null, value: 900, createdAt: hoursAgo(500) },
    ],
    summary: { pipelineValue: 1500, unvalued: 1, openCount: 2, followUpsDue: 1, followUpsOverdue: 1, proposalsOut: 1, proposalNames: ["Acme Bakery"], won: 1, lost: 0, winRate: 100, stages: [] },
    dueNow: [],
  };
  it("shows only open leads by business name and never a person's name, email, phone or notes", () => {
    const r = shapeLeads(g);
    expect(r.openLeads.map((l) => l.business)).toEqual(["Acme Bakery", "Bob's Plumbing"]);
    expect(r.openLeads[0]).toEqual({ business: "Acme Bakery", stage: "Proposal sent", source: "Website form", estimatedValue: { amount: 1500, formatted: "$1,500.00" }, followUpDate: "2026-11-04", followUp: "overdue" });
    const json = JSON.stringify(r);
    for (const secret of ["Jane Smith", "Bob Jones", "jane@acme.com", "803-555", "Call her"]) expect(json).not.toContain(secret);
    expect(r.openLeads[1]?.estimatedValue).toBeNull();
    assertNoBannedKeys(r);
  });
});
