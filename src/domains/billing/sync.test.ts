import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ writeAudit: vi.fn() }));
vi.mock("@/platform/audit/audit", () => ({ writeAudit: mocks.writeAudit }));

import { FakeBillingRepo, fakeClient } from "./fake-repo";
import type { SyncRepo } from "./repo";
import { SYNC_BUDGET_MS, syncFromStripe, type SyncDeps } from "./sync";
import { lifetimeValueOf, paidSinceHold, pickSyncSubscription, shouldRecordCharge, syncedInvoiceRevenue, syncMessage, type SyncSummary } from "./rules";
import type { StripeSyncReads, SyncCharge, SyncInvoice } from "@/platform/stripe/sync-api";
import { invoicePaymentIntentIds } from "@/platform/stripe/sync-api";
import { PermissionError, RateLimitError, RuleError } from "@/platform/errors";

const NOW = new Date("2026-11-06T12:00:00Z");
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
let n = 0;
/** A fresh owner per test, so the in-memory rate limit never leaks between tests. */
const owner = () => ({ type: "owner", userId: `owner-${++n}`, email: null, ip: null }) as const;

class FakeSyncRepo extends FakeBillingRepo implements SyncRepo {
  async listStripeClients() {
    return this.clients
      .filter((c) => c.stripe_customer_id)
      .map((c) => ({ id: c.id, stripe_customer_id: c.stripe_customer_id as string, status: c.status, on_hold_since: c.on_hold_since }));
  }
  async paidRevenue(clientId: string) {
    return this.revenue.filter((r) => r.client_id === clientId && r.status === "paid").map((r) => ({ amount: r.amount, paid_at: r.paid_at }));
  }
  async findRevenueOwner(stripeId: string) {
    const r = this.revenue.find((x) => x.stripe_invoice_id === stripeId);
    return r ? { id: r.id, status: r.status, client_id: r.client_id } : null;
  }
  async assignRevenue(id: string, clientId: string) {
    const r = this.revenue.find((x) => x.id === id && x.client_id === null);
    if (!r) return 0;
    r.client_id = clientId;
    return 1;
  }
}

const invoice = (over: Partial<SyncInvoice> = {}): SyncInvoice => ({
  id: "in_1",
  amount_paid: 9900,
  created: sec("2026-03-01T00:00:00Z"),
  status_transitions: { paid_at: sec("2026-03-02T00:00:00Z") },
  subscriptionId: null,
  paymentIntentIds: ["pi_inv"],
  ...over,
});
const charge = (over: Partial<SyncCharge> = {}): SyncCharge => ({ id: "ch_1", status: "succeeded", amount: 5000, created: sec("2026-04-01T00:00:00Z"), paymentIntentId: "pi_solo", ...over });

let repo: FakeSyncRepo;
let stripe: { [K in keyof StripeSyncReads]: ReturnType<typeof vi.fn> };
let deps: SyncDeps;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeAudit.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  repo = new FakeSyncRepo();
  stripe = {
    listCustomers: vi.fn(async () => []),
    listSubscriptions: vi.fn(async () => []),
    listSchedules: vi.fn(async () => []),
    retrievePriceAmount: vi.fn(async () => 4900),
    listPaidInvoices: vi.fn(async () => []),
    listCharges: vi.fn(async () => []),
    listCustomerlessCharges: vi.fn(async () => []),
  };
  deps = { repo, stripe: stripe as unknown as StripeSyncReads, now: () => NOW, clock: () => 1_000_000 };
});

const sync = () => syncFromStripe(owner(), deps);

describe("permissions and limits", () => {
  it("is owner only", async () => {
    for (const actor of [{ type: "ai", name: "mcp" }, { type: "system", name: "jobs" }, { type: "integration", name: "stripe" }] as const) {
      await expect(syncFromStripe(actor as never, deps)).rejects.toBeInstanceOf(PermissionError);
    }
    expect(stripe.listCustomers).not.toHaveBeenCalled();
  });
  it("refuses a third run inside a minute", async () => {
    const actor = owner();
    await syncFromStripe(actor, deps);
    await syncFromStripe(actor, deps);
    await expect(syncFromStripe(actor, deps)).rejects.toBeInstanceOf(RateLimitError);
  });
  it("explains a refused customer list in plain words, without Stripe's text", async () => {
    stripe.listCustomers.mockRejectedValue(Object.assign(new Error("The provided key rk_live_x does not have rights"), { type: "StripePermissionError" }));
    const err = await sync().catch((e) => e);
    expect(err).toBeInstanceOf(RuleError);
    expect(err.message).toContain("STRIPE_SECRET_KEY");
    expect(err.message).not.toContain("rk_live");
  });
  it("writes one audit row with the counts only", async () => {
    stripe.listCustomers.mockResolvedValue([{ id: "cus_new", name: "Fresh Co", email: "fresh@x.test", phone: "555", metadata: {} }]);
    await sync();
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1);
    const entry = mocks.writeAudit.mock.calls[0]![1];
    expect(entry).toMatchObject({ action: "stripe.synced", entityType: "integration" });
    expect(JSON.stringify(entry)).not.toContain("fresh@x.test");
  });
  it("a failed audit write does not fail the sync", async () => {
    mocks.writeAudit.mockRejectedValue(new Error("down"));
    await expect(sync()).resolves.toMatchObject({ problems: 0 });
  });
});

