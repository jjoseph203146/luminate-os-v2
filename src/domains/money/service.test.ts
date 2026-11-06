import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  paidPaymentsSince: vi.fn(),
  listMoneyClients: vi.fn(),
  lastStripeEventAt: vi.fn(),
  getCalendar: vi.fn(),
}));
vi.mock("./repo", () => ({ paidPaymentsSince: mocks.paidPaymentsSince, listMoneyClients: mocks.listMoneyClients, lastStripeEventAt: mocks.lastStripeEventAt }));
vi.mock("@/domains/admin/service", () => ({ getCalendar: mocks.getCalendar }));
vi.mock("@/platform/db/server", () => ({ readDb: vi.fn(async () => ({})) }));

import { getMoneyOverview } from "./service";
import { PermissionError } from "@/platform/errors";
import type { StripeMoneyReads } from "@/platform/stripe/money-api";

const owner = { type: "owner", userId: "u1", email: null, ip: null } as const;
const NOW = new Date("2026-11-06T15:00:00Z");
let stripe: { listSubscriptions: ReturnType<typeof vi.fn>; listOpenInvoices: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.paidPaymentsSince.mockResolvedValue([{ amount: 12.84, paid_at: "2026-11-02T12:00:00Z" }]);
  mocks.listMoneyClients.mockResolvedValue([]);
  mocks.lastStripeEventAt.mockResolvedValue("2026-11-06T14:48:00Z");
  mocks.getCalendar.mockResolvedValue({ timeZone: "America/New_York" });
  stripe = { listSubscriptions: vi.fn(async () => []), listOpenInvoices: vi.fn(async () => []) };
});

const run = (s: StripeMoneyReads | null = stripe as unknown as StripeMoneyReads) => getMoneyOverview(owner, { stripe: s, now: () => NOW });

describe("getMoneyOverview", () => {
  it("is for the owner only (not the assistant, jobs or Stripe)", async () => {
    for (const actor of [{ type: "ai", name: "mcp" }, { type: "system", name: "jobs" }, { type: "integration", name: "stripe" }] as const) {
      await expect(getMoneyOverview(actor, { stripe: null, now: () => NOW })).rejects.toBeInstanceOf(PermissionError);
    }
    expect(mocks.paidPaymentsSince).not.toHaveBeenCalled();
  });
  it("reads payments back to before the start of last month", async () => {
    await run();
    const since = Date.parse(mocks.paidPaymentsSince.mock.calls[0]![1]);
    expect(since).toBeLessThan(Date.parse("2026-10-01T00:00:00Z"));
  });
  it("is live when Stripe answers", async () => {
    const o = await run();
    expect(o).toMatchObject({ stripe: "live", lastEventAt: "2026-11-06T14:48:00Z", collected: { cents: 1284 } });
    expect(o.mrr).not.toBeNull();
  });
  it("says not set up without a key, and unavailable (with no Stripe text logged) when Stripe fails", async () => {
    expect((await run(null)).stripe).toBe("not_set_up");
    stripe.listOpenInvoices.mockRejectedValue(Object.assign(new Error("Customer jane@x.test …"), { type: "StripePermissionError" }));
    const o = await run();
    expect(o).toMatchObject({ stripe: "unavailable", mrr: null, attention: null, collected: { cents: 1284 } });
    expect(JSON.stringify((console.warn as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("jane@");
  });
});
