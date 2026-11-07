import { describe, expect, it } from "vitest";
import { formatMoney, MAX_SENDS_PER_RUN, noticeKey, paymentKey, planActivityAlerts, SEEDED_KEY, type ActivityInput, type PlannedAlert } from "./rules";
import type { ClientInfo, NoticeRow, PaymentRow, RequestInfo } from "./types";

const NOW = new Date("2026-11-06T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const client = (over: Partial<ClientInfo> = {}): ClientInfo => ({ id: "c1", name: "Acme Bakery", archived: false, onHold: false, ...over });
const request: RequestInfo = { id: "r1", displayId: "LUM-1052", title: "Update opening hours" };
const payment = (over: Partial<PaymentRow> = {}): PaymentRow => ({ id: "p1", clientId: "c1", amount: 49, status: "paid", createdAt: hoursAgo(2), paidAt: hoursAgo(2), ...over });
const notice = (over: Partial<NoticeRow> = {}): NoticeRow => ({ id: "n1", type: "new_request", clientId: "c1", requestId: "r1", read: false, createdAt: hoursAgo(1), ...over });

/** The first alert in a plan; fails the test if there is none. */
function first(plan: PlannedAlert[]): PlannedAlert {
  const a = plan[0];
  if (!a) throw new Error("expected at least one planned alert");
  return a;
}

const seededState = [{ key: SEEDED_KEY, state: "yes" }];
const input = (over: Partial<ActivityInput> = {}): ActivityInput => ({
  payments: [],
  notices: [],
  clients: { c1: client() },
  requests: { r1: request },
  previous: seededState,
  ...over,
});

describe("formatMoney", () => {
  it("shows dollars and cents with separators", () => {
    expect(formatMoney(49)).toBe("$49.00");
    expect(formatMoney(1234.5)).toBe("$1,234.50");
  });
});

describe("first run", () => {
  it("records everything that already exists silently, then marks itself seeded", () => {
    const plan = planActivityAlerts(input({ previous: [], payments: [payment(), payment({ id: "p2", status: "failed", paidAt: null })], notices: [notice()] }), NOW);
    expect(plan.filter((a) => a.payload !== null)).toEqual([]);
    expect(plan.map((a) => a.key).sort()).toEqual([noticeKey("n1"), paymentKey("p1"), paymentKey("p2"), SEEDED_KEY].sort());
    expect(plan.find((a) => a.key === SEEDED_KEY)?.state).toBe("yes");
  });
  it("marks itself seeded even when there is nothing yet", () => {
    expect(planActivityAlerts(input({ previous: [] }), NOW)).toEqual([{ key: SEEDED_KEY, state: "yes", payload: null, at: "" }]);
  });
});

describe("payments", () => {
  it("announces a paid payment once", () => {
    const plan = planActivityAlerts(input({ payments: [payment()] }), NOW);
    expect(plan).toHaveLength(1);
    expect(first(plan)).toMatchObject({ key: "payment:p1", state: "paid", payload: { title: "Payment received: Acme Bakery", body: "$49.00", url: "/clients/c1", tag: "payment-p1" } });
    expect(planActivityAlerts(input({ payments: [payment()], previous: [...seededState, { key: "payment:p1", state: "paid" }] }), NOW)).toEqual([]);
  });
  it("records an old payment that Sync from Stripe just filled in, without a push", () => {
    const plan = planActivityAlerts(input({ payments: [payment({ createdAt: hoursAgo(0), paidAt: hoursAgo(24 * 30) })] }), NOW);
    expect(plan).toEqual([{ key: "payment:p1", state: "paid", payload: null, at: hoursAgo(24 * 30) }]);
  });
  it("announces a failed payment, with the amount", () => {
    const plan = planActivityAlerts(input({ payments: [payment({ status: "failed", amount: 99.5, paidAt: null })] }), NOW);
    expect(first(plan).payload?.title).toBe("Payment failed: Acme Bakery");
    expect(first(plan).payload?.body).toBe("$99.50 did not go through. Follow up.");
  });
  it("announces both stages when a failed payment is later paid", () => {
    const failedBefore = [...seededState, { key: "payment:p1", state: "failed" }];
    const plan = planActivityAlerts(input({ payments: [payment({ status: "paid" })], previous: failedBefore }), NOW);
    expect(plan).toHaveLength(1);
    expect(first(plan)).toMatchObject({ state: "paid" });
    expect(first(plan).payload?.title).toBe("Payment received: Acme Bakery");
  });
  it("records a failed payment silently for a client on hold or archived, and still announces a paid one", () => {
    for (const over of [{ onHold: true }, { archived: true }]) {
      const failed = planActivityAlerts(input({ clients: { c1: client(over) }, payments: [payment({ status: "failed", paidAt: null })] }), NOW);
      expect(failed).toEqual([{ key: "payment:p1", state: "failed", payload: null, at: expect.any(String) }]);
      const paid = planActivityAlerts(input({ clients: { c1: client(over) }, payments: [payment()] }), NOW);
      expect(first(paid).payload?.title).toBe("Payment received: Acme Bakery");
    }
  });
  it("ignores pending and unknown statuses", () => {
    expect(planActivityAlerts(input({ payments: [payment({ status: "pending" }), payment({ id: "p9", status: "refunded" })] }), NOW)).toEqual([]);
  });
  it("announces an unassigned payment (no client attached) with the amount, and never a failed one", () => {
    const plan = planActivityAlerts(input({ clients: {}, payments: [payment({ id: "p9", clientId: null, amount: 0.5 })] }), NOW);
    expect(first(plan).payload).toMatchObject({ title: "Payment received: $0.50 (no client attached)", url: "/", tag: "payment-p9" });
    expect(first(plan).payload?.body).toContain("Open Stripe to see who paid");
    const failed = planActivityAlerts(input({ clients: {}, payments: [payment({ id: "p10", clientId: null, status: "failed", paidAt: null })] }), NOW);
    expect(failed).toEqual([{ key: "payment:p10", state: "failed", payload: null, at: expect.any(String) }]);
  });
  it("copes with a client id it cannot find", () => {
    const plan = planActivityAlerts(input({ clients: {}, payments: [payment({ clientId: "gone" })] }), NOW);
    expect(first(plan).payload).toMatchObject({ title: "Payment received: A client", url: "/clients/gone" });
  });
});

describe("client requests and comments", () => {
  it("announces a new request once, linking to it", () => {
    const plan = planActivityAlerts(input({ notices: [notice()] }), NOW);
    expect(first(plan)).toMatchObject({
      key: "notif:n1",
      state: "sent",
      payload: { title: "New request: Acme Bakery", body: "LUM-1052 Update opening hours", url: "/work?view=requests&request=r1", tag: "request-r1" },
    });
    expect(planActivityAlerts(input({ notices: [notice()], previous: [...seededState, { key: "notif:n1", state: "sent" }] }), NOW)).toEqual([]);
  });
  it("announces a new comment without the comment text", () => {
    const plan = planActivityAlerts(input({ notices: [notice({ id: "n2", type: "new_comment" })] }), NOW);
    expect(first(plan).payload).toMatchObject({ title: "New comment: Acme Bakery", body: "On LUM-1052 Update opening hours", tag: "comment-n2" });
  });
  it("records a notification already marked read without a push", () => {
    expect(planActivityAlerts(input({ notices: [notice({ read: true })] }), NOW)).toEqual([{ key: "notif:n1", state: "sent", payload: null, at: expect.any(String) }]);
  });
  it("ignores other notification types", () => {
    expect(planActivityAlerts(input({ notices: [notice({ type: "something_else" })] }), NOW)).toEqual([]);
  });
  it("copes with a missing request", () => {
    const plan = planActivityAlerts(input({ requests: {}, notices: [notice()] }), NOW);
    expect(first(plan).payload?.body).toBe("a request");
  });
});

describe("ordering and the per-run cap", () => {
  it("sends the oldest first", () => {
    const plan = planActivityAlerts(input({ payments: [payment({ id: "late", paidAt: hoursAgo(1) }), payment({ id: "early", paidAt: hoursAgo(5) })] }), NOW);
    expect(plan.map((a) => a.key)).toEqual(["payment:early", "payment:late"]);
  });
  it("sends at most the cap in one run and leaves the rest unrecorded for the next run", () => {
    const many = Array.from({ length: MAX_SENDS_PER_RUN + 5 }, (_, i) => payment({ id: `p${i}`, paidAt: hoursAgo(100 - i) }));
    const plan = planActivityAlerts(input({ payments: many }), NOW);
    expect(plan.filter((a) => a.payload)).toHaveLength(MAX_SENDS_PER_RUN);
    expect(plan.map((a) => a.key)).not.toContain(`payment:p${MAX_SENDS_PER_RUN + 4}`);
  });
});