describe("customers", () => {
  it("creates a client with an account for a customer the app has never seen", async () => {
    stripe.listCustomers.mockResolvedValue([{ id: "cus_new", name: null, email: null, phone: null, metadata: {} }]);
    const s = await sync();
    expect(repo.clients[0]).toMatchObject({ stripe_customer_id: "cus_new", business_name: "Unnamed", email: "no-email", status: "onboarding" });
    expect(repo.clients[0]!.account_id).not.toBeNull();
    expect(s).toMatchObject({ customersRead: 1, clientsCreated: 1, accountsLinked: 1 });
  });
  it("fills placeholders and blanks but never overwrites a value entered by hand", async () => {
    repo.clients.push(fakeClient({ stripe_customer_id: "cus_1", business_name: "Unnamed", email: "mine@acme.test", phone: null }));
    stripe.listCustomers.mockResolvedValue([{ id: "cus_1", name: "Acme", email: "stripe@acme.test", phone: "555", metadata: {} }]);
    const s = await sync();
    expect(repo.clients[0]).toMatchObject({ business_name: "Acme", email: "mine@acme.test", phone: "555" });
    expect(s.clientsUpdated).toBe(1);
  });
  it("links an account for an old client without one, and running twice changes nothing more", async () => {
    repo.clients.push(fakeClient({ stripe_customer_id: "cus_1", account_id: null }));
    stripe.listCustomers.mockResolvedValue([{ id: "cus_1", name: "Acme Bakery", metadata: {} }]);
    expect((await sync()).accountsLinked).toBe(1);
    const again = await sync();
    expect(again).toMatchObject({ accountsLinked: 0, clientsCreated: 0, clientsUpdated: 0 });
    expect(repo.accounts).toHaveLength(1);
  });
  it("one failing customer does not stop the rest", async () => {
    stripe.listCustomers.mockResolvedValue([{ id: "cus_bad" }, { id: "cus_ok", name: "Ok" }]);
    const real = repo.findClientByCustomer.bind(repo);
    vi.spyOn(repo, "findClientByCustomer").mockImplementation(async (id) => {
      if (id === "cus_bad") throw new Error("db");
      return real(id);
    });
    const s = await sync();
    expect(s).toMatchObject({ problems: 1, clientsCreated: 1 });
  });
});

describe("subscriptions", () => {
  it("sets price and next billing date from the first unfinished subscription and resumes a paused client", async () => {
    repo.clients.push(fakeClient({ stripe_customer_id: "cus_1", status: "paused" }));
    stripe.listSubscriptions.mockResolvedValue([
      { id: "sub_old", status: "canceled", items: { data: [{ price: { unit_amount: 100 } }] } },
      { id: "sub_live", status: "active", billing_cycle_anchor: sec("2026-01-20T00:00:00Z"), items: { data: [{ price: { unit_amount: 14900 } }] } },
    ]);
    const s = await sync();
    expect(repo.clients[0]).toMatchObject({ status: "active", subscription_price: 149, billing_anchor_date: "2026-11-20" });
    expect(s.statusChanges).toBe(1);
  });
  it("an 'incomplete' subscription still gives the price but does not resume a paused client", async () => {
    repo.clients.push(fakeClient({ stripe_customer_id: "cus_1", status: "paused" }));
    stripe.listSubscriptions.mockResolvedValue([{ id: "sub_1", status: "incomplete", items: { data: [{ price: { unit_amount: 4900 } }] } }]);
    await sync();
    expect(repo.clients[0]).toMatchObject({ status: "paused", subscription_price: 49 });
  });
  it("falls back to a schedule that has not started (price fetched, start date as is)", async () => {
    repo.clients.push(fakeClient({ stripe_customer_id: "cus_1" }));
    stripe.listSchedules.mockResolvedValue([
      { status: "released", phases: [] },
      { status: "not_started", phases: [{ start_date: sec("2026-12-01T00:00:00Z"), end_date: null, items: [{ price: "price_1" }] }] },
    ]);
    await sync();
    expect(stripe.retrievePriceAmount).toHaveBeenCalledWith("price_1");
    expect(repo.clients[0]).toMatchObject({ subscription_price: 49, billing_anchor_date: "2026-12-01" });
  });
});

