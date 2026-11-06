import { describe, expect, it } from "vitest";
import {
  actionKey,
  anniversaryDayOf,
  billingHealth,
  cyclesToCreate,
  invoiceHref,
  matchPayment,
  milestonesFor,
  nextRenewal,
  planCycles,
  renewalDate,
  renewalOnOrAfter,
  pickRenewalSubscription,
  scheduleFromStripe,
  syncSchedulesFromStripe,
  taskTitle,
} from "./rules";
import type { MoneySubscription } from "@/platform/stripe/money-api";
import type { Action, Cycle, PlannerAgreement, VerifiedPayment } from "./types";

const agreement = (over: Partial<PlannerAgreement> = {}): PlannerAgreement => ({
  id: "ag1",
  clientId: "c1",
  planName: "Essential",
  monthlyPriceCents: 3500,
  anniversaryDay: 12,
  startsOn: "2026-01-12",
  status: "active",
  invoiceSender: "luminate",
  paymentLinkUrl: null,
  tasksFrom: "2026-01-01",
  source: "manual",
  stripeSubscriptionId: null,
  clientArchived: false,
  clientPaused: false,
  ...over,
});

let n = 0;
const cycle = (over: Partial<Cycle & { paymentRef: string | null }> = {}): Cycle & { paymentRef: string | null } => ({
  id: `cy${++n}`,
  agreementId: "ag1",
  clientId: "c1",
  dueOn: "2026-11-12",
  amountCents: 3500,
  planName: "Essential",
  invoiceSender: "luminate",
  status: "open",
  paidAt: null,
  invoiceSentAt: null,
  reminderSentAt: null,
  paymentRef: null,
  ...over,
});
const action = (cy: Cycle, milestone: Action["milestone"], over: Partial<Action> = {}): Action => ({
  id: `ac-${cy.id}-${milestone}`,
  cycleId: cy.id,
  clientId: cy.clientId,
  milestone,
  dueOn: cy.dueOn,
  actionKey: actionKey(cy.clientId, cy.dueOn, milestone),
  status: "open",
  workItemId: "w1",
  workItemCompleted: false,
  ...over,
});
const pay = (over: Partial<VerifiedPayment> = {}): VerifiedPayment => ({ id: "p1", clientId: "c1", amountCents: 3500, paidAt: "2026-11-12T15:00:00Z", eventType: "subscription", ...over });
const milestones = (plan: ReturnType<typeof planCycles>) => plan.newActions.map((a) => `${a.milestone}@${a.dueOn}`);

describe("renewal dates", () => {
  it("keeps the anniversary day, and uses the last day of shorter months", () => {
    expect(renewalDate(2026, 4, 31)).toBe("2026-04-30");
    expect(renewalDate(2027, 2, 30)).toBe("2027-02-28");
    expect(renewalDate(2028, 2, 29)).toBe("2028-02-29");
    expect(renewalDate(2026, 3, 15)).toBe("2026-03-15");
  });
  it("returns to the real anniversary after a short month (Feb 28 is followed by Mar 31)", () => {
    expect(nextRenewal("2027-02-28", 31)).toBe("2027-03-31");
    expect(nextRenewal("2026-04-30", 31)).toBe("2026-05-31");
  });
  it("crosses the year boundary", () => {
    expect(nextRenewal("2026-12-31", 31)).toBe("2027-01-31");
    expect(renewalDate(2026, 13, 5)).toBe("2027-01-05");
    expect(renewalDate(2027, 0, 5)).toBe("2026-12-05");
    expect(renewalOnOrAfter("2026-12-20", 5)).toBe("2027-01-05");
    expect(renewalOnOrAfter("2026-12-05", 5)).toBe("2026-12-05");
  });
  it("suggests the anniversary day from a date", () => {
    expect(anniversaryDayOf("2026-11-30")).toBe(30);
    expect(anniversaryDayOf(null)).toBeNull();
  });
});

