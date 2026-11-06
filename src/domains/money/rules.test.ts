import { describe, expect, it } from "vitest";
import type { MoneyInvoice, MoneySubscription } from "@/platform/stripe/money-api";
import { buildMoneyOverview, daysPastDue, invoiceBucket, money, monthlyCentsOf, shortDate, type MoneyInput } from "./rules";
import type { MoneyClient } from "./types";

const TZ = "America/New_York";
// Friday 6 November 2026, 10:00 in New York.
const NOW = new Date("2026-11-06T15:00:00Z");
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

const sub = (over: Partial<MoneySubscription> = {}): MoneySubscription => ({
  id: "sub_1",
  customerId: "cus_1",
  customerName: "Stripe Name",
  status: "active",
  collectionMethod: "charge_automatically",
  periodCents: 9900,
  monthlyCents: 9900,
  nextBillingAt: sec("2026-11-20T15:00:00Z"),
  cancelAtPeriodEnd: false,
  paused: false,
  pauseResumesAt: null,
  currentPeriodPaid: true,
  billingCycleAnchor: null,
  startDate: null,
  ...over,
});
const inv = (over: Partial<MoneyInvoice> = {}): MoneyInvoice => ({
  id: "in_1",
  customerId: "cus_1",
  customerName: "Stripe Name",
  amountRemainingCents: 4900,
  collectionMethod: "charge_automatically",
  dueAt: sec("2026-11-03T15:00:00Z"),
  attemptCount: 1,
  number: "ABC-0001",
  ...over,
});
const client = (over: Partial<MoneyClient> = {}): MoneyClient => ({ id: "c1", name: "Kessler Law Group", stripeCustomerId: "cus_1", status: "active", subscriptionPrice: 99, archived: false, ...over });

function build(over: Partial<MoneyInput> = {}) {
  return buildMoneyOverview({ now: NOW, timeZone: TZ, payments: [], clients: [client()], stripeState: "live", subscriptions: [], invoices: [], lastEventAt: null, ...over });
}

describe("small rules", () => {
  it("normalises prices to a month", () => {
    expect(monthlyCentsOf(12000, { interval: "year" })).toBe(1000);
    expect(monthlyCentsOf(3500, { interval: "month" })).toBe(3500);
    expect(monthlyCentsOf(9000, { interval: "month", interval_count: 3 })).toBe(3000);
    expect(monthlyCentsOf(1000, null)).toBe(0);
  });
  it("counts days past due in the business time zone", () => {
    // 23:30 New York on Nov 5 is already Nov 6 in UTC: still day 1, not day 0.
    expect(daysPastDue(sec("2026-11-06T03:30:00Z"), NOW, TZ)).toBe(1);
    expect(daysPastDue(sec("2026-11-06T14:00:00Z"), NOW, TZ)).toBe(0);
    expect(daysPastDue(sec("2026-11-08T14:00:00Z"), NOW, TZ)).toBe(-2);
  });
  it("puts days 0–7 in grace and day 8 on past due (the late-payment ladder)", () => {
    expect(invoiceBucket(-1)).toBe("upcoming");
    expect(invoiceBucket(0)).toBe("grace");
    expect(invoiceBucket(7)).toBe("grace");
    expect(invoiceBucket(8)).toBe("past_due");
  });
  it("formats dates and money", () => {
    expect(shortDate("2026-11-06")).toBe("Fri, Nov 6");
    expect(money(128400)).toBe("$1,284");
    expect(money(9900, true)).toBe("$99.00");
  });
});

describe("collected", () => {
  it("sums paid payments by local month, unassigned included, and keeps last month apart", () => {
    const o = build({
      payments: [
        { amount: 99, paid_at: "2026-11-02T12:00:00Z" },
        { amount: 0.5, paid_at: "2026-11-05T12:00:00Z" },
        // 23:00 New York on Oct 31 is Nov 1 in UTC: October money.
        { amount: 35, paid_at: "2026-11-01T03:00:00Z" },
        { amount: 1000, paid_at: "2026-09-30T12:00:00Z" },
        { amount: 5, paid_at: null },
      ],
    });
    expect(o.collected).toEqual({ cents: 9950, monthShort: "Nov", range: "Nov 1–6" });
    expect(o.lastMonth).toEqual({ cents: 3500, monthName: "October" });
    expect(o.goal).toMatchObject({ cents: 1_000_000, percent: 1 });
  });
  it("still shows collected when Stripe is unavailable, and nothing it would have to guess", () => {
    const o = build({ stripeState: "unavailable", payments: [{ amount: 10, paid_at: "2026-11-02T12:00:00Z" }], subscriptions: [sub()] });
    expect(o.collected.cents).toBe(1000);
    expect(o).toMatchObject({ stripe: "unavailable", mrr: null, pastDue: null, grace: null, paused: null, upcoming: null, attention: null });
    expect(o.goal.mrrPercent).toBeNull();
  });
});

describe("MRR (paid-only)", () => {
  it("counts only live subscriptions whose current invoice is paid, monthly, never paused ones", () => {
    const o = build({
      subscriptions: [
        sub({ id: "a", monthlyCents: 9900 }),
        sub({ id: "b", monthlyCents: 3500, currentPeriodPaid: false }),
        sub({ id: "c", monthlyCents: 3500, paused: true }),
        sub({ id: "d", monthlyCents: 1000, status: "incomplete" }),
        sub({ id: "e", monthlyCents: 4900, status: "past_due" }),
      ],
    });
    expect(o.mrr).toEqual({ cents: 14800, subscriptions: 2 });
    expect(o.goal.mrrPercent).toBe(1);
  });
});

