import { describe, expect, it } from "vitest";
import {
  backfillPatch,
  clientUpdateAfterPayment,
  currentSchedulePhase,
  customerIdOf,
  failedRevenueFields,
  getInvoiceSubscriptionId,
  HANDLED_EVENT_TYPES,
  ignoreTestModeEvent,
  isHandledEventType,
  isLiveSubscription,
  isUniqueViolation,
  ledgerDecision,
  newClientFields,
  nextBillingDate,
  paidRevenueFields,
  phasePriceRef,
  phaseStartDate,
  restoreAfterStaleFailure,
  STALE_PROCESSING_MS,
  subscriptionFields,
} from "./rules";

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("event types", () => {
  it("handles exactly the old webhook's 12 types (14 deliveries incl. the paid pair and schedule events)", () => {
    expect([...HANDLED_EVENT_TYPES].sort()).toEqual(
      [
        "charge.succeeded",
        "customer.created",
        "customer.deleted",
        "customer.subscription.created",
        "customer.subscription.deleted",
        "customer.subscription.updated",
        "customer.updated",
        "invoice.paid",
        "invoice.payment_failed",
        "invoice.payment_succeeded",
        "subscription_schedule.created",
        "subscription_schedule.updated",
      ].sort(),
    );
    expect(isHandledEventType("invoice.created")).toBe(false);
    expect(isHandledEventType("invoice.paid")).toBe(true);
  });
});

