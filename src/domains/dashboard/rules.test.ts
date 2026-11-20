import { describe, expect, it } from "vitest";
import { summarize } from "@/domains/growth/rules";
import type { Lead } from "@/domains/growth/types";
import { buildOwnerDashboard, isCollectedPayment, localDay, payingClientIds, weekBounds } from "./rules";
import { DASHBOARD_LIST_LIMIT, type DashboardClient, type DashboardFacts, type DashboardLead, type DashboardPayment } from "./types";

const TODAY = "2026-11-20";
const TZ = "America/New_York";

function facts(over: Partial<DashboardFacts> = {}): DashboardFacts {
  return {
    today: TODAY,
    timeZone: TZ,
    generatedAt: "2026-11-20T15:00:00.000Z",
    leads: { available: true, pipelineAvailable: true, truncated: false, rows: [] },
    clients: { available: true, truncated: false, rows: [] },
    payments: { available: true, truncated: false, rows: [] },
    ...over,
  };
}

function lead(over: Partial<DashboardLead> = {}): DashboardLead {
  return {
    id: "l1",
    businessName: "Nova",
    stage: "new_lead",
    source: "Referral",
    value: null,
    createdAt: "2026-11-18T15:00:00Z",
    followUpDate: null,
    clientId: null,
    stageChangedAt: "2026-11-18T15:00:00Z",
    lastTouchAt: "2026-11-18T15:00:00Z",
    nextStep: null,
    nextStepOn: null,
    lostReason: null,
    kind: "inbound",
    ...over,
  };
}

function client(over: Partial<DashboardClient> = {}): DashboardClient {
  return { id: "c1", businessName: "Acme", archived: false, lifetimeValue: 0, ...over };
}

function paid(over: Partial<DashboardPayment> = {}): DashboardPayment {
  return { amount: 49, status: "paid", paidAt: "2026-11-18T15:00:00Z", clientId: "c1", ...over };
}

function review(rows: DashboardLead[], extra: Partial<DashboardFacts> = {}) {
  const dash = buildOwnerDashboard(facts({ leads: { available: true, pipelineAvailable: true, truncated: false, rows }, ...extra }));
  if (!dash.leads.available) throw new Error("expected leads");
  return { dash, leads: dash.leads };
}

describe("week bounds", () => {
  it("uses the Monday–Sunday calendar week", () => {
    expect(weekBounds("2026-11-20")).toEqual({ start: "2026-11-16", end: "2026-11-22" });
    expect(weekBounds("2026-11-16")).toEqual({ start: "2026-11-16", end: "2026-11-22" });
    expect(weekBounds("2026-11-22")).toEqual({ start: "2026-11-16", end: "2026-11-22" });
  });

  it("reads a timestamp in the business time zone and leaves a plain date alone", () => {
    expect(localDay("2026-11-16T04:30:00Z", TZ)).toBe("2026-11-15");
    expect(localDay("2026-11-16T05:00:00Z", TZ)).toBe("2026-11-16");
    expect(localDay("2026-11-16", TZ)).toBe("2026-11-16");
    expect(localDay("not-a-date", TZ)).toBeNull();
  });
});

describe("collected payments", () => {
  it("accepts only status paid with a positive amount", () => {
    expect(isCollectedPayment(paid())).toBe(true);
    expect(isCollectedPayment(paid({ status: "pending" }))).toBe(false);
    expect(isCollectedPayment(paid({ status: "failed" }))).toBe(false);
    expect(isCollectedPayment(paid({ status: "Paid" }))).toBe(false);
    expect(isCollectedPayment(paid({ amount: 0 }))).toBe(false);
    expect(isCollectedPayment(paid({ amount: -10 }))).toBe(false);
  });
});

