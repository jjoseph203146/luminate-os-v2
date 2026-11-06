import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { DELETE, GET, POST, routeDeps } from "./route";
import { FakeBillingRepo, fakeClient } from "@/domains/billing/fake-repo";
import type { StripeReads } from "@/platform/stripe/api";

// Made-up values in the right format; nothing here talks to Stripe.
const KEY = "sk_test_0123456789abcdefFAKE";
const LIVE = "whsec_live0123456789FAKEsecret";
const TEST = "whsec_test0123456789FAKEsecret";
const signer = new Stripe(KEY);

let repo: FakeBillingRepo;
const saved = { ...process.env };
const realBilling = routeDeps.billing;

function payload(over: { id?: string; type?: string; livemode?: boolean; object?: Record<string, unknown> } = {}) {
  return JSON.stringify({
    id: over.id ?? "evt_1",
    object: "event",
    type: over.type ?? "customer.updated",
    livemode: over.livemode ?? true,
    created: 1_790_000_000,
    data: { object: over.object ?? { id: "cus_1", object: "customer", name: "Acme Bakery" } },
  });
}

function post(body: string, opts: { secret?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...opts.headers };
  if (opts.secret !== null) headers["stripe-signature"] = signer.webhooks.generateTestHeaderString({ payload: body, secret: opts.secret ?? LIVE });
  return POST(new Request("https://www.luminateos.app/api/webhooks/stripe", { method: "POST", headers, body }));
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = KEY;
  process.env.STRIPE_WEBHOOK_SECRET = LIVE;
  process.env.STRIPE_WEBHOOK_SECRET_TEST = TEST;
  process.env.APP_ENV = "production";
  repo = new FakeBillingRepo();
  repo.clients.push(fakeClient({ id: "c1", stripe_customer_id: "cus_1", business_name: "Unnamed" }));
  const stripe = {
    retrieveCustomer: vi.fn(),
    retrieveInvoiceStatus: vi.fn(async () => "open"),
    retrieveSubscription: vi.fn(),
    listSubscriptions: vi.fn(async () => []),
    retrievePriceAmount: vi.fn(),
    paymentIntentHasInvoice: vi.fn(async () => false),
  } as unknown as StripeReads;
  routeDeps.billing = () => ({ repo, stripe, now: () => new Date() });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  routeDeps.billing = realBilling;
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe("configuration and method", () => {
  it("answers 503 when Stripe is not configured", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect((await post(payload())).status).toBe(503);
  });
  it("answers 503 when no webhook signing secret is set", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET_TEST;
    expect((await post(payload())).status).toBe(503);
  });
  it("only accepts POST", async () => {
    for (const handler of [GET, DELETE]) {
      const res = handler();
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });
  it("refuses a body over 512 KB, by declared length or by actual size", async () => {
    expect((await post(payload(), { headers: { "content-length": String(600 * 1024) } })).status).toBe(413);
    const big = payload({ object: { id: "cus_1", object: "customer", name: "x".repeat(600 * 1024) } });
    expect((await post(big)).status).toBe(413);
  });
});

describe("signatures", () => {
  it("refuses a missing or wrong signature, and never touches the database", async () => {
    expect((await post(payload(), { secret: null })).status).toBe(400);
    expect((await post(payload(), { secret: "whsec_someoneElse0123456789" })).status).toBe(400);
    expect(repo.ledger.size).toBe(0);
  });
  it("refuses a payload changed after signing", async () => {
    const body = payload();
    const sig = signer.webhooks.generateTestHeaderString({ payload: body, secret: LIVE });
    const res = await POST(new Request("https://x/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": sig }, body: body.replace("Acme", "Evil") }));
    expect(res.status).toBe(400);
  });
  it("accepts a valid live signature and processes the event", async () => {
    const res = await post(payload());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(repo.clients[0]!.business_name).toBe("Acme Bakery");
    expect(repo.ledger.get("evt_1")?.status).toBe("processed");
  });
  it("tries the live secret, then the test secret: a test-endpoint event verifies even though the live secret is set", async () => {
    process.env.APP_ENV = "staging";
    const res = await post(payload({ id: "evt_t", livemode: false }), { secret: TEST });
    expect(res.status).toBe(200);
    expect(repo.ledger.get("evt_t")?.status).toBe("processed");
  });
  it("works with only a live secret configured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET_TEST;
    expect((await post(payload())).status).toBe(200);
  });
});

describe("test-mode events", () => {
  it("are acknowledged and ignored in production", async () => {
    const res = await post(payload({ id: "evt_tm", livemode: false }), { secret: TEST });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: "test_mode_event_in_production" });
    expect(repo.clients[0]!.business_name).toBe("Unnamed");
    expect(repo.ledger.get("evt_tm")?.status).toBe("ignored");
  });
  it("are processed outside production", async () => {
    process.env.APP_ENV = "staging";
    await post(payload({ id: "evt_tm2", livemode: false }), { secret: TEST });
    expect(repo.clients[0]!.business_name).toBe("Acme Bakery");
  });
});

describe("delivery bookkeeping", () => {
  it("an unhandled type is acknowledged and ignored", async () => {
    const res = await post(payload({ id: "evt_u", type: "invoice.created", object: { id: "in_1", object: "invoice" } }));
    expect(await res.json()).toEqual({ received: true, ignored: "unhandled_type" });
  });
  it("a repeated delivery answers 200 duplicate and changes nothing", async () => {
    await post(payload());
    repo.clients[0]!.business_name = "Hand Edited";
    const res = await post(payload());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(repo.clients[0]!.business_name).toBe("Hand Edited");
  });
  it("an event still being processed answers 409, so Stripe retries later", async () => {
    repo.ledger.set("evt_1", { status: "processing", attempts: 1, claimed_at: new Date().toISOString(), type: "customer.updated", livemode: true, error: null });
    expect((await post(payload())).status).toBe(409);
  });
  it("a previously failed event is taken over and processed", async () => {
    repo.ledger.set("evt_1", { status: "failed", attempts: 1, claimed_at: new Date().toISOString(), type: "customer.updated", livemode: true, error: "Could not update the client" });
    expect((await post(payload())).status).toBe(200);
    expect(repo.ledger.get("evt_1")).toMatchObject({ status: "processed", attempts: 2 });
  });
  it("a processing error answers 500 (Stripe retries), marks the event failed, and logs no customer data", async () => {
    vi.spyOn(repo, "updateClient").mockRejectedValueOnce(new Error("boom for jane@acme.test"));
    const res = await post(payload());
    expect(res.status).toBe(500);
    expect(repo.ledger.get("evt_1")).toMatchObject({ status: "failed", error: "Unexpected Error" });
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
    expect(logged).not.toContain("jane@acme.test");
    expect(logged).not.toContain("Acme Bakery");
    expect(logged).toContain("customer.updated");
  });
  it("never echoes the payload back", async () => {
    const res = await post(payload());
    expect(await res.text()).not.toContain("Acme");
  });
});