describe("milestones", () => {
  it("has no 'send invoice' task when Stripe sends the invoice or charges autopay (one sender only)", () => {
    expect(milestonesFor("luminate").map((m) => m.offset)).toEqual([-5, 0, 3, 7]);
    expect(milestonesFor("stripe_invoice").map((m) => m.milestone)).toEqual(["verify_payment", "friendly_reminder", "grace_review"]);
    expect(milestonesFor("stripe_autopay").map((m) => m.milestone)).toEqual(["verify_payment", "friendly_reminder", "grace_review"]);
  });
  it("has stable keys and plain titles", () => {
    expect(actionKey("c1", "2026-11-12", "verify_payment")).toBe("billing:c1:2026-11-12:verify_payment");
    expect(taskTitle("friendly_reminder", 4900, "2026-11-12")).toBe("Send friendly payment reminder ($49.00, renews Nov 12)");
  });
});

describe("cyclesToCreate", () => {
  it("creates the cycle on Day -5, not before", () => {
    const fresh = agreement({ tasksFrom: "2026-11-01" });
    expect(cyclesToCreate("2026-11-06", [fresh], [])).toEqual([]);
    expect(cyclesToCreate("2026-11-07", [fresh], [])).toEqual([
      { agreementId: "ag1", clientId: "c1", dueOn: "2026-11-12", amountCents: 3500, planName: "Essential", invoiceSender: "luminate" },
    ]);
  });
  it("never creates the same cycle twice (retries, overlapping runs)", () => {
    const first = cyclesToCreate("2026-11-07", [agreement()], []);
    expect(first.length).toBeGreaterThan(0);
    expect(cyclesToCreate("2026-11-07", [agreement()], first)).toEqual([]);
  });
  it("catches up missed runs: every renewal missed is still created", () => {
    const made = cyclesToCreate("2026-12-20", [agreement({ tasksFrom: "2026-10-01" })], []).map((c) => c.dueOn);
    expect(made).toEqual(["2026-10-12", "2026-11-12", "2026-12-12"]);
    // Beyond the 75-day lookback a missed renewal is not created any more.
    expect(cyclesToCreate("2027-01-08", [agreement({ tasksFrom: "2026-10-01" })], []).map((c) => c.dueOn)).toEqual(["2026-11-12", "2026-12-12", "2027-01-12"]);
  });
  it("crosses the year: a Jan 2 renewal is created on Dec 28", () => {
    expect(cyclesToCreate("2026-12-28", [agreement({ anniversaryDay: 2 })], []).map((c) => c.dueOn)).toContain("2027-01-02");
  });
  it("handles the 31st in a short month", () => {
    expect(cyclesToCreate("2027-02-23", [agreement({ anniversaryDay: 31, tasksFrom: "2027-02-20" })], []).map((c) => c.dueOn)).toEqual(["2027-02-28"]);
  });
  it("starts no earlier than the plan's start and the day the schedule was entered", () => {
    expect(cyclesToCreate("2026-11-07", [agreement({ startsOn: "2026-12-01" })], [])).toEqual([]);
    // Entered on Nov 25: the Nov 12 renewal's last milestone (Nov 19) was already past, so it is not created.
    expect(cyclesToCreate("2026-11-25", [agreement({ tasksFrom: "2026-11-25" })], [])).toEqual([]);
    expect(cyclesToCreate("2026-11-18", [agreement({ tasksFrom: "2026-11-18" })], []).map((c) => c.dueOn)).toEqual(["2026-11-12"]);
  });
  it("creates nothing for paused or cancelled plans, archived clients or ended Stripe subscriptions", () => {
    for (const a of [agreement({ status: "paused" }), agreement({ status: "cancelled" }), agreement({ clientArchived: true }), agreement({ clientPaused: true })]) {
      expect(cyclesToCreate("2026-11-12", [a], [])).toEqual([]);
    }
  });
  it("copies the amount at creation: a later price change does not touch existing cycles", () => {
    const [c] = cyclesToCreate("2026-11-07", [agreement({ monthlyPriceCents: 4900, tasksFrom: "2026-11-01" })], []);
    expect(c?.amountCents).toBe(4900);
  });
});

