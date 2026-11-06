// Billing domain: what a Stripe webhook event changes. Ported from the old app's webhook with the same business
// behaviour and the same race-safety; the comments explaining past bugs are kept.
// Deliberate differences: no push notifications (v2's activity_alerts job announces payments from revenue_events)
// and no sync_log rows (v2 keeps its own event ledger, integration_events).
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import type { StripeReads } from "@/platform/stripe/api";
import type { BillingRepo } from "./repo";
import { RepoError } from "./repo";
import {
  accountNameFor,
  backfillPatch,
  clientUpdateAfterPayment,
  currentSchedulePhase,
  customerIdOf,
  failedRevenueFields,
  getInvoiceSubscriptionId,
  ignoreTestModeEvent,
  isHandledEventType,
  isLiveSubscription,
  ledgerDecision,
  newClientFields,
  paidRevenueFields,
  phasePriceRef,
  phaseStartDate,
  restoreAfterStaleFailure,
  subscriptionFields,
  type CustomerLike,
  type InvoiceLike,
} from "./rules";

export interface BillingDeps {
  repo: BillingRepo;
  stripe: StripeReads;
  now: () => Date;
  /**
   * True when this delivery takes over an earlier attempt of the SAME event that failed or was abandoned. That
   * attempt may have saved the payment and then failed before updating the client; the retry then repairs the
   * client (status, hold) instead of skipping it because the payment row already exists.
   */
  retry?: boolean;
}

/** The parts of a Stripe event this domain reads. */
export interface StripeEventLike {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: unknown };
}

// --- helpers (each one a step of the old route) -----------------------------------------------

/** Every client needs an accounts parent. Creates one and links it, unless a concurrent caller linked one first. */
async function ensureAccountForClient(d: BillingDeps, clientId: string, name: string): Promise<void> {
  const client = await d.repo.getClient(clientId);
  if (!client || client.account_id) return;
  const accountId = await d.repo.insertAccount(name);
  const linked = await d.repo.linkAccount(clientId, accountId);
  if (linked === 0) await d.repo.deleteAccount(accountId);
}

/**
 * A payment can arrive for a Stripe customer the app has never seen (customer.created missed, or the customer
 * predates the webhook). Previously that payment was silently dropped. Create the client on the spot instead,
 * exactly as customer.created would.
 */
async function findOrCreateClient(d: BillingDeps, customerId: string | null): Promise<{ id: string } | null> {
  if (!customerId) return null;
  const existing = await d.repo.findClientByCustomer(customerId);
  if (existing) {
    // Repairs a client whose account link failed on an earlier attempt.
    if (!existing.account_id) await ensureAccountForClient(d, existing.id, existing.business_name);
    return { id: existing.id };
  }
  const customer = await d.stripe.retrieveCustomer(customerId);
  if (!customer) return null;
  const inserted = await d.repo.insertClient(newClientFields(customer));
  if (inserted === "conflict") {
    // customer.created (or a sync) inserted the same customer a moment ago: use their row.
    const raced = await d.repo.findClientByCustomer(customerId);
    if (raced) return { id: raced.id };
    throw new RepoError("create the client");
  }
  await ensureAccountForClient(d, inserted.id, accountNameFor(customer));
  return inserted;
}

/**
 * True when this invoice is already paid, by our own record or (when asked) by Stripe's live state. Stripe can
 * deliver invoice.payment_failed late or out of order; a failure notice for a paid invoice is stale and must not
 * mark the client past due. If the Stripe lookup fails, our own record decides.
 */
async function invoiceAlreadyPaid(d: BillingDeps, invoiceId: string, checkStripe: boolean): Promise<boolean> {
  const row = await d.repo.findRevenueByInvoice(invoiceId);
  if (row?.status === "paid") return true;
  if (!checkStripe) return false;
  try {
    return (await d.stripe.retrieveInvoiceStatus(invoiceId)) === "paid";
  } catch {
    return false;
  }
}