describe("upcoming payments", () => {
  it("lists renewals and not-yet-due invoices in the next 14 days, by date, named after the client", () => {
    const o = build({
      clients: [client(), client({ id: "c2", name: "Lakeside Pediatrics", stripeCustomerId: "cus_2" })],
      subscriptions: [
        sub({ id: "s_far", nextBillingAt: sec("2026-12-01T15:00:00Z") }),
        sub({ id: "s_auto", nextBillingAt: sec("2026-11-15T15:00:00Z") }),
        sub({ id: "s_inv", customerId: "cus_2", collectionMethod: "send_invoice", periodCents: 3500, nextBillingAt: sec("2026-11-08T15:00:00Z") }),
        sub({ id: "s_ending", cancelAtPeriodEnd: true, nextBillingAt: sec("2026-11-09T15:00:00Z") }),
        sub({ id: "s_paused", paused: true, nextBillingAt: sec("2026-11-09T15:00:00Z") }),
      ],
      invoices: [inv({ id: "in_soon", customerId: "cus_9", customerName: "Corner Loaf Bakery", collectionMethod: "send_invoice", attemptCount: 0, dueAt: sec("2026-11-12T15:00:00Z"), amountRemainingCents: 3500 })],
    });
    expect(o.upcoming).toEqual([
      { key: "s_inv", name: "Lakeside Pediatrics", clientId: "c2", date: "2026-11-08", kind: "invoice", cents: 3500 },
      { key: "in_soon", name: "Corner Loaf Bakery", clientId: null, date: "2026-11-12", kind: "invoice", cents: 3500 },
      { key: "s_auto", name: "Kessler Law Group", clientId: "c1", date: "2026-11-15", kind: "autopay", cents: 9900 },
    ]);
  });
});

describe("needs attention", () => {
  it("splits open invoices into grace and past due, with plain details and account counts", () => {
    const o = build({
      clients: [client({ id: "c1", name: "Northside Physio" }), client({ id: "c2", name: "Oak & Ember Coffee", stripeCustomerId: "cus_2" })],
      invoices: [
        inv({ id: "in_grace", dueAt: sec("2026-11-03T15:00:00Z"), amountRemainingCents: 4900 }),
        inv({ id: "in_late", customerId: "cus_2", collectionMethod: "send_invoice", attemptCount: 0, dueAt: sec("2026-10-21T15:00:00Z"), amountRemainingCents: 3500, number: "OE-7" }),
        inv({ id: "in_zero", amountRemainingCents: 0 }),
      ],
    });
    expect(o.pastDue).toEqual({ cents: 3500, accounts: 1 });
    expect(o.grace).toEqual({ cents: 4900, accounts: 1, day: 3 });
    expect(o.attention).toEqual([
      { key: "in_late", name: "Oak & Ember Coffee", clientId: "c2", kind: "past_due", cents: 3500, detail: "Unpaid 16 days · invoice OE-7" },
      { key: "in_grace", name: "Northside Physio", clientId: "c1", kind: "grace", cents: 4900, detail: "Autopay failed Nov 3 · counts as unpaid · day 3 of 7" },
    ]);
  });
  it("shows no single grace day when several accounts are in grace", () => {
    const o = build({ invoices: [inv({ id: "a" }), inv({ id: "b", customerId: "cus_2", dueAt: sec("2026-11-05T15:00:00Z") })] });
    expect(o.grace).toMatchObject({ accounts: 2, day: null, cents: 9800 });
  });
  it("lists paused subscriptions and clients whose subscription ended, never in MRR", () => {
    const o = build({
      clients: [
        client({ id: "c1", name: "Willow & Thread" }),
        client({ id: "c2", name: "Ended Co", stripeCustomerId: "cus_2", status: "paused", subscriptionPrice: 49 }),
        client({ id: "c3", name: "Archived Co", stripeCustomerId: "cus_3", status: "paused", archived: true }),
      ],
      subscriptions: [sub({ paused: true, monthlyCents: 3500, pauseResumesAt: sec("2027-01-05T15:00:00Z") })],
    });
    expect(o.mrr?.cents).toBe(0);
    expect(o.paused).toEqual({ cents: 8400, accounts: 2 });
    expect(o.attention?.map((a) => [a.name, a.detail])).toEqual([
      ["Ended Co", "Subscription ended in Stripe · billing paused"],
      ["Willow & Thread", "Subscription paused until January"],
    ]);
  });
  it("names a customer that is not a client by Stripe's name, and prefers an active client to an archived one", () => {
    const o = build({
      clients: [client({ id: "old", name: "Old Name", archived: true }), client({ id: "new", name: "New Name" })],
      invoices: [inv(), inv({ id: "in_x", customerId: "cus_x", customerName: null })],
    });
    expect(o.attention?.map((a) => [a.name, a.clientId])).toEqual([
      ["New Name", "new"],
      ["Stripe customer (no client)", null],
    ]);
  });
});