describe("matchPayment", () => {
  const cy = cycle();
  it("takes a subscription payment from 7 days before the renewal to 7 days before the next", () => {
    expect(matchPayment(cy, 12, [pay({ paidAt: "2026-11-05T15:00:00Z" })], new Set())?.id).toBe("p1");
    expect(matchPayment(cy, 12, [pay({ paidAt: "2026-11-04T15:00:00Z" })], new Set())).toBeNull();
    expect(matchPayment(cy, 12, [pay({ paidAt: "2026-12-04T15:00:00Z" })], new Set())?.id).toBe("p1");
    expect(matchPayment(cy, 12, [pay({ paidAt: "2026-12-05T15:00:00Z" })], new Set())).toBeNull();
  });
  it("uses the New York date of the payment", () => {
    // 01:00 UTC on Nov 5 is still Nov 4 in New York: too early.
    expect(matchPayment(cy, 12, [pay({ paidAt: "2026-11-05T01:00:00Z" })], new Set())).toBeNull();
  });
  it("ignores a one-off payment of another amount, but takes one of exactly the renewal amount", () => {
    expect(matchPayment(cy, 12, [pay({ eventType: "one_time", amountCents: 150000 })], new Set())).toBeNull();
    expect(matchPayment(cy, 12, [pay({ eventType: "one_time", amountCents: 3500 })], new Set())?.id).toBe("p1");
  });
  it("never uses one payment for two renewals, nor another client's", () => {
    expect(matchPayment(cy, 12, [pay()], new Set(["p1"]))).toBeNull();
    expect(matchPayment(cy, 12, [pay({ clientId: "c2" })], new Set())).toBeNull();
  });
});

describe("planCycles", () => {
  it("creates the milestones that are due, one at a time, for an unpaid renewal", () => {
    const cy = cycle();
    expect(milestones(planCycles("2026-11-07", [agreement()], [cy], [], []))).toEqual(["send_invoice@2026-11-07"]);
    expect(milestones(planCycles("2026-11-12", [agreement()], [cy], [action(cy, "send_invoice")], []))).toEqual(["verify_payment@2026-11-12"]);
    expect(milestones(planCycles("2026-11-19", [agreement()], [cy], [action(cy, "send_invoice"), action(cy, "verify_payment"), action(cy, "friendly_reminder")], []))).toEqual(["grace_review@2026-11-19"]);
  });
  it("is idempotent: the same data a second time plans nothing new", () => {
    const cy = cycle();
    const all = (["send_invoice", "verify_payment", "friendly_reminder", "grace_review"] as const).map((m) => action(cy, m));
    expect(planCycles("2026-11-30", [agreement()], [cy], all, [])).toEqual({ pay: [], cancelCycles: [], newActions: [], closeActions: [] });
  });
  it("after missed runs, creates every milestone that is due and keeps the overdue ones", () => {
    const cy = cycle();
    expect(milestones(planCycles("2026-11-20", [agreement()], [cy], [], []))).toEqual([
      "send_invoice@2026-11-07",
      "verify_payment@2026-11-12",
      "friendly_reminder@2026-11-15",
      "grace_review@2026-11-19",
    ]);
  });
  it("skips 'send invoice' once marked sent, and the reminder once marked sent", () => {
    const cy = cycle({ invoiceSentAt: "2026-11-06T15:00:00Z", reminderSentAt: "2026-11-14T15:00:00Z" });
    expect(milestones(planCycles("2026-11-16", [agreement()], [cy], [], []))).toEqual(["verify_payment@2026-11-12"]);
  });
  it("has no 'send invoice' task for Stripe-sent renewals", () => {
    const cy = cycle({ invoiceSender: "stripe_autopay" });
    expect(milestones(planCycles("2026-11-12", [agreement({ invoiceSender: "stripe_autopay" })], [cy], [], []))).toEqual(["verify_payment@2026-11-12"]);
  });
  it("paid: settles the renewal from a verified payment and closes its open reminders", () => {
    const cy = cycle();
    const open = [action(cy, "send_invoice", { status: "done" }), action(cy, "verify_payment"), action(cy, "friendly_reminder")];
    const plan = planCycles("2026-11-16", [agreement()], [cy], open, [pay({ paidAt: "2026-11-14T15:00:00Z" })]);
    expect(plan.pay).toEqual([{ cycleId: cy.id, paymentId: "p1", paidAt: "2026-11-14T15:00:00Z" }]);
    expect(plan.closeActions).toEqual([
      { actionId: open[1]!.id, status: "resolved", outcome: "payment_confirmed" },
      { actionId: open[2]!.id, status: "resolved", outcome: "payment_confirmed" },
    ]);
    expect(plan.newActions).toEqual([]);
  });
  it("unpaid then paid: once settled, no later milestone is created", () => {
    const cy = cycle({ status: "paid", paidAt: "2026-11-14T15:00:00Z", paymentRef: "p1" });
    expect(planCycles("2026-11-25", [agreement()], [cy], [], [pay()]).newActions).toEqual([]);
  });
  it("a manually recorded payment settles it the same way", () => {
    const cy = cycle({ status: "paid_manual" });
    const plan = planCycles("2026-11-20", [agreement()], [cy], [action(cy, "grace_review")], []);
    expect(plan.closeActions).toEqual([{ actionId: `ac-${cy.id}-grace_review`, status: "resolved", outcome: "payment_confirmed" }]);
    expect(plan.newActions).toEqual([]);
  });
  it("matches payments to renewals in date order, one payment each", () => {
    const oct = cycle({ dueOn: "2026-10-12" });
    const nov = cycle({ dueOn: "2026-11-12" });
    const plan = planCycles("2026-11-13", [agreement()], [nov, oct], [], [pay({ id: "p-oct", paidAt: "2026-10-12T15:00:00Z" })]);
    expect(plan.pay.map((p) => [p.cycleId, p.paymentId])).toEqual([[oct.id, "p-oct"]]);
    expect(plan.newActions.every((a) => a.cycleId === nov.id)).toBe(true);
  });
  it("paused plan or archived client: cancels open billing tasks and creates no more", () => {
    const cy = cycle();
    const plan = planCycles("2026-11-20", [agreement({ status: "paused" })], [cy], [action(cy, "verify_payment")], []);
    expect(plan.closeActions).toEqual([{ actionId: `ac-${cy.id}-verify_payment`, status: "cancelled", outcome: "plan_paused" }]);
    expect(plan.newActions).toEqual([]);
    expect(planCycles("2026-11-20", [agreement({ clientArchived: true })], [cy], [action(cy, "verify_payment")], []).closeActions[0]?.outcome).toBe("client_archived");
  });
  it("cancelled plan: cancels open tasks; a renewal not reached yet is cancelled, one already due stays owed", () => {
    const due = cycle({ dueOn: "2026-11-12" });
    const future = cycle({ dueOn: "2026-12-12" });
    const plan = planCycles("2026-12-08", [agreement({ status: "cancelled" })], [due, future], [action(due, "grace_review"), action(future, "send_invoice")], []);
    expect(plan.cancelCycles).toEqual([{ cycleId: future.id, reason: "plan cancelled" }]);
    expect(plan.closeActions.map((c) => c.outcome)).toEqual(["plan_cancelled", "plan_cancelled"]);
  });
  it("manual completion: a task ticked off on the Work page counts as done", () => {
    const cy = cycle();
    const plan = planCycles("2026-11-12", [agreement()], [cy], [action(cy, "send_invoice", { workItemCompleted: true }), action(cy, "verify_payment")], []);
    expect(plan.closeActions).toEqual([{ actionId: `ac-${cy.id}-send_invoice`, status: "done", outcome: "completed_in_work" }]);
  });
});