/** past_due is only set by a failed payment. With no failed invoice left, a remaining past_due is stale: clear it. */
async function clearStalePastDue(d: BillingDeps, clientId: string): Promise<void> {
  if (await d.repo.hasFailedRevenue(clientId)) return;
  await d.repo.updateClient(clientId, { status: "active" }, "past_due");
}

// --- one handler per event type ----------------------------------------------------------------

async function onCustomerCreated(d: BillingDeps, customer: CustomerLike): Promise<void> {
  const existing = await d.repo.findClientByCustomer(customer.id);
  let clientId = existing?.id;
  if (!clientId) {
    const inserted = await d.repo.insertClient(newClientFields(customer));
    if (inserted === "conflict") {
      const raced = await d.repo.findClientByCustomer(customer.id);
      if (!raced) throw new RepoError("create the client");
      clientId = raced.id;
    } else {
      clientId = inserted.id;
    }
  }
  // Outside the insert branch, so a retried delivery still links a client the first attempt already inserted.
  await ensureAccountForClient(d, clientId, accountNameFor(customer));
}

async function onCustomerUpdated(d: BillingDeps, customer: CustomerLike): Promise<void> {
  const existing = await d.repo.findClientByCustomer(customer.id);
  if (!existing) return;
  const patch = backfillPatch(existing, customer);
  if (Object.keys(patch).length > 0) await d.repo.updateClient(existing.id, patch);
}

/**
 * Archive, never delete: deleting used to cascade away requests, projects, documents and monitoring history, which
 * the SOPs require to be kept. An already-archived client keeps its original date.
 */
async function onCustomerDeleted(d: BillingDeps, customer: CustomerLike): Promise<void> {
  await d.repo.updateClientsByCustomer(customer.id, { archived_at: d.now().toISOString() }, { onlyIfNotArchived: true });
}

/**
 * invoice.payment_succeeded fires for a Stripe-collected payment; invoice.paid fires whenever an invoice becomes paid
 * by any path, including "mark as paid" for an out-of-band payment. Same body for both: the invoice-id checks below
 * de-duplicate when Stripe sends both.
 */
async function onInvoicePaid(d: BillingDeps, invoice: InvoiceLike & { customer?: unknown }): Promise<void> {
  const client = await findOrCreateClient(d, customerIdOf(invoice));
  if (!client) return;

  const existingRow = await d.repo.findRevenueByInvoice(invoice.id);
  const subId = getInvoiceSubscriptionId(invoice);
  // A retry of this same event that finds the payment already saved: an earlier attempt saved it and then failed.
  // Re-apply the client changes (status, hold, billing date), which are safe to repeat. The lifetime value is not
  // re-added: the earlier attempt may already have added it, and adding it twice would overstate it.
  if (existingRow && existingRow.status === "paid" && d.retry) {
    await applyClientAfterPayment(d, client.id, invoice, subId, { addLifetimeValue: false });
    return;
  }
  // A 'failed' row must not block recording the eventual successful retry: flip it to paid instead of skipping.
  if (existingRow && existingRow.status !== "failed") return;

  const paidFields = paidRevenueFields(invoice, client.id, subId, d.now());
  // Stripe sends payment_succeeded and paid together as two near-simultaneous requests. The read above is not a lock,
  // so each write reports whether THIS request won; only the winner updates the client (no double-counting).
  let won: number;
  if (existingRow) {
    won = await d.repo.updateRevenueIfStatus(existingRow.id, paidFields, "failed");
  } else {
    // A plain insert, not an upsert: the unique index on stripe_invoice_id is partial, and ON CONFLICT cannot use a
    // partial index (that failed every first-time paid invoice with 42P10 in the old app).
    const inserted = await d.repo.insertRevenue(paidFields);
    if (inserted !== "conflict") {
      won = 1;
    } else {
      // Something wrote this invoice first. If it was a racing payment_failed, the row is 'failed': flip it to paid,
      // or the payment is lost behind a 200. Only an already-'paid' row means a concurrent paid delivery won.
      const raced = await d.repo.findRevenueByInvoice(invoice.id);
      won = raced && raced.status === "failed" ? await d.repo.updateRevenueIfStatus(raced.id, paidFields, "failed") : 0;
    }
  }
  if (won === 0) return;
  await applyClientAfterPayment(d, client.id, invoice, subId, { addLifetimeValue: true });
}