describe("payments", () => {
  beforeEach(() => {
    repo.clients.push(fakeClient({ id: "c1", stripe_customer_id: "cus_1", lifetime_value: 0 }));
  });

  it("records a missed paid invoice once, with Stripe's paid time, and sets the lifetime value from the records", async () => {
    stripe.listPaidInvoices.mockResolvedValue([invoice({ subscriptionId: "sub_1" })]);
    const s = await sync();
    await sync();
    expect(repo.revenue).toHaveLength(1);
    expect(repo.revenue[0]).toMatchObject({ stripe_invoice_id: "in_1", client_id: "c1", amount: 99, status: "paid", event_type: "subscription", paid_at: "2026-03-02T00:00:00.000Z" });
    expect(repo.clients[0]!.lifetime_value).toBe(99);
    expect(s.paymentsRecorded).toBe(1);
  });
  it("skips invoices of no value", async () => {
    stripe.listPaidInvoices.mockResolvedValue([invoice({ amount_paid: 0 })]);
    await sync();
    expect(repo.revenue).toHaveLength(0);
  });
  it("turns a payment recorded as failed into paid, and clears a past_due it caused", async () => {
    repo.clients[0]!.status = "past_due";
    repo.revenue.push({ id: "r1", stripe_invoice_id: "in_1", client_id: "c1", amount: 99, status: "failed", event_type: "one_time", paid_at: null });
    stripe.listPaidInvoices.mockResolvedValue([invoice()]);
    const s = await sync();
    expect(repo.revenue[0]).toMatchObject({ status: "paid" });
    expect(repo.clients[0]!.status).toBe("active");
    expect(s).toMatchObject({ paymentsRecorded: 1, statusChanges: 1 });
  });
  it("records a standalone charge but not one that paid an invoice, nor a near-duplicate", async () => {
    repo.revenue.push({ id: "r0", stripe_invoice_id: "old_manual", client_id: "c1", amount: 20, status: "paid", event_type: "one_time", paid_at: "2026-05-01T00:00:30.000Z" });
    stripe.listPaidInvoices.mockResolvedValue([invoice()]);
    stripe.listCharges.mockResolvedValue([
      charge({ id: "ch_inv", amount: 9900, paymentIntentId: "pi_inv" }),
      charge({ id: "ch_solo" }),
      charge({ id: "ch_dupe", amount: 2000, created: sec("2026-05-01T00:00:00Z"), paymentIntentId: null }),
      charge({ id: "ch_failed", status: "failed" }),
    ]);
    await sync();
    expect(repo.revenue.map((r) => r.stripe_invoice_id).sort()).toEqual(["ch_solo", "in_1", "old_manual"]);
    expect(repo.clients[0]!.lifetime_value).toBe(169);
  });
  it("gives a charge the webhook recorded as unassigned to its client", async () => {
    repo.revenue.push({ id: "r9", stripe_invoice_id: "ch_solo", client_id: null, amount: 50, status: "paid", event_type: "one_time", paid_at: "2026-04-01T00:00:00.000Z" });
    stripe.listCharges.mockResolvedValue([charge({ id: "ch_solo" })]);
    const s = await sync();
    expect(repo.revenue).toHaveLength(1);
    expect(repo.revenue[0]!.client_id).toBe("c1");
    expect(s.paymentsRecorded).toBe(1);
  });
  it("skips charges when the invoice list failed (cannot tell them apart) and reports the problem", async () => {
    stripe.listPaidInvoices.mockRejectedValue(new Error("no"));
    stripe.listCharges.mockResolvedValue([charge()]);
    const s = await sync();
    expect(stripe.listCharges).not.toHaveBeenCalled();
    expect(s.problems).toBe(1);
  });
  it("lifts a hold after a later payment, and activates an onboarding client with a signed contract", async () => {
    Object.assign(repo.clients[0]!, { status: "onboarding", on_hold_since: "2026-02-01T00:00:00Z" });
    repo.contracts.set("c1", "signed");
    stripe.listPaidInvoices.mockResolvedValue([invoice()]);
    const s = await sync();
    expect(repo.clients[0]).toMatchObject({ on_hold_since: null, status: "active" });
    expect(s.statusChanges).toBe(2);
  });
  it("leaves an onboarding client alone when the contract is not signed", async () => {
    repo.clients[0]!.status = "onboarding";
    stripe.listPaidInvoices.mockResolvedValue([invoice()]);
    await sync();
    expect(repo.clients[0]!.status).toBe("onboarding");
  });
});

