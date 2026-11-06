import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeBillingRepo, fakeClient } from "./fake-repo";
import { handleStripeEvent, IngestError, ingestStripeEvent, type BillingDeps } from "./service";
import type { StripeReads } from "@/platform/stripe/api";
import { PermissionError } from "@/platform/errors";

const NOW = new Date("2026-11-06T12:00:00Z");
const stripeActor = { type: "integration", name: "stripe" } as const;
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

let repo: FakeBillingRepo;
let stripe: { [K in keyof StripeReads]: ReturnType<typeof vi.fn> };
let deps: BillingDeps;

function event(type: string, object: Record<string, unknown>, over: { id?: string; livemode?: boolean } = {}) {
  return { id: over.id ?? `evt_${type}_${Math.random().toString(36).slice(2)}`, type, livemode: over.livemode ?? true, data: { object } };
}
const run = (type: string, object: Record<string, unknown>) => handleStripeEvent(stripeActor, event(type, object), deps);

beforeEach(() => {
  repo = new FakeBillingRepo();
  stripe = {
    retrieveCustomer: vi.fn(async (id: string) => ({ id, name: "Fresh Co", email: "fresh@x.test", phone: null, metadata: {} })),
    retrieveInvoiceStatus: vi.fn(async () => "open"),
    retrieveSubscription: vi.fn(async (id: string) => ({ id, status: "active", billing_cycle_anchor: sec("2026-01-20T00:00:00Z") })),
    listSubscriptions: vi.fn(async () => []),
    retrievePriceAmount: vi.fn(async () => 4900),
    paymentIntentHasInvoice: vi.fn(async () => false),
  };
  deps = { repo, stripe: stripe as unknown as StripeReads, now: () => NOW };
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("permissions", () => {
  it("only the integration actor (or the owner) may ingest billing events", async () => {
    await expect(run("customer.created", { id: "cus_1" })).resolves.toBe("handled");
    await expect(handleStripeEvent({ type: "ai", name: "mcp" }, event("customer.created", { id: "cus_1" }), deps)).rejects.toBeInstanceOf(PermissionError);
    await expect(handleStripeEvent({ type: "system", name: "jobs" }, event("customer.created", { id: "cus_1" }), deps)).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("customer.created / updated / deleted", () => {
  it("creates an onboarding client with the placeholders and links a new account", async () => {
    await run("customer.created", { id: "cus_new", name: null, email: null, phone: null, metadata: {} });
    const c = repo.clients[0]!;
    expect(c).toMatchObject({ stripe_customer_id: "cus_new", business_name: "Unnamed", contact_name: "Unknown", email: "no-email", status: "onboarding" });
    expect(repo.accounts).toEqual([{ id: c.account_id, name: "Unnamed" }]);
  });
  it("a retried delivery creates no second client and still links the account the first attempt missed", async () => {
    repo.clients.push(fakeClient({ stripe_customer_id: "cus_1", account_id: null, business_name: "Acme" }));
    await run("customer.created", { id: "cus_1", name: "Acme" });
    expect(repo.clients).toHaveLength(1);
    expect(repo.clients[0]!.account_id).not.toBeNull();
  });
  it("loses an insert race cleanly (23505) and uses the row that won", async () => {
    const realInsert = repo.insertClient.bind(repo);
    vi.spyOn(repo, "insertClient").mockImplementationOnce(async (fields) => {
      await realInsert(fields); // the racing request's row
      return "conflict";
    });
    await run("customer.created", { id: "cus_race", name: "Race Co" });
    expect(repo.clients).toHaveLength(1);
  });
  it("does not leave two accounts when a concurrent link wins", async () => {
    repo.clients.push(fakeClient({ stripe_customer_id: "cus_1", account_id: null }));
    vi.spyOn(repo, "linkAccount").mockResolvedValueOnce(0);
    await run("customer.created", { id: "cus_1", name: "Acme" });
    expect(repo.accounts).toEqual([]);
  });
  it("customer.updated fills only blanks and placeholders", async () => {
    repo.clients.push(fakeClient({ stripe_customer_id: "cus_1", business_name: "Unnamed", contact_name: "Real Person", email: "no-email", phone: null }));
    await run("customer.updated", { id: "cus_1", name: "Acme", email: "acme@x.test", phone: "555", metadata: { contact_name: "Someone Else" } });
    expect(repo.clients[0]).toMatchObject({ business_name: "Acme", contact_name: "Real Person", email: "acme@x.test", phone: "555" });
  });
  it("customer.updated for an unknown customer does nothing", async () => {
    await run("customer.updated", { id: "cus_unknown", name: "X" });
    expect(repo.clients).toEqual([]);
  });
  it("customer.deleted archives (never deletes) and keeps an earlier archive date", async () => {
    repo.clients.push(fakeClient({ stripe_customer_id: "cus_1" }), fakeClient({ stripe_customer_id: "cus_2", archived_at: "2026-01-01T00:00:00Z" }));
    await run("customer.deleted", { id: "cus_1" });
    await run("customer.deleted", { id: "cus_2" });
    expect(repo.clients[0]!.archived_at).toBe(NOW.toISOString());
    expect(repo.clients[1]!.archived_at).toBe("2026-01-01T00:00:00Z");
    expect(repo.clients).toHaveLength(2);
  });
});

describe("invoice.paid / invoice.payment_succeeded", () => {
  const invoice = (over: Record<string, unknown> = {}) => ({ id: "in_1", customer: "cus_1", amount_paid: 4900, status_transitions: { paid_at: sec("2026-11-05T10:00:00Z") }, parent: { subscription_details: { subscription: "sub_1" } }, ...over });

  beforeEach(() => {
    repo.clients.push(fakeClient({ id: "c1", stripe_customer_id: "cus_1", status: "active", lifetime_value: 100 }));
  });

  it("records the payment once, updates lifetime value and the billing date", async () => {
    await run("invoice.paid", invoice());
    expect(repo.revenue).toEqual([expect.objectContaining({ stripe_invoice_id: "in_1", client_id: "c1", amount: 49, status: "paid", event_type: "subscription", paid_at: "2026-11-05T10:00:00.000Z" })]);
    expect(repo.clients[0]).toMatchObject({ lifetime_value: 149, billing_anchor_date: "2026-11-20" });
  });
  it("the paid pair (payment_succeeded + paid) counts the money once", async () => {
    await run("invoice.payment_succeeded", invoice());
    await run("invoice.paid", invoice());
    expect(repo.revenue).toHaveLength(1);
    expect(repo.clients[0]!.lifetime_value).toBe(149);
  });
  it("a concurrent paid delivery that wins the insert (23505 on a paid row) is not counted twice", async () => {
    const realInsert = repo.insertRevenue.bind(repo);
    vi.spyOn(repo, "insertRevenue").mockImplementationOnce(async (fields) => {
      await realInsert(fields);
      return "conflict";
    });
    await run("invoice.paid", invoice());
    expect(repo.clients[0]!.lifetime_value).toBe(100);
  });
  it("a racing payment_failed row (23505 on a failed row) is flipped to paid, not lost behind a 200", async () => {
    vi.spyOn(repo, "insertRevenue").mockImplementationOnce(async () => {
      repo.revenue.push({ id: "rev-race", stripe_invoice_id: "in_1", client_id: "c1", amount: 49, status: "failed", event_type: "subscription", paid_at: null });
      return "conflict";
    });
    await run("invoice.paid", invoice());
    expect(repo.revenue).toEqual([expect.objectContaining({ id: "rev-race", status: "paid" })]);
    expect(repo.clients[0]!.lifetime_value).toBe(149);
  });
  it("a failed row from an earlier attempt is flipped to paid", async () => {
    repo.revenue.push({ id: "rev-f", stripe_invoice_id: "in_1", client_id: "c1", amount: 49, status: "failed", event_type: "subscription", paid_at: null });
    repo.clients[0]!.status = "past_due";
    await run("invoice.paid", invoice());
    expect(repo.revenue[0]!.status).toBe("paid");
    expect(repo.clients[0]!.status).toBe("active");
  });
  it("a conditional update that loses the race (row already paid) changes nothing on the client", async () => {
    repo.revenue.push({ id: "rev-f", stripe_invoice_id: "in_1", client_id: "c1", amount: 49, status: "failed", event_type: "subscription", paid_at: null });
    vi.spyOn(repo, "updateRevenueIfStatus").mockResolvedValueOnce(0);
    await run("invoice.paid", invoice());
    expect(repo.clients[0]!.lifetime_value).toBe(100);
  });
  it("a retry of an event whose earlier attempt saved the payment but failed before the client update repairs the client, without counting the money twice", async () => {
    // The earlier attempt: payment row saved, then the client update failed (so the client is still past_due and on hold).
    repo.revenue.push({ id: "rev-p", stripe_invoice_id: "in_1", client_id: "c1", amount: 49, status: "paid", event_type: "subscription", paid_at: "2026-11-05T10:00:00.000Z" });
    repo.clients[0]!.status = "past_due";
    repo.clients[0]!.on_hold_since = "2026-10-01T00:00:00Z";
    await handleStripeEvent(stripeActor, event("invoice.paid", invoice()), { ...deps, retry: true });
    expect(repo.clients[0]).toMatchObject({ status: "active", on_hold_since: null, lifetime_value: 100 });
    expect(repo.revenue).toHaveLength(1);
  });
  it("without a retry, an already-paid row leaves the client alone (the second of the paid pair, or a stale replay)", async () => {
    repo.revenue.push({ id: "rev-p", stripe_invoice_id: "in_1", client_id: "c1", amount: 49, status: "paid", event_type: "subscription", paid_at: "2026-11-05T10:00:00.000Z" });
    repo.clients[0]!.status = "past_due";
    await run("invoice.paid", invoice());
    expect(repo.clients[0]).toMatchObject({ status: "past_due", lifetime_value: 100 });
  });
  it("lifts a hold", async () => {
    repo.clients[0]!.on_hold_since = "2026-10-01T00:00:00Z";
    await run("invoice.paid", invoice());
    expect(repo.clients[0]!.on_hold_since).toBeNull();
  });
  it("a paused client resumes only when the subscription is live right now", async () => {
    repo.clients[0]!.status = "paused";
    stripe.retrieveSubscription.mockResolvedValueOnce({ id: "sub_1", status: "canceled", billing_cycle_anchor: null });
    await run("invoice.paid", invoice());
    expect(repo.clients[0]!.status).toBe("paused");
    await run("invoice.paid", invoice({ id: "in_2" }));
    expect(repo.clients[0]!.status).toBe("active");
  });
  it("onboarding becomes active only with a signed or exempt contract", async () => {
    repo.clients[0]!.status = "onboarding";
    await run("invoice.paid", invoice({ parent: null }));
    expect(repo.clients[0]!.status).toBe("onboarding");
    repo.contracts.set("c1", "signed");
    await run("invoice.paid", invoice({ id: "in_2", parent: null }));
    expect(repo.clients[0]!.status).toBe("active");
    expect(repo.revenue.map((r) => r.event_type)).toEqual(["one_time", "one_time"]);
  });
  it("a failed subscription lookup does not lose the payment", async () => {
    stripe.retrieveSubscription.mockRejectedValueOnce(new Error("Stripe down"));
    await run("invoice.paid", invoice());
    expect(repo.revenue).toHaveLength(1);
    expect(repo.clients[0]!.lifetime_value).toBe(149);
  });
  it("creates the client on the spot for a customer never seen (missed customer.created)", async () => {
    await run("invoice.paid", invoice({ id: "in_9", customer: "cus_unseen" }));
    const created = repo.clients.find((c) => c.stripe_customer_id === "cus_unseen");
    expect(created).toMatchObject({ business_name: "Fresh Co", status: "onboarding" });
    expect(created!.account_id).not.toBeNull();
    expect(repo.revenue.find((r) => r.stripe_invoice_id === "in_9")?.client_id).toBe(created!.id);
  });
  it("does nothing for a customer deleted in Stripe", async () => {
    stripe.retrieveCustomer.mockResolvedValueOnce(null);
    await run("invoice.paid", invoice({ id: "in_9", customer: "cus_gone" }));
    expect(repo.revenue).toEqual([]);
  });
});

describe("invoice.payment_failed", () => {
  const invoice = (over: Record<string, unknown> = {}) => ({ id: "in_1", customer: "cus_1", amount_due: 4900, subscription: "sub_1", ...over });

  beforeEach(() => {
    repo.clients.push(fakeClient({ id: "c1", stripe_customer_id: "cus_1", status: "active" }));
  });

  it("records the failure and marks the client past due", async () => {
    await run("invoice.payment_failed", invoice());
    expect(repo.revenue).toEqual([expect.objectContaining({ stripe_invoice_id: "in_1", amount: 49, status: "failed", event_type: "subscription" })]);
    expect(repo.clients[0]!.status).toBe("past_due");
  });
  it("ignores a stale failure for an invoice already paid (our record) and clears a leftover past_due", async () => {
    repo.revenue.push({ id: "r", stripe_invoice_id: "in_1", client_id: "c1", amount: 49, status: "paid", event_type: "subscription", paid_at: null });
    repo.clients[0]!.status = "past_due";
    await run("invoice.payment_failed", invoice());
    expect(repo.clients[0]!.status).toBe("active");
    expect(repo.revenue).toHaveLength(1);
  });
  it("ignores a stale failure when Stripe says the invoice is paid", async () => {
    stripe.retrieveInvoiceStatus.mockResolvedValueOnce("paid");
    await run("invoice.payment_failed", invoice());
    expect(repo.revenue).toEqual([]);
    expect(repo.clients[0]!.status).toBe("active");
  });
  it("keeps past_due while another failed invoice remains", async () => {
    repo.revenue.push(
      { id: "r1", stripe_invoice_id: "in_1", client_id: "c1", amount: 49, status: "paid", event_type: "subscription", paid_at: null },
      { id: "r2", stripe_invoice_id: "in_0", client_id: "c1", amount: 49, status: "failed", event_type: "subscription", paid_at: null },
    );
    repo.clients[0]!.status = "past_due";
    await run("invoice.payment_failed", invoice());
    expect(repo.clients[0]!.status).toBe("past_due");
  });
  it("a Stripe lookup failure falls back to our own record", async () => {
    stripe.retrieveInvoiceStatus.mockRejectedValueOnce(new Error("down"));
    await run("invoice.payment_failed", invoice());
    expect(repo.clients[0]!.status).toBe("past_due");
  });
  it("an invoice.paid that lands mid-request: our past_due is undone and the status restored", async () => {
    // The paid row appears right after our past_due write.
    const realUpdate = repo.updateClient.bind(repo);
    vi.spyOn(repo, "updateClient").mockImplementationOnce(async (id, patch, onlyIf) => {
      const n = await realUpdate(id, patch, onlyIf);
      repo.revenue.find((r) => r.stripe_invoice_id === "in_1")!.status = "paid";
      return n;
    });
    await run("invoice.payment_failed", invoice());
    expect(repo.clients[0]!.status).toBe("active");
  });
  it("a status change between the read and the conditional write is retried unconditionally when the failure is real", async () => {
    vi.spyOn(repo, "updateClient").mockResolvedValueOnce(0);
    await run("invoice.payment_failed", invoice());
    expect(repo.clients[0]!.status).toBe("past_due");
  });
  it("a concurrent failed delivery (23505 on the insert) is not an error", async () => {
    vi.spyOn(repo, "insertRevenue").mockResolvedValueOnce("conflict");
    await expect(run("invoice.payment_failed", invoice())).resolves.toBe("handled");
    expect(repo.clients[0]!.status).toBe("past_due");
  });
});

describe("charge.succeeded", () => {
  const charge = (over: Record<string, unknown> = {}) => ({ id: "ch_1", customer: "cus_1", amount: 15000, created: sec("2026-11-04T09:00:00Z"), payment_intent: "pi_1", ...over });
  beforeEach(() => {
    repo.clients.push(fakeClient({ id: "c1", stripe_customer_id: "cus_1", lifetime_value: 100, on_hold_since: "2026-10-01T00:00:00Z" }));
  });
  it("a retry that finds the charge already saved lifts the hold but does not add the amount again", async () => {
    repo.revenue.push({ id: "rev-c", stripe_invoice_id: "ch_1", client_id: "c1", amount: 150, status: "paid", event_type: "one_time", paid_at: "2026-11-04T09:00:00.000Z" });
    await handleStripeEvent(stripeActor, event("charge.succeeded", charge()), { ...deps, retry: true });
    expect(repo.clients[0]).toMatchObject({ lifetime_value: 100, on_hold_since: null });
    expect(repo.revenue).toHaveLength(1);
  });
  it("records a standalone charge once, adds to lifetime value and lifts a hold", async () => {
    await run("charge.succeeded", charge());
    await run("charge.succeeded", charge());
    expect(repo.revenue).toEqual([expect.objectContaining({ stripe_invoice_id: "ch_1", amount: 150, status: "paid", event_type: "one_time", paid_at: "2026-11-04T09:00:00.000Z" })]);
    expect(repo.clients[0]).toMatchObject({ lifetime_value: 250, on_hold_since: null });
  });
  it("skips a charge that belongs to an invoice (legacy field, or found through InvoicePayments): no double counting", async () => {
    await run("charge.succeeded", charge({ invoice: "in_1" }));
    stripe.paymentIntentHasInvoice.mockResolvedValueOnce(true);
    await run("charge.succeeded", charge());
    expect(repo.revenue).toEqual([]);
    expect(stripe.paymentIntentHasInvoice).toHaveBeenCalledWith("pi_1");
  });
  it("skips a charge for an unknown customer, and a concurrent duplicate (23505)", async () => {
    await run("charge.succeeded", charge({ customer: "cus_unknown" }));
    vi.spyOn(repo, "insertRevenue").mockResolvedValueOnce("conflict");
    await run("charge.succeeded", charge());
    expect(repo.revenue).toEqual([]);
    expect(repo.clients[0]!.lifetime_value).toBe(100);
  });
});

describe("subscriptions and schedules", () => {
  beforeEach(() => {
    repo.clients.push(fakeClient({ id: "c1", stripe_customer_id: "cus_1", status: "active" }));
  });
  const sub = (over: Record<string, unknown> = {}) => ({ id: "sub_1", customer: "cus_1", status: "active", items: { data: [{ price: { unit_amount: 4900 } }] }, billing_cycle_anchor: sec("2026-01-20T00:00:00Z"), ...over });

  it("subscription.created and .updated set the price and billing date", async () => {
    await run("customer.subscription.created", sub());
    expect(repo.clients[0]).toMatchObject({ subscription_price: 49, billing_anchor_date: "2026-11-20" });
    await run("customer.subscription.updated", sub({ items: { data: [{ price: { unit_amount: 9900 } }] } }));
    expect(repo.clients[0]!.subscription_price).toBe(99);
  });
  it("resumes a paused client only on the subscription's current state (an old payload can predate the deletion)", async () => {
    repo.clients[0]!.status = "paused";
    stripe.retrieveSubscription.mockResolvedValueOnce({ id: "sub_1", status: "canceled" });
    await run("customer.subscription.updated", sub());
    expect(repo.clients[0]!.status).toBe("paused");
    await run("customer.subscription.updated", sub());
    expect(repo.clients[0]!.status).toBe("active");
  });
  it("does not resume from a payload that is not live", async () => {
    repo.clients[0]!.status = "paused";
    await run("customer.subscription.updated", sub({ status: "past_due" }));
    expect(repo.clients[0]!.status).toBe("paused");
    expect(stripe.retrieveSubscription).not.toHaveBeenCalled();
  });
  it("subscription.deleted pauses only when it was the last live subscription", async () => {
    stripe.listSubscriptions.mockResolvedValueOnce([{ id: "sub_2", status: "active" }]);
    await run("customer.subscription.deleted", sub({ status: "canceled" }));
    expect(repo.clients[0]!.status).toBe("active");
    stripe.listSubscriptions.mockResolvedValueOnce([{ id: "sub_1", status: "canceled" }, { id: "sub_3", status: "incomplete_expired" }]);
    await run("customer.subscription.deleted", sub({ status: "canceled" }));
    expect(repo.clients[0]!.status).toBe("paused");
  });
  it("a schedule with a future start sets the price (fetched) and the start date", async () => {
    await run("subscription_schedule.created", {
      id: "sub_sched_1",
      customer: "cus_1",
      status: "not_started",
      phases: [{ start_date: sec("2026-12-01T00:00:00Z"), end_date: null, items: [{ price: "price_1" }] }],
    });
    expect(stripe.retrievePriceAmount).toHaveBeenCalledWith("price_1");
    expect(repo.clients[0]).toMatchObject({ subscription_price: 49, billing_anchor_date: "2026-12-01" });
  });
  it("a released schedule changes nothing (the real subscription's events take over)", async () => {
    await run("subscription_schedule.updated", { id: "s", customer: "cus_1", status: "released", phases: [{ start_date: 1, end_date: null, items: [{ price: "price_1" }] }] });
    expect(repo.clients[0]!.subscription_price).toBe(0);
  });
});

describe("other event types", () => {
  it("are acknowledged and ignored", async () => {
    await expect(run("invoice.created", { id: "in_1" })).resolves.toBe("ignored");
    expect(repo.clients).toHaveLength(0);
  });
});

describe("ingestStripeEvent (the ledger)", () => {
  const ingest = (e: ReturnType<typeof event>, appEnv = "production") => ingestStripeEvent(stripeActor, e, deps, appEnv);
  beforeEach(() => {
    repo.clients.push(fakeClient({ id: "c1", stripe_customer_id: "cus_1" }));
  });

  it("processes a new event once and records it", async () => {
    const e = event("customer.updated", { id: "cus_1", name: "X" }, { id: "evt_1" });
    expect(await ingest(e)).toEqual({ result: "processed" });
    expect(repo.ledger.get("evt_1")).toMatchObject({ status: "processed", attempts: 1, type: "customer.updated" });
    expect(await ingest(e)).toEqual({ result: "duplicate" });
  });
  it("ignores test-mode events in production only, and unhandled types everywhere, recording them as ignored", async () => {
    expect(await ingest(event("customer.created", { id: "cus_t" }, { id: "evt_t", livemode: false }))).toEqual({ result: "ignored", reason: "test_mode_event_in_production" });
    expect(repo.clients.some((c) => c.stripe_customer_id === "cus_t")).toBe(false);
    expect(repo.ledger.get("evt_t")?.status).toBe("ignored");
    expect(await ingest(event("customer.created", { id: "cus_t" }, { id: "evt_t2", livemode: false }), "staging")).toEqual({ result: "processed" });
    expect(await ingest(event("invoice.sent", { id: "in_1" }, { id: "evt_u" }))).toEqual({ result: "ignored", reason: "unhandled_type" });
  });
  it("an event being processed right now answers in_flight (Stripe retries later)", async () => {
    repo.ledger.set("evt_busy", { status: "processing", attempts: 1, claimed_at: NOW.toISOString(), type: "customer.updated", livemode: true, error: null });
    expect(await ingest(event("customer.updated", { id: "cus_1" }, { id: "evt_busy" }))).toEqual({ result: "in_flight" });
  });
  it("a failed event is taken over and processed again", async () => {
    repo.ledger.set("evt_f", { status: "failed", attempts: 1, claimed_at: NOW.toISOString(), type: "customer.updated", livemode: true, error: "Could not update the client" });
    expect(await ingest(event("customer.updated", { id: "cus_1" }, { id: "evt_f" }))).toEqual({ result: "processed" });
    expect(repo.ledger.get("evt_f")).toMatchObject({ status: "processed", attempts: 2, error: null });
  });
  it("a taken-over event is handled as a retry: a payment saved by the failed attempt still gets its client update", async () => {
    repo.clients[0]!.status = "past_due";
    repo.revenue.push({ id: "rev-p", stripe_invoice_id: "in_9", client_id: "c1", amount: 49, status: "paid", event_type: "subscription", paid_at: "2026-11-05T10:00:00.000Z" });
    repo.ledger.set("evt_paid", { status: "failed", attempts: 1, claimed_at: NOW.toISOString(), type: "invoice.paid", livemode: true, error: "Could not update the client" });
    const e = event("invoice.paid", { id: "in_9", customer: "cus_1", amount_paid: 4900, status_transitions: { paid_at: sec("2026-11-05T10:00:00Z") } }, { id: "evt_paid" });
    expect(await ingest(e)).toEqual({ result: "processed" });
    expect(repo.clients[0]!.status).toBe("active");
  });
  it("an abandoned 'processing' row (older than 5 minutes) is taken over", async () => {
    repo.ledger.set("evt_old", { status: "processing", attempts: 1, claimed_at: new Date(NOW.getTime() - 6 * 60_000).toISOString(), type: "customer.updated", livemode: true, error: null });
    expect(await ingest(event("customer.updated", { id: "cus_1" }, { id: "evt_old" }))).toEqual({ result: "processed" });
  });
  it("losing the take-over race answers in_flight", async () => {
    repo.ledger.set("evt_f", { status: "failed", attempts: 1, claimed_at: NOW.toISOString(), type: "customer.updated", livemode: true, error: null });
    vi.spyOn(repo, "reclaimLedger").mockResolvedValueOnce(false);
    expect(await ingest(event("customer.updated", { id: "cus_1" }, { id: "evt_f" }))).toEqual({ result: "in_flight" });
  });
  it("a processing error marks the event failed with a short, generic message and throws (so the route answers 500)", async () => {
    vi.spyOn(repo, "updateClient").mockRejectedValueOnce(new Error('duplicate key value violates "clients_email" Key (email)=(jane@acme.test)'));
    const e = event("customer.updated", { id: "cus_1", name: "Acme", email: "new@x.test" }, { id: "evt_err" });
    repo.clients[0]!.email = "no-email";
    await expect(ingest(e)).rejects.toBeInstanceOf(IngestError);
    const row = repo.ledger.get("evt_err")!;
    expect(row.status).toBe("failed");
    expect(row.error).toBe("Unexpected Error");
    expect(row.error).not.toContain("@");
  });
});