/** The client side of a paid invoice: lifetime value, hold lifted, past_due/paused/onboarding back to active, billing date. */
async function applyClientAfterPayment(
  d: BillingDeps,
  clientId: string,
  invoice: InvoiceLike,
  subId: string | null,
  opts: { addLifetimeValue: boolean },
): Promise<void> {
  const client = { id: clientId };
  const current = await d.repo.getClient(client.id);
  if (!current) throw new RepoError("read the client");

  let liveSubscription: Awaited<ReturnType<StripeReads["retrieveSubscription"]>> | null = null;
  if (subId) {
    try {
      liveSubscription = await d.stripe.retrieveSubscription(subId);
    } catch {
      // Non-fatal, as in the old app: the payment is still recorded, only the billing date is not refreshed.
      console.warn("stripe webhook: subscription lookup failed after a payment");
    }
  }
  // Only an onboarding client needs the contract: they become active once the contract is signed or exempt.
  const contractStatus = current.status === "onboarding" ? await d.repo.projectContractStatus(client.id) : null;
  const update = clientUpdateAfterPayment({ current, amountPaidCents: invoice.amount_paid ?? 0, liveSubscription, contractStatus, now: d.now() });
  if (!opts.addLifetimeValue) delete (update as { lifetime_value?: number }).lifetime_value;
  await d.repo.updateClient(client.id, update);
}

async function onInvoicePaymentFailed(d: BillingDeps, invoice: InvoiceLike & { customer?: unknown }): Promise<void> {
  const client = await findOrCreateClient(d, customerIdOf(invoice));
  if (!client) return;

  // A stale failure for an invoice since paid: ignore it, and repair a past_due an interrupted run may have left.
  if (await invoiceAlreadyPaid(d, invoice.id, true)) {
    await clearStalePastDue(d, client.id);
    return;
  }

  const existing = await d.repo.findRevenueByInvoice(invoice.id);
  if (!existing) {
    // "conflict": a concurrent delivery wrote this invoice first; the re-checks below decide whether it was paid.
    await d.repo.insertRevenue(failedRevenueFields(invoice, client.id, getInvoiceSubscriptionId(invoice)));
  }

  const before = await d.repo.getClient(client.id);
  if (!before) throw new RepoError("read the client");

  // An invoice.paid for this invoice may have landed while this request was running.
  if (await invoiceAlreadyPaid(d, invoice.id, false)) return;

  // Conditional on the status just read. 0 rows = something changed it in between: if the invoice is now paid, stop;
  // otherwise the failure is real.
  const marked = await d.repo.updateClient(client.id, { status: "past_due" }, before.status);
  if (marked === 0) {
    if (await invoiceAlreadyPaid(d, invoice.id, false)) return;
    await d.repo.updateClient(client.id, { status: "past_due" });
  }

  // Write first, then look: invoice.paid writes its paid row before it reads the client, so if it slipped in after
  // the check above this read sees it. Undo our past_due (only if it is still ours).
  if (await invoiceAlreadyPaid(d, invoice.id, false)) {
    await d.repo.updateClient(client.id, { status: restoreAfterStaleFailure(before.status) as "active" }, "past_due");
  }
}

