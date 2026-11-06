import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ writeAudit: vi.fn() }));
vi.mock("@/platform/audit/audit", () => ({ writeAudit: mocks.writeAudit }));

import { resendInvoice, type InvoiceSendDeps } from "./service";
import { invoiceRefusedMessage, invoiceSendBlock, invoiceSentMessage, INVOICE_ID_PATTERN } from "./rules";
import { PermissionError, RateLimitError, RuleError, ValidationError } from "@/platform/errors";
import type { InvoiceSender } from "@/platform/stripe/invoices";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const INV = "in_1AbCdEfGhIjK";
let n = 0;
/** A fresh owner per test, so the in-memory send limit never leaks between tests. */
const owner = () => ({ type: "owner", userId: `owner-${++n}`, email: null, ip: null }) as const;

let sender: { retrieve: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
let deps: InvoiceSendDeps;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeAudit.mockResolvedValue(undefined);
  sender = {
    retrieve: vi.fn(async () => ({ id: INV, customerId: "cus_A", status: "open", number: "ABC-0012", hostedUrl: "https://invoice.stripe.com/i/abc" })),
    send: vi.fn(async () => {}),
  };
  deps = { sender: sender as unknown as InvoiceSender, findInvoice: vi.fn(async () => ({ stripeCustomerId: "cus_A" })), now: () => 1_000_000 };
});