describe("buildOwnerDashboard", () => {
  it("is empty without looking like a failure", () => {
    const dash = buildOwnerDashboard(facts());
    expect(dash.weekStart).toBe("2026-11-16");
    if (!dash.leads.available || !dash.clients.available || !dash.revenue.available) throw new Error("expected sections");
    expect(dash.leads.newThisWeek).toBe(0);
    expect(dash.leads.openValue).toBe(0);
    expect(dash.leads.won).toBe(0);
    expect(dash.leads.winRate).toBeNull();
    expect(dash.leads.followUps).toEqual([]);
    expect(dash.leads.staleCount).toBe(0);
    expect(dash.leads.lostReasons).toEqual([]);
    expect(dash.clients.active).toBe(0);
    expect(dash.clients.paying).toBe(0);
    expect(dash.revenue.collectedAllTime).toBe(0);
    expect(dash.leads.stages.map((stage) => stage.count)).toEqual([0, 0, 0, 0, 0]);
  });

  it("keeps Won and deal value out of revenue", () => {
    const { dash, leads } = review(
      [
        lead({ id: "open", stage: "in_discussion", value: 2500, source: "Website" }),
        lead({ id: "won", stage: "won", value: 9000, clientId: "c9", stageChangedAt: "2026-11-19T15:00:00Z" }),
        lead({ id: "lost", stage: "lost", value: 400, lostReason: "price" }),
      ],
      { payments: { available: true, truncated: false, rows: [paid({ amount: 49, clientId: null }), paid({ amount: 0.1, clientId: "c1" }), paid({ amount: 0.2, clientId: "c1" })] } },
    );
    expect(leads.openValue).toBe(2500);
    expect(leads.wonValue).toBe(9000);
    expect(leads.winRate).toBe(50);
    if (!dash.revenue.available) throw new Error("expected revenue");
    expect(dash.revenue.collectedAllTime).toBe(49.3);
    expect(dash.revenue.collectedAllTime).not.toBe(leads.openValue + leads.wonValue);
    expect(dash.revenue.paidCount).toBe(3);
  });

  it("matches the Growth win rate and open deal value", () => {
    const rows = [
      lead({ id: "a", stage: "proposal_sent", value: 1000 }),
      lead({ id: "b", stage: "won", value: 500 }),
      lead({ id: "c", stage: "lost", value: 800 }),
      lead({ id: "d", stage: "new_lead", value: null }),
    ];
    const { leads } = review(rows);
    const summary = summarize(
      rows.map((row): Lead => ({
        id: row.id,
        name: "Hidden",
        businessName: row.businessName,
        email: null,
        phone: null,
        stage: row.stage,
        followUpDate: row.followUpDate,
        notes: null,
        source: row.source,
        value: row.value,
        createdAt: row.createdAt,
      })),
      TODAY,
    );
    expect(leads.winRate).toBe(summary.winRate);
    expect(leads.openValue).toBe(summary.pipelineValue);
    expect(leads.openUnvalued).toBe(summary.unvalued);
    expect(leads.proposalsOut).toBe(summary.proposalsOut);
  });

  it("counts new leads, sources and won-this-week from the business-time calendar week", () => {
    const { leads } = review([
      lead({ id: "in", createdAt: "2026-11-16T05:00:00Z", source: "Website", kind: "inbound", stage: "new_lead" }),
      lead({ id: "edge", createdAt: "2026-11-16T04:30:00Z", source: "Website", kind: "outbound", stage: "new_lead" }),
      lead({ id: "blank", createdAt: "2026-11-20T15:00:00Z", source: "  ", kind: null, stage: "in_discussion" }),
      lead({ id: "old-won", stage: "won", createdAt: "2026-10-01T15:00:00Z", stageChangedAt: "2026-11-18T15:00:00Z", value: 100 }),
      lead({ id: "new-but-old-stage", stage: "won", createdAt: "2026-11-19T15:00:00Z", stageChangedAt: "2026-10-02T15:00:00Z" }),
      lead({ id: "won-no-time", stage: "won", createdAt: "2026-11-19T15:00:00Z", stageChangedAt: null }),
    ]);
    expect(leads.newThisWeek).toBe(4);
    expect(leads.newBySource).toEqual([
      { label: "Referral", count: 2 },
      { label: "No source", count: 1 },
      { label: "Website", count: 1 },
    ]);
    expect(leads.newByKind).toEqual({ inbound: 3, outbound: 0, unset: 1 });
    expect(leads.won).toBe(3);
    expect(leads.wonThisWeek).toBe(1);
    expect(leads.wonWithoutStageTime).toBe(1);
    expect(leads.stages.find((stage) => stage.stage === "won")?.changedThisWeek).toBe(1);
  });

  it("flags overdue follow-ups, overdue next steps, and stale leads without closing them", () => {
    const rows = [
      lead({ id: "over", businessName: "Over", followUpDate: "2026-11-18", nextStep: "Send the proposal", nextStepOn: "2026-11-17" }),
      lead({ id: "today", businessName: "Today Co", followUpDate: TODAY, nextStepOn: TODAY, nextStep: "Call" }),
      lead({ id: "later", followUpDate: "2026-11-25", nextStepOn: "2026-11-25" }),
      lead({ id: "won-due", stage: "won", followUpDate: "2026-11-01", nextStepOn: "2026-11-01" }),
      lead({ id: "stale-touch", businessName: "Quiet", lastTouchAt: "2026-10-21T15:00:00Z", stageChangedAt: "2026-11-19T15:00:00Z", createdAt: "2026-08-01T15:00:00Z" }),
      lead({ id: "fresh-touch", lastTouchAt: "2026-10-22T15:00:00Z", createdAt: "2026-08-01T15:00:00Z" }),
      lead({ id: "no-touch", businessName: "Never", lastTouchAt: null, createdAt: "2026-10-21T15:00:00Z" }),
      lead({ id: "new-quiet", lastTouchAt: null, createdAt: "2026-10-22T15:00:00Z" }),
      lead({ id: "old-won", stage: "won", lastTouchAt: "2026-01-01T15:00:00Z" }),
    ];
    const { leads } = review(rows);
    expect(leads.followUpsOverdue).toBe(1);
    expect(leads.followUpsDueToday).toBe(1);
    expect(leads.followUps.map((row) => row.id)).toEqual(["over", "today"]);
    expect(leads.followUps[0]?.detail).toContain("2 days");
    expect(leads.nextStepsOverdue).toBe(1);
    expect(leads.nextStepsDueToday).toBe(1);
    expect(leads.nextSteps?.[0]?.detail).toContain("Send the proposal");
    expect(leads.staleCount).toBe(2);
    expect(leads.staleLeads?.map((row) => row.id)).toEqual(["no-touch", "stale-touch"]);
    expect(leads.staleLeads?.[0]?.detail).toContain("No touch recorded");
    expect(leads.staleLeads?.[1]?.detail).toContain("No touch in 30 days");
    expect(rows.find((row) => row.id === "stale-touch")?.stage).toBe("new_lead");
  });

  it("caps the attention lists and still reports the full total", () => {
    const rows = Array.from({ length: DASHBOARD_LIST_LIMIT + 1 }, (_, i) =>
      lead({ id: `f${i}`, businessName: `B${String(i).padStart(2, "0")}`, followUpDate: "2026-11-01" }),
    );
    const { leads } = review(rows);
    expect(leads.followUps).toHaveLength(DASHBOARD_LIST_LIMIT);
    expect(leads.followUpTotal).toBe(DASHBOARD_LIST_LIMIT + 1);
    expect(leads.followUpsOverdue).toBe(DASHBOARD_LIST_LIMIT + 1);
  });

  it("groups lost reasons and client links, and does not treat a missing pipeline as all stale", () => {
    const rows = [
      lead({ id: "p", stage: "lost", lostReason: "price" }),
      lead({ id: "u", stage: "lost", lostReason: null }),
      lead({ id: "x", stage: "lost", lostReason: "nope" }),
      lead({ id: "t", stage: "lost", lostReason: "timing" }),
      lead({ id: "linked", stage: "won", clientId: "c1" }),
      lead({ id: "alone", stage: "won", clientId: null, businessName: "Alone" }),
      lead({ id: "open-link", clientId: "c2" }),
    ];
    const { leads } = review(rows);
    expect(leads.lostReasons?.map((row) => row.label)).toEqual(["Price", "Timing", "No reason recorded", "Unrecognized"]);
    expect(leads.linked).toBe(2);
    expect(leads.wonLinked).toBe(1);
    expect(leads.wonUnlinkedTotal).toBe(1);
    expect(leads.wonUnlinked?.[0]?.detail).toBe("Won · no client linked");

    const missing = buildOwnerDashboard(facts({
      leads: {
        available: true,
        pipelineAvailable: false,
        truncated: false,
        rows: [lead({ id: "old", createdAt: "2026-01-01T15:00:00Z", lastTouchAt: null, nextStepOn: "2026-11-01", lostReason: "price", clientId: "c1", stage: "lost" })],
      },
    }));
    if (!missing.leads.available) throw new Error("expected leads");
    expect(missing.leads.stages.find((stage) => stage.stage === "lost")?.count).toBe(1);
    expect(missing.leads.stages.every((stage) => stage.changedThisWeek === null)).toBe(true);
    expect(missing.leads.staleCount).toBeNull();
    expect(missing.leads.nextSteps).toBeNull();
    expect(missing.leads.lostReasons).toBeNull();
    expect(missing.leads.linked).toBeNull();
    expect(missing.leads.wonThisWeek).toBeNull();
    expect(missing.leads.newByKind).toBeNull();
    expect(missing.leads.won).toBe(0);
    expect(missing.leads.lost).toBe(1);
  });

  it("counts active and paying clients from lifetime value or a positive paid row", () => {
    const clients = [
      client({ id: "paid-row", lifetimeValue: 0 }),
      client({ id: "lifetime", lifetimeValue: 0.01 }),
      client({ id: "neither" }),
      client({ id: "archived", archived: true, lifetimeValue: 500 }),
      client({ id: "zero-paid", lifetimeValue: 0 }),
    ];
    const payments = [
      paid({ clientId: "paid-row", amount: 20 }),
      paid({ clientId: "archived", amount: 80 }),
      paid({ clientId: "zero-paid", amount: 0, status: "paid" }),
      paid({ clientId: "neither", amount: 15, status: "pending" }),
      paid({ clientId: null, amount: 5 }),
    ];
    const dash = buildOwnerDashboard(facts({
      clients: { available: true, truncated: false, rows: clients },
      payments: { available: true, truncated: false, rows: payments },
    }));
    if (!dash.clients.available) throw new Error("expected clients");
    expect(dash.clients.active).toBe(4);
    expect(dash.clients.archived).toBe(1);
    expect(dash.clients.paying).toBe(2);
    expect(dash.clients.activeNotPaying).toBe(2);
    expect(payingClientIds(clients, payments)).toEqual(["lifetime", "paid-row"]);
  });

  it("dates paid revenue in the business time zone and skips undated rows for the week and month", () => {
    const dash = buildOwnerDashboard(facts({
      payments: {
        available: true,
        truncated: false,
        rows: [
          paid({ amount: 10, paidAt: "2026-11-01T15:00:00Z" }),
          paid({ amount: 7, paidAt: "2026-10-31T15:00:00Z" }),
          paid({ amount: 3, paidAt: "2026-11-16T04:30:00Z" }),
          paid({ amount: 4, paidAt: null }),
          paid({ amount: 100, status: "failed", paidAt: "2026-11-18T15:00:00Z" }),
        ],
      },
    }));
    if (!dash.revenue.available) throw new Error("expected revenue");
    expect(dash.revenue.collectedThisMonth).toBe(13);
    expect(dash.revenue.collectedThisWeek).toBe(0);
    expect(dash.revenue.collectedAllTime).toBe(24);
    expect(dash.revenue.undated).toBe(1);
    expect(dash.revenue.paidCount).toBe(4);
  });

  it("leaves a missing table unavailable instead of zero", () => {
    const dash = buildOwnerDashboard(facts({
      leads: { available: false },
      clients: { available: false },
      payments: { available: false },
    }));
    expect(dash.leads).toEqual({ available: false });
    expect(dash.clients).toEqual({ available: false });
    expect(dash.revenue).toEqual({ available: false });
  });

  it("still counts clients when payments are unavailable, and withholds the paying count", () => {
    const dash = buildOwnerDashboard(facts({
      clients: { available: true, truncated: true, rows: [client({ lifetimeValue: 40 })] },
      payments: { available: false },
    }));
    if (!dash.clients.available || dash.revenue.available) throw new Error("expected a partial dashboard");
    expect(dash.clients.active).toBe(1);
    expect(dash.clients.paying).toBeNull();
    expect(dash.clients.activeNotPaying).toBeNull();
    expect(dash.clients.truncated).toBe(true);
  });
});