async function onChargeSucceeded(d: BillingDeps, charge: Record<string, unknown>): Promise<void> {
  // Charges tied to invoices are handled by invoice.paid. charge.invoice was removed in API 2025-03-31.basil, so the
  // link is resolved through InvoicePayments too; relying on the legacy field alone recorded every invoice payment
  // twice (once by in_..., once by ch_...).
  if (charge.invoice) return;
  const pi = charge.payment_intent;
  const paymentIntentId = typeof pi === "string" ? pi : pi && typeof pi === "object" && typeof (pi as { id?: unknown }).id === "string" ? (pi as { id: string }).id : null;
  if (paymentIntentId && (await d.stripe.paymentIntentHasInvoice(paymentIntentId))) return;

  const customerId = customerIdOf(charge);
  if (!customerId) return;
  const client = await d.repo.findClientByCustomer(customerId);
  if (!client) return;

  const chargeId = charge.id as string;
  if (await d.repo.findRevenueByInvoice(chargeId)) {
    // A retry after an earlier attempt saved the charge and then failed: lift the hold (safe to repeat), but do
    // not add the amount to the lifetime value a second time.
    if (d.retry && client.on_hold_since) await d.repo.updateClient(client.id, { on_hold_since: null });
    return;
  }
  const amount = Number(charge.amount ?? 0) / 100;
  const inserted = await d.repo.insertRevenue({
    stripe_invoice_id: chargeId,
    client_id: client.id,
    amount,
    status: "paid",
    event_type: "one_time",
    paid_at: new Date(Number(charge.created ?? 0) * 1000).toISOString(),
  });
  // A concurrent delivery already recorded this charge.
  if (inserted === "conflict") return;
  // A standalone payment lifts a hold too, same as invoice.paid.
  await d.repo.updateClient(client.id, {
    lifetime_value: client.lifetime_value + amount,
    ...(client.on_hold_since ? { on_hold_since: null } : {}),
  });
}

/**
 * customer.subscription.created and .updated. Only .updated was handled once, so the price and billing date stayed
 * empty until something later changed the subscription; creation is just the first change.
 */
async function onSubscriptionChanged(d: BillingDeps, sub: Record<string, unknown>): Promise<void> {
  const customerId = customerIdOf(sub) ?? "";
  const fields = subscriptionFields(sub as Parameters<typeof subscriptionFields>[0], d.now());
  if (Object.keys(fields).length > 0) await d.repo.updateClientsByCustomer(customerId, fields);

  // 'paused' only ever comes from subscription.deleted. A live subscription means they are back.
  const live = { status: String(sub.status), pause_collection: sub.pause_collection };
  if (isLiveSubscription(live) && (await d.repo.countClientsByCustomer(customerId, "paused")) > 0) {
    // Stripe does not guarantee event order and retries for days, so this payload can predate the deletion.
    // Only resume on the subscription's current state.
    const current = await d.stripe.retrieveSubscription(String(sub.id));
    if (isLiveSubscription(current)) await d.repo.updateClientsByCustomer(customerId, { status: "active" }, { onlyIfStatus: "paused" });
  }
}

async function onScheduleChanged(d: BillingDeps, schedule: Record<string, unknown>): Promise<void> {
  const customerId = customerIdOf(schedule) ?? "";
  const phase = currentSchedulePhase(schedule as Parameters<typeof currentSchedulePhase>[0], d.now());
  if (!phase) return;
  const ref = phasePriceRef(phase);
  let amount: number | null = null;
  if (ref && "amount" in ref) amount = ref.amount;
  // Unlike a live subscription's items, a schedule phase's price is not embedded by default: fetch it.
  else if (ref && "priceId" in ref) amount = await d.stripe.retrievePriceAmount(ref.priceId);

  const fields: { subscription_price?: number; billing_anchor_date?: string } = {};
  if (amount !== null) fields.subscription_price = amount / 100;
  const start = phaseStartDate(phase);
  if (start) fields.billing_anchor_date = start;
  if (Object.keys(fields).length > 0) await d.repo.updateClientsByCustomer(customerId, fields);
}

/** Pause only when this was the customer's last live subscription (replacing a subscription used to pause a paying client). */
async function onSubscriptionDeleted(d: BillingDeps, sub: Record<string, unknown>): Promise<void> {
  const customerId = customerIdOf(sub);
  if (!customerId) return;
  const others = await d.stripe.listSubscriptions(customerId);
  if (others.some((s) => s.id !== sub.id && isLiveSubscription(s))) return;
  await d.repo.updateClientsByCustomer(customerId, { status: "paused" });
}