describe("links and health", () => {
  it("opens the sent link, else the plan's payment link, else the Stripe customer", () => {
    expect(invoiceHref("https://invoice.stripe.com/i/x", "https://buy.stripe.com/y", "cus_1")).toBe("https://invoice.stripe.com/i/x");
    expect(invoiceHref(null, "https://buy.stripe.com/y", "cus_1")).toBe("https://buy.stripe.com/y");
    expect(invoiceHref(null, null, "cus_1")).toBe("https://dashboard.stripe.com/customers/cus_1");
    expect(invoiceHref(null, null, "bad id")).toBeNull();
  });
  it("shows a failing, stale or missing job", () => {
    const now = new Date("2026-11-12T15:00:00Z");
    const job = { exists: true, enabled: true, lastSuccessAt: "2026-11-12T14:05:00Z", lastRunFailed: false };
    expect(billingHealth(job, now).state).toBe("ok");
    expect(billingHealth({ ...job, lastSuccessAt: "2026-11-12T11:00:00Z" }, now).state).toBe("stale");
    expect(billingHealth({ ...job, lastRunFailed: true }, now).state).toBe("failing");
    expect(billingHealth({ ...job, lastSuccessAt: null }, now).state).toBe("never");
    expect(billingHealth({ ...job, exists: false }, now).state).toBe("not_set_up");
  });
});