describe("nextBillingDate (all UTC)", () => {
  it("is this month's billing day when still ahead, else next month's", () => {
    const anchor = sec("2026-01-20T05:00:00Z");
    expect(nextBillingDate(anchor, new Date("2026-11-06T12:00:00Z"))).toBe("2026-11-20");
    expect(nextBillingDate(anchor, new Date("2026-11-25T12:00:00Z"))).toBe("2026-12-20");
  });
  it("uses the last day of a shorter month instead of spilling into the next one", () => {
    const the31st = sec("2026-01-31T12:00:00Z");
    expect(nextBillingDate(the31st, new Date("2027-02-10T00:00:00Z"))).toBe("2027-02-28");
    expect(nextBillingDate(the31st, new Date("2028-02-10T00:00:00Z"))).toBe("2028-02-29");
    expect(nextBillingDate(the31st, new Date("2026-04-30T12:00:00Z"))).toBe("2026-05-31");
  });
  it("rolls over the year in December", () => {
    expect(nextBillingDate(sec("2026-01-05T00:00:00Z"), new Date("2026-12-10T00:00:00Z"))).toBe("2027-01-05");
  });
  it("does not drift around midnight UTC (the old local-time bug)", () => {
    expect(nextBillingDate(sec("2026-03-01T00:30:00Z"), new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
  });
});

describe("ids from Stripe objects", () => {
  it("reads the customer id whether it is a string or expanded", () => {
    expect(customerIdOf({ customer: "cus_1" })).toBe("cus_1");
    expect(customerIdOf({ customer: { id: "cus_2" } })).toBe("cus_2");
    expect(customerIdOf({ customer: null })).toBeNull();
    expect(customerIdOf({})).toBeNull();
  });
  it("reads the subscription id from both invoice shapes (the clover move to parent.subscription_details)", () => {
    expect(getInvoiceSubscriptionId({ subscription: "sub_1" })).toBe("sub_1");
    expect(getInvoiceSubscriptionId({ subscription: { id: "sub_2" } })).toBe("sub_2");
    expect(getInvoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_3" } } })).toBe("sub_3");
    expect(getInvoiceSubscriptionId({ parent: { subscription_details: { subscription: { id: "sub_4" } } } })).toBe("sub_4");
    expect(getInvoiceSubscriptionId({ parent: null })).toBeNull();
    expect(getInvoiceSubscriptionId(null)).toBeNull();
  });
  it("recognises a unique violation", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "42P10" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("clients from customers", () => {
  it("uses the old placeholders for missing values and starts onboarding", () => {
    expect(newClientFields({ id: "cus_1" })).toEqual({ stripe_customer_id: "cus_1", business_name: "Unnamed", contact_name: "Unknown", email: "no-email", phone: null, status: "onboarding" });
    expect(newClientFields({ id: "cus_1", name: "Acme", email: "a@b.co", phone: "1", metadata: { contact_name: "Jane" } })).toMatchObject({ business_name: "Acme", contact_name: "Jane", email: "a@b.co", phone: "1" });
  });
  it("backfills only blanks and placeholders, never a real value", () => {
    const customer = { id: "c", name: "New Name", email: "new@x.co", phone: "555", metadata: { contact_name: "New Contact" } };
    expect(backfillPatch({ business_name: "Unnamed", contact_name: "Unknown", email: "no-email", phone: null }, customer)).toEqual({
      business_name: "New Name",
      contact_name: "New Contact",
      email: "new@x.co",
      phone: "555",
    });
    expect(backfillPatch({ business_name: "Real Co", contact_name: "Real Person", email: "real@x.co", phone: "1" }, customer)).toEqual({});
    expect(backfillPatch({ business_name: "", contact_name: "", email: "", phone: null }, { id: "c" })).toEqual({});
  });
});

describe("revenue rows", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  it("paid: amount in dollars, subscription or one-time, Stripe's own paid time", () => {
    expect(paidRevenueFields({ id: "in_1", amount_paid: 4900, status_transitions: { paid_at: sec("2026-10-31T23:00:00Z") } }, "c1", "sub_1", now)).toEqual({
      stripe_invoice_id: "in_1",
      client_id: "c1",
      amount: 49,
      status: "paid",
      event_type: "subscription",
      paid_at: "2026-10-31T23:00:00.000Z",
    });
    expect(paidRevenueFields({ id: "in_2", amount_paid: null }, "c1", null, now)).toMatchObject({ amount: 0, event_type: "one_time", paid_at: now.toISOString() });
  });
  it("failed: the amount due", () => {
    expect(failedRevenueFields({ id: "in_3", amount_due: 9900 }, "c1", null)).toEqual({ stripe_invoice_id: "in_3", client_id: "c1", amount: 99, status: "failed", event_type: "one_time" });
  });
});

describe("clientUpdateAfterPayment", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const base = { status: "active", lifetime_value: 100, on_hold_since: null as string | null };
  const live = { status: "active", billing_cycle_anchor: sec("2026-01-20T00:00:00Z") };
  it("adds the amount, refreshes the billing date from the live subscription", () => {
    expect(clientUpdateAfterPayment({ current: base, amountPaidCents: 4900, liveSubscription: live, contractStatus: null, now })).toEqual({ lifetime_value: 149, billing_anchor_date: "2026-11-20" });
  });
  it("lifts a manual hold", () => {
    expect(clientUpdateAfterPayment({ current: { ...base, on_hold_since: "2026-10-01" }, amountPaidCents: 0, liveSubscription: null, contractStatus: null, now })).toMatchObject({ on_hold_since: null });
  });
  it("past_due always goes back to active", () => {
    expect(clientUpdateAfterPayment({ current: { ...base, status: "past_due" }, amountPaidCents: 100, liveSubscription: null, contractStatus: null, now }).status).toBe("active");
  });
  it("paused resumes only for a live subscription (not a late payment of a canceled one)", () => {
    const paused = { ...base, status: "paused" };
    expect(clientUpdateAfterPayment({ current: paused, amountPaidCents: 1, liveSubscription: live, contractStatus: null, now }).status).toBe("active");
    expect(clientUpdateAfterPayment({ current: paused, amountPaidCents: 1, liveSubscription: { status: "canceled" }, contractStatus: null, now }).status).toBeUndefined();
    expect(clientUpdateAfterPayment({ current: paused, amountPaidCents: 1, liveSubscription: { status: "active", pause_collection: { behavior: "void" } }, contractStatus: null, now }).status).toBeUndefined();
    expect(clientUpdateAfterPayment({ current: paused, amountPaidCents: 1, liveSubscription: null, contractStatus: null, now }).status).toBeUndefined();
  });
  it("onboarding becomes active only with a signed or exempt contract", () => {
    const onboarding = { ...base, status: "onboarding" };
    expect(clientUpdateAfterPayment({ current: onboarding, amountPaidCents: 1, liveSubscription: null, contractStatus: "signed", now }).status).toBe("active");
    expect(clientUpdateAfterPayment({ current: onboarding, amountPaidCents: 1, liveSubscription: null, contractStatus: "exempt", now }).status).toBe("active");
    expect(clientUpdateAfterPayment({ current: onboarding, amountPaidCents: 1, liveSubscription: null, contractStatus: "pending", now }).status).toBeUndefined();
    expect(clientUpdateAfterPayment({ current: onboarding, amountPaidCents: 1, liveSubscription: null, contractStatus: null, now }).status).toBeUndefined();
  });
  it("restores the status that was there before a stale failure", () => {
    expect(restoreAfterStaleFailure("past_due")).toBe("active");
    expect(restoreAfterStaleFailure("onboarding")).toBe("onboarding");
  });
});

describe("subscriptions and schedules", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  it("live means active or trialing, and not paused collection", () => {
    expect(isLiveSubscription({ status: "active" })).toBe(true);
    expect(isLiveSubscription({ status: "trialing" })).toBe(true);
    expect(isLiveSubscription({ status: "past_due" })).toBe(false);
    expect(isLiveSubscription({ status: "active", pause_collection: { behavior: "keep_as_draft" } })).toBe(false);
  });
  it("subscription fields: price in dollars and the next billing date", () => {
    expect(subscriptionFields({ items: { data: [{ price: { unit_amount: 4900 } }] }, billing_cycle_anchor: sec("2026-01-20T00:00:00Z") }, now)).toEqual({ subscription_price: 49, billing_anchor_date: "2026-11-20" });
    expect(subscriptionFields({ items: { data: [] } }, now)).toEqual({});
  });
  it("a finished schedule has no current phase; otherwise the running or next phase", () => {
    const phases = [
      { start_date: sec("2026-09-01T00:00:00Z"), end_date: sec("2026-10-01T00:00:00Z"), items: [{ price: "price_old" }] },
      { start_date: sec("2026-12-01T00:00:00Z"), end_date: null, items: [{ price: "price_new" }] },
    ];
    for (const status of ["completed", "released", "canceled"]) expect(currentSchedulePhase({ status, phases }, now)).toBeNull();
    const phase = currentSchedulePhase({ status: "not_started", phases }, now);
    expect(phase && phasePriceRef(phase)).toEqual({ priceId: "price_new" });
    expect(phase && phaseStartDate(phase)).toBe("2026-12-01");
    expect(phasePriceRef({ items: [{ price: { unit_amount: 3500 } }] })).toEqual({ amount: 35 * 100 });
    expect(phasePriceRef({ items: [] })).toBeNull();
  });
});

describe("the ledger", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it("processed or ignored events are duplicates", () => {
    expect(ledgerDecision({ status: "processed", claimed_at: ago(1000) }, now)).toBe("duplicate");
    expect(ledgerDecision({ status: "ignored", claimed_at: ago(1000) }, now)).toBe("duplicate");
  });
  it("a fresh 'processing' is in flight; a stale one or a failure is taken over", () => {
    expect(ledgerDecision({ status: "processing", claimed_at: ago(1000) }, now)).toBe("in_flight");
    expect(ledgerDecision({ status: "processing", claimed_at: ago(STALE_PROCESSING_MS + 1) }, now)).toBe("reclaim");
    expect(ledgerDecision({ status: "failed", claimed_at: ago(1000) }, now)).toBe("reclaim");
  });
  it("test-mode events are ignored only in production", () => {
    expect(ignoreTestModeEvent(false, "production")).toBe(true);
    expect(ignoreTestModeEvent(false, "staging")).toBe(false);
    expect(ignoreTestModeEvent(false, undefined)).toBe(false);
    expect(ignoreTestModeEvent(true, "production")).toBe(false);
    // APP_ENV is optional; Vercel always sets VERCEL_ENV. A missing APP_ENV must not let test data into production.
    expect(ignoreTestModeEvent(false, undefined, "production")).toBe(true);
    expect(ignoreTestModeEvent(false, "local", "production")).toBe(true);
    expect(ignoreTestModeEvent(false, undefined, "preview")).toBe(false);
    expect(ignoreTestModeEvent(true, undefined, "production")).toBe(false);
  });
});