describe("resendInvoice", () => {
  it("asks Stripe to email the invoice and says so, with an audit row", async () => {
    const actor = owner();
    expect(await resendInvoice(actor, { clientId: CLIENT, invoiceId: INV }, deps)).toEqual({ message: "Invoice ABC-0012 was emailed to the client by Stripe." });
    expect(sender.send).toHaveBeenCalledWith(INV);
    expect(mocks.writeAudit).toHaveBeenCalledWith(actor, expect.objectContaining({ action: "invoice.resent", entityId: INV, clientId: CLIENT }));
  });
  it("says a paid invoice is already paid", async () => {
    sender.retrieve.mockResolvedValueOnce({ id: INV, customerId: "cus_A", status: "paid", number: "ABC-0012", hostedUrl: null });
    expect((await resendInvoice(owner(), { clientId: CLIENT, invoiceId: INV }, deps)).message).toContain("already paid");
  });
  it("refuses an invoice that is not recorded for this client, without asking Stripe", async () => {
    deps.findInvoice = vi.fn(async () => null);
    await expect(resendInvoice(owner(), { clientId: CLIENT, invoiceId: INV }, deps)).rejects.toThrow("not recorded for this client");
    expect(sender.retrieve).not.toHaveBeenCalled();
  });
  it("refuses when Stripe's invoice belongs to another customer, without sending", async () => {
    sender.retrieve.mockResolvedValueOnce({ id: INV, customerId: "cus_OTHER", status: "open", number: "X", hostedUrl: null });
    await expect(resendInvoice(owner(), { clientId: CLIENT, invoiceId: INV }, deps)).rejects.toThrow("different Stripe customer");
    deps.findInvoice = vi.fn(async () => ({ stripeCustomerId: null }));
    await expect(resendInvoice(owner(), { clientId: CLIENT, invoiceId: INV }, deps)).rejects.toBeInstanceOf(RuleError);
    expect(sender.send).not.toHaveBeenCalled();
  });
  it("does not send a draft, void or uncollectible invoice", async () => {
    for (const status of ["draft", "void", "uncollectible"]) {
      sender.retrieve.mockResolvedValueOnce({ id: INV, customerId: "cus_A", status, number: "X", hostedUrl: null });
      await expect(resendInvoice(owner(), { clientId: CLIENT, invoiceId: INV }, deps)).rejects.toBeInstanceOf(RuleError);
    }
    expect(sender.send).not.toHaveBeenCalled();
  });
  it("shows Stripe's reason and the payment page when Stripe refuses", async () => {
    sender.send.mockRejectedValueOnce(Object.assign(new Error("You can only manually send an invoice if its collection method is 'send_invoice'."), { type: "StripeInvalidRequestError" }));
    const err = await resendInvoice(owner(), { clientId: CLIENT, invoiceId: INV }, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RuleError);
    expect((err as Error).message).toContain("collection method is 'send_invoice'");
    expect((err as Error).message).toContain("https://invoice.stripe.com/i/abc");
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
  it("says plainly when sending is not set up (no STRIPE_INVOICE_KEY)", async () => {
    await expect(resendInvoice(owner(), { clientId: CLIENT, invoiceId: INV }, { ...deps, sender: null })).rejects.toThrow("STRIPE_INVOICE_KEY");
  });
  it("says so when Stripe cannot find the invoice", async () => {
    sender.retrieve.mockRejectedValueOnce(new Error("No such invoice"));
    await expect(resendInvoice(owner(), { clientId: CLIENT, invoiceId: INV }, deps)).rejects.toThrow("could not find");
  });
  it("still reports success when the audit write fails after the email went (a retry would email twice)", async () => {
    mocks.writeAudit.mockRejectedValueOnce(new Error("audit down"));
    await expect(resendInvoice(owner(), { clientId: CLIENT, invoiceId: INV }, deps)).resolves.toBeDefined();
  });
  it("refuses bad input: a charge id, a non-uuid client", async () => {
    await expect(resendInvoice(owner(), { clientId: CLIENT, invoiceId: "ch_1AbCdEfGhIjK" }, deps)).rejects.toBeInstanceOf(ValidationError);
    await expect(resendInvoice(owner(), { clientId: "x", invoiceId: INV }, deps)).rejects.toBeInstanceOf(ValidationError);
    expect(sender.send).not.toHaveBeenCalled();
  });
  it("allows at most five sends a minute per owner", async () => {
    const actor = owner();
    for (let i = 0; i < 5; i++) await resendInvoice(actor, { clientId: CLIENT, invoiceId: INV }, deps);
    await expect(resendInvoice(actor, { clientId: CLIENT, invoiceId: INV }, deps)).rejects.toBeInstanceOf(RateLimitError);
    await expect(resendInvoice(actor, { clientId: CLIENT, invoiceId: INV }, { ...deps, now: () => 1_000_000 + 61_000 })).resolves.toBeDefined();
  });
  it("is for the owner only: not the Stripe webhook, the AI assistant or a job", async () => {
    for (const actor of [{ type: "integration", name: "stripe" }, { type: "ai", name: "mcp" }, { type: "system", name: "jobs" }]) {
      await expect(resendInvoice(actor as never, { clientId: CLIENT, invoiceId: INV }, deps)).rejects.toBeInstanceOf(PermissionError);
    }
  });
});

describe("invoice rules", () => {
  it("recognises invoice ids only", () => {
    expect(INVOICE_ID_PATTERN.test("in_1AbCdEfGhIjK")).toBe(true);
    expect(INVOICE_ID_PATTERN.test("ch_1AbCdEfGhIjK")).toBe(false);
    expect(INVOICE_ID_PATTERN.test("in_short")).toBe(false);
  });
  it("blocks drafts, void and uncollectible invoices; allows open and paid", () => {
    expect(invoiceSendBlock("draft")).toContain("draft");
    expect(invoiceSendBlock("void")).toContain("voided");
    expect(invoiceSendBlock("uncollectible")).toContain("uncollectible");
    expect(invoiceSendBlock("open")).toBeNull();
    expect(invoiceSendBlock("paid")).toBeNull();
  });
  it("words the results plainly", () => {
    expect(invoiceSentMessage(null, "open")).toBe("The invoice was emailed to the client by Stripe.");
    expect(invoiceRefusedMessage(null, null)).toBe("Stripe did not send it: no reason given.");
    expect(invoiceRefusedMessage("x", "http://not-https.example")).toBe("Stripe did not send it: x.");
  });
});