describe("payments without a Stripe customer (Payment Links)", () => {
  it("records each successful one once, unassigned, and skips failed or already recorded ones", async () => {
    stripe.listCustomerlessCharges.mockResolvedValue([
      charge({ id: "ch_link", amount: 50, created: sec("2026-11-06T14:06:00Z") }),
      charge({ id: "ch_failed", status: "failed" }),
      charge({ id: "ch_known" }),
    ]);
    repo.revenue.push({ id: "r1", stripe_invoice_id: "ch_known", client_id: null, amount: 50, status: "paid", event_type: "one_time", paid_at: "2026-11-01T00:00:00.000Z" });
    const s = await sync();
    expect(repo.revenue.find((r) => r.stripe_invoice_id === "ch_link")).toMatchObject({ client_id: null, amount: 0.5, status: "paid", paid_at: "2026-11-06T14:06:00.000Z" });
    expect(repo.revenue).toHaveLength(2);
    expect(s.paymentsRecorded).toBe(1);
    await sync();
    expect(repo.revenue).toHaveLength(2);
  });
  it("looks back about 13 months", async () => {
    await sync();
    const since = stripe.listCustomerlessCharges.mock.calls[0]![0] as number;
    expect(since).toBe(Math.floor(NOW.getTime() / 1000) - 400 * 86_400);
  });
  it("a failure there is reported but does not stop the rest", async () => {
    stripe.listCustomerlessCharges.mockRejectedValue(new Error("no"));
    repo.clients.push(fakeClient({ stripe_customer_id: "cus_1" }));
    const s = await sync();
    expect(s).toMatchObject({ problems: 1, clientsChecked: 1 });
  });
});

describe("time budget", () => {
  it("stops starting new clients when the budget is spent and says so", async () => {
    repo.clients.push(fakeClient({ stripe_customer_id: "cus_1" }), fakeClient({ stripe_customer_id: "cus_2" }));
    let t = 0;
    deps.clock = () => t;
    stripe.listCustomers.mockImplementation(async () => {
      t = SYNC_BUDGET_MS + 1;
      return [];
    });
    const s = await sync();
    expect(s).toMatchObject({ stoppedForTime: true, clientsChecked: 0, clientsTotal: 2 });
  });
});

describe("sync rules", () => {
  it("picks the first unfinished subscription", () => {
    expect(pickSyncSubscription([{ status: "canceled" }, { status: "incomplete_expired" }])).toBeNull();
    expect(pickSyncSubscription([{ status: "canceled" }, { status: "past_due" }])).toEqual({ status: "past_due" });
  });
  it("never stamps a backfilled invoice with today's date", () => {
    const row = syncedInvoiceRevenue(invoice({ status_transitions: null }), "c1");
    expect(row.paid_at).toBe("2026-03-01T00:00:00.000Z");
  });
  it("treats the same amount within a minute as the same payment", () => {
    const recorded = [{ amount: 50, paid_at: "2026-04-01T00:00:59.000Z" }];
    expect(shouldRecordCharge(charge(), new Set(), recorded)).toBe(false);
    expect(shouldRecordCharge(charge(), new Set(), [{ amount: 50, paid_at: "2026-04-01T00:01:01.000Z" }])).toBe(true);
    expect(shouldRecordCharge(charge({ amount: 0 }), new Set(), [])).toBe(false);
  });
  it("sums lifetime value in whole cents", () => {
    expect(lifetimeValueOf([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
  });
  it("lifts a hold only for a payment after it began", () => {
    expect(paidSinceHold(null, [{ paid_at: "2026-01-01T00:00:00Z" }])).toBe(false);
    expect(paidSinceHold("2026-02-01T00:00:00Z", [{ paid_at: "2026-01-01T00:00:00Z" }])).toBe(false);
    expect(paidSinceHold("2026-02-01T00:00:00Z", [{ paid_at: "2026-02-02T00:00:00Z" }])).toBe(true);
  });
  it("reads payment intents from both invoice shapes", () => {
    expect(invoicePaymentIntentIds({ payment_intent: "pi_a", payments: { data: [{ payment: { payment_intent: { id: "pi_b" } } }] } })).toEqual(["pi_a", "pi_b"]);
    expect(invoicePaymentIntentIds({})).toEqual([]);
  });
  it("words the result plainly", () => {
    const s: SyncSummary = { customersRead: 12, clientsCreated: 1, clientsUpdated: 0, accountsLinked: 0, clientsChecked: 12, clientsTotal: 12, paymentsRecorded: 3, statusChanges: 0, problems: 0, stoppedForTime: false };
    expect(syncMessage(s)).toBe("Read 12 Stripe customers and checked 12 of 12 clients: 1 new client, 0 clients filled in, 3 missing payments recorded, 0 status changes.");
    expect(syncMessage({ ...s, problems: 2, stoppedForTime: true })).toMatch(/2 steps could not be completed.*run it again to finish/);
  });
});