/** Applies one verified event. Throws on any failure, so the caller answers 500 and Stripe retries. */
export async function handleStripeEvent(actor: Actor, event: StripeEventLike, d: BillingDeps): Promise<"handled" | "ignored"> {
  assertCan(actor, "billing.ingest");
  const obj = event.data.object as Record<string, unknown>;
  switch (event.type) {
    case "customer.created":
      await onCustomerCreated(d, obj as unknown as CustomerLike);
      return "handled";
    case "customer.updated":
      await onCustomerUpdated(d, obj as unknown as CustomerLike);
      return "handled";
    case "customer.deleted":
      await onCustomerDeleted(d, obj as unknown as CustomerLike);
      return "handled";
    case "invoice.payment_succeeded":
    case "invoice.paid":
      await onInvoicePaid(d, obj as unknown as InvoiceLike);
      return "handled";
    case "invoice.payment_failed":
      await onInvoicePaymentFailed(d, obj as unknown as InvoiceLike);
      return "handled";
    case "charge.succeeded":
      await onChargeSucceeded(d, obj);
      return "handled";
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await onSubscriptionChanged(d, obj);
      return "handled";
    case "subscription_schedule.created":
    case "subscription_schedule.updated":
      await onScheduleChanged(d, obj);
      return "handled";
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(d, obj);
      return "handled";
    default:
      return "ignored";
  }
}

// --- the ledger around it -------------------------------------------------------------------------

export type IngestOutcome =
  | { result: "processed" }
  | { result: "ignored"; reason: "unhandled_type" | "test_mode_event_in_production" }
  | { result: "duplicate" }
  | { result: "in_flight" };

export class IngestError extends Error {
  constructor(readonly short: string) {
    super(short);
    this.name = "IngestError";
  }
}

/** A short error for the ledger: our own generic messages, never text that could carry customer data. */
function ledgerError(e: unknown): string {
  if (e instanceof RepoError) return e.message;
  if (e instanceof Error) return `Unexpected ${e.name}`;
  return "Unexpected error";
}

/**
 * Records a verified event in the ledger and applies it once. Stripe retries deliveries, so the same event can
 * arrive several times: an event already processed answers "duplicate", one being processed right now "in_flight"
 * (Stripe then retries later), and a failed or abandoned one is taken over and processed again.
 */
export async function ingestStripeEvent(actor: Actor, event: StripeEventLike, d: BillingDeps, appEnv: string | undefined, vercelEnv?: string | undefined): Promise<IngestOutcome> {
  assertCan(actor, "billing.ingest");

  // Production holds only real business data: a correctly signed test-mode event is acknowledged and ignored.
  const ignoreReason = ignoreTestModeEvent(event.livemode, appEnv, vercelEnv) ? "test_mode_event_in_production" : !isHandledEventType(event.type) ? "unhandled_type" : null;
  if (ignoreReason) {
    await d.repo.insertLedger({ id: event.id, type: event.type, livemode: event.livemode, status: "ignored" });
    return { result: "ignored", reason: ignoreReason };
  }

  if ((await d.repo.insertLedger({ id: event.id, type: event.type, livemode: event.livemode, status: "processing" })) === "conflict") {
    const existing = await d.repo.getLedger(event.id);
    if (!existing) throw new IngestError("Could not read the event");
    const decision = ledgerDecision(existing, d.now());
    if (decision === "duplicate") return { result: "duplicate" };
    if (decision === "in_flight") return { result: "in_flight" };
    if (!(await d.repo.reclaimLedger(event.id, existing))) return { result: "in_flight" };
    d = { ...d, retry: true };
  }

  try {
    await handleStripeEvent(actor, event, d);
  } catch (e) {
    const short = ledgerError(e);
    try {
      await d.repo.finishLedger(event.id, "failed", short);
    } catch {
      /* the event stays 'processing' and is taken over after it goes stale */
    }
    throw new IngestError(short);
  }
  await d.repo.finishLedger(event.id, "processed", null);
  return { result: "processed" };
}