describe("schedules from Stripe", () => {
  const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  const sub = (over: Partial<MoneySubscription> = {}): MoneySubscription => ({
    id: "sub_1",
    customerId: "cus_1",
    customerName: null,
    status: "active",
    collectionMethod: "charge_automatically",
    periodCents: 3500,
    monthlyCents: 3500,
    nextBillingAt: sec("2026-11-12T18:00:00Z"),
    cancelAtPeriodEnd: false,
    paused: false,
    pauseResumesAt: null,
    currentPeriodPaid: true,
    billingCycleAnchor: sec("2026-01-12T18:00:00Z"),
    startDate: sec("2026-01-12T18:00:00Z"),
    ...over,
  });
  const client = { id: "c1", stripeCustomerId: "cus_1", archived: false };
  const stripeAgreement = (over: Partial<PlannerAgreement> = {}) => agreement({ source: "stripe", stripeSubscriptionId: "sub_1", invoiceSender: "stripe_autopay", ...over });

  it("takes the renewal day from Stripe's billing anchor, and the sender from how Stripe collects", () => {
    expect(scheduleFromStripe("c1", sub())).toEqual({ clientId: "c1", stripeSubscriptionId: "sub_1", monthlyPriceCents: 3500, anniversaryDay: 12, startsOn: "2026-01-12", invoiceSender: "stripe_autopay", status: "active" });
    expect(scheduleFromStripe("c1", sub({ collectionMethod: "send_invoice" })).invoiceSender).toBe("stripe_invoice");
    expect(scheduleFromStripe("c1", sub({ billingCycleAnchor: sec("2026-01-31T18:00:00Z") })).anniversaryDay).toBe(31);
    expect(scheduleFromStripe("c1", sub({ paused: true })).status).toBe("paused");
  });
  it("follows the live subscription, never a canceled or never-paid one", () => {
    expect(pickRenewalSubscription([sub({ id: "sub_old", status: "canceled" }), sub({ id: "sub_new" })])?.id).toBe("sub_new");
    expect(pickRenewalSubscription([sub({ status: "incomplete_expired" }), sub({ status: "incomplete" })])).toBeNull();
    expect(pickRenewalSubscription([sub({ id: "p", paused: true }), sub({ id: "a" })])?.id).toBe("a");
    expect(pickRenewalSubscription([sub({ monthlyCents: 0 })])).toBeNull();
  });
  it("creates a schedule for a client with a live subscription", () => {
    expect(syncSchedulesFromStripe([sub()], [client], [])).toEqual({ create: [scheduleFromStripe("c1", sub())], update: [], cancel: [] });
  });
  it("updates price, day, sender and paused state from Stripe; nothing when already in step", () => {
    const current = stripeAgreement({ anniversaryDay: 12, startsOn: "2026-01-12", monthlyPriceCents: 3500 });
    expect(syncSchedulesFromStripe([sub()], [client], [current])).toEqual({ create: [], update: [], cancel: [] });
    const changed = syncSchedulesFromStripe([sub({ monthlyCents: 4900, paused: true })], [client], [current]);
    expect(changed.update).toEqual([{ agreementId: "ag1", patch: { monthlyPriceCents: 4900, status: "paused" }, resumed: false }]);
    expect(syncSchedulesFromStripe([sub()], [client], [stripeAgreement({ status: "paused", startsOn: "2026-01-12" })]).update[0]).toMatchObject({ resumed: true, patch: { status: "active" } });
  });
  it("cancels the schedule when the subscription ends", () => {
    expect(syncSchedulesFromStripe([sub({ status: "canceled" })], [client], [stripeAgreement()]).cancel).toEqual(["ag1"]);
    expect(syncSchedulesFromStripe([], [client], [stripeAgreement()]).cancel).toEqual(["ag1"]);
  });
  it("never touches a schedule managed by hand, an archived client, or a client with no Stripe customer", () => {
    expect(syncSchedulesFromStripe([], [client], [agreement({ source: "manual" })])).toEqual({ create: [], update: [], cancel: [] });
    expect(syncSchedulesFromStripe([sub()], [{ ...client, archived: true }], [])).toEqual({ create: [], update: [], cancel: [] });
    expect(syncSchedulesFromStripe([sub()], [{ ...client, stripeCustomerId: null }], [])).toEqual({ create: [], update: [], cancel: [] });
  });
});
