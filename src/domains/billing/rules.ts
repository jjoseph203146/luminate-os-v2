// Pure rules for the Stripe webhook. No database, no network, no clock reads: `now` is passed in.
// Ported from the old app's src/app/api/webhooks/stripe/route.ts; the comments that explain past bugs are kept.
import { monthDayClamped } from "@/platform/calendar/business-days";

/** The event types the webhook acts on. Every other type is acknowledged and ignored. */
export const HANDLED_EVENT_TYPES = [
  "customer.created",
  "customer.updated",
  "customer.deleted",
  "invoice.payment_succeeded",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "subscription_schedule.created",
  "subscription_schedule.updated",
] as const;

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

export function isHandledEventType(type: string): type is HandledEventType {
  return (HANDLED_EVENT_TYPES as readonly string[]).includes(type);
}

/** Subscription statuses that mean the customer is actively subscribed. */
export const RESUMING_STATUSES = new Set(["active", "trialing"]);

export function isLiveSubscription(sub: { status: string; pause_collection?: unknown }): boolean {
  return RESUMING_STATUSES.has(sub.status) && !sub.pause_collection;
}

/** Postgres unique_violation: another request already wrote this row. */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

/**
 * The next billing date, entirely in UTC.
 * The old app's first version mixed getUTCDate() with local-time Date construction, which drifted by one day
 * around month boundaries in non-UTC time zones.
 */
export function nextBillingDate(anchorTimestamp: number, now: Date): string {
  const billingDay = new Date(anchorTimestamp * 1000).getUTCDate();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  // In a shorter month the date moves to the month's last day (the 31st was once pushed into the next month:
  // Feb 31 became Mar 3).
  const candidate = monthDayClamped(year, month, billingDay);
  if (new Date(`${candidate}T00:00:00Z`) > now) return candidate;
  return monthDayClamped(year, month + 1, billingDay);
}

type Ref = string | { id?: unknown } | null | undefined;

function idOf(ref: Ref): string | null {
  if (typeof ref === "string") return ref;
  if (ref && typeof ref === "object" && typeof ref.id === "string") return ref.id;
  return null;
}

/** The customer id from an object whose `customer` is an id or an expanded customer. */
export function customerIdOf(obj: { customer?: unknown }): string | null {
  return idOf(obj.customer as Ref);
}

/**
 * Stripe API 2026-01-28.clover moved invoice.subscription to invoice.parent.subscription_details.subscription.
 * Both shapes are checked, so an API version change never silently tags every subscription payment 'one_time'.
 */
export function getInvoiceSubscriptionId(invoice: unknown): string | null {
  const raw = (invoice ?? {}) as Record<string, unknown>;
  const legacy = idOf(raw.subscription as Ref);
  if (legacy) return legacy;
  const parent = raw.parent as Record<string, unknown> | undefined;
  const details = parent?.subscription_details as Record<string, unknown> | undefined;
  return idOf(details?.subscription as Ref);
}

export interface CustomerLike {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  metadata?: Record<string, string> | null;
}

/** A new client from a Stripe customer, with the old app's placeholders for missing values. */
export function newClientFields(customer: CustomerLike) {
  return {
    stripe_customer_id: customer.id,
    business_name: customer.name || "Unnamed",
    contact_name: customer.metadata?.contact_name || "Unknown",
    email: customer.email || "no-email",
    phone: customer.phone || null,
    status: "onboarding" as const,
  };
}

/** The account name for a client created from a customer. */
export const accountNameFor = (customer: CustomerLike) => customer.name || "Unnamed";

export interface ExistingContact {
  business_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * customer.updated only fills a field that is genuinely blank or still the customer.created placeholder,
 * never a value already entered by hand (same rule as the old Sync Stripe Customers button).
 */
export type ContactPatch = { business_name?: string; contact_name?: string; email?: string; phone?: string };

export function backfillPatch(existing: ExistingContact, customer: CustomerLike): ContactPatch {
  const patch: ContactPatch = {};
  if ((!existing.email || existing.email === "no-email") && customer.email) patch.email = customer.email;
  if ((!existing.business_name || existing.business_name === "Unnamed") && customer.name) patch.business_name = customer.name;
  if ((!existing.contact_name || existing.contact_name === "Unknown") && customer.metadata?.contact_name) patch.contact_name = customer.metadata.contact_name;
  if (!existing.phone && customer.phone) patch.phone = customer.phone;
  return patch;
}

export interface InvoiceLike {
  id: string;
  amount_paid?: number | null;
  amount_due?: number | null;
  status_transitions?: { paid_at?: number | null } | null;
}

/** The revenue_events row for a paid invoice. Stripe's own paid time, so a late delivery lands in the right month. */
export function paidRevenueFields(invoice: InvoiceLike, clientId: string, subscriptionId: string | null, now: Date) {
  const paidAt = invoice.status_transitions?.paid_at;
  return {
    stripe_invoice_id: invoice.id,
    client_id: clientId,
    amount: (invoice.amount_paid ?? 0) / 100,
    status: "paid" as const,
    event_type: subscriptionId ? "subscription" : "one_time",
    paid_at: paidAt ? new Date(paidAt * 1000).toISOString() : now.toISOString(),
  };
}

/** The revenue_events row for a failed invoice payment. */
export function failedRevenueFields(invoice: InvoiceLike, clientId: string, subscriptionId: string | null) {
  return {
    stripe_invoice_id: invoice.id,
    client_id: clientId,
    amount: (invoice.amount_due ?? 0) / 100,
    status: "failed" as const,
    event_type: subscriptionId ? "subscription" : "one_time",
  };
}

export type ClientStatus = "active" | "past_due" | "paused" | "onboarding";

export interface ClientAfterPayment {
  lifetime_value: number;
  status?: ClientStatus;
  billing_anchor_date?: string;
  on_hold_since?: null;
}

/**
 * What a successful invoice payment changes on the client.
 * - lifetime value grows by the amount paid;
 * - any manual hold is lifted (they are paying again);
 * - past_due always goes back to active;
 * - paused goes back to active only when the invoice belongs to a subscription that is live right now (not a late
 *   payment of an open invoice of a subscription that has since been canceled);
 * - onboarding becomes active only when the contract is signed or the project is exempt.
 * `liveSubscription` is the subscription as Stripe reports it now (null if there is none or the lookup failed).
 */
export function clientUpdateAfterPayment(input: {
  current: { status: string; lifetime_value: number; on_hold_since: string | null };
  amountPaidCents: number;
  liveSubscription: { status: string; pause_collection?: unknown; billing_cycle_anchor?: number | null } | null;
  contractStatus: string | null;
  now: Date;
}): ClientAfterPayment {
  const { current, liveSubscription } = input;
  const update: ClientAfterPayment = { lifetime_value: Number(current.lifetime_value) + input.amountPaidCents / 100 };
  if (current.on_hold_since) update.on_hold_since = null;
  if (liveSubscription?.billing_cycle_anchor) update.billing_anchor_date = nextBillingDate(liveSubscription.billing_cycle_anchor, input.now);
  if (current.status === "past_due") {
    update.status = "active";
  } else if (current.status === "paused" && liveSubscription && isLiveSubscription(liveSubscription)) {
    update.status = "active";
  } else if (current.status === "onboarding" && (input.contractStatus === "signed" || input.contractStatus === "exempt")) {
    update.status = "active";
  }
  return update;
}

/** When a failed-payment notice turns out stale after the client was marked past_due: what to put back. */
export function restoreAfterStaleFailure(statusBefore: string): string {
  return statusBefore === "past_due" ? "active" : statusBefore;
}

/** subscription_price and billing_anchor_date from a subscription. */
export function subscriptionFields(sub: { items?: { data?: { price?: { unit_amount?: number | null } | null }[] } | null; billing_cycle_anchor?: number | null }, now: Date) {
  const fields: { subscription_price?: number; billing_anchor_date?: string } = {};
  const amount = sub.items?.data?.[0]?.price?.unit_amount;
  if (amount !== undefined && amount !== null) fields.subscription_price = amount / 100;
  if (sub.billing_cycle_anchor) fields.billing_anchor_date = nextBillingDate(sub.billing_cycle_anchor, now);
  return fields;
}

export interface SchedulePhaseLike {
  start_date?: number | null;
  end_date?: number | null;
  items?: { price?: unknown }[];
}

/**
 * A subscription created with a future start date makes a SubscriptionSchedule first, and Stripe creates the real
 * Subscription only when the first phase begins. Until then nothing else knows the price or the start date (this is
 * what happened to Reel Queen Academy). Returns the phase running now or next, or null when the schedule is
 * finished ('released' means a real Subscription now exists, whose own events take over).
 */
export function currentSchedulePhase(schedule: { status: string; phases?: SchedulePhaseLike[] }, now: Date): SchedulePhaseLike | null {
  if (["completed", "released", "canceled"].includes(schedule.status)) return null;
  const nowSec = Math.floor(now.getTime() / 1000);
  return (schedule.phases ?? []).find((p) => p.end_date === null || p.end_date === undefined || p.end_date > nowSec) ?? null;
}

/** The phase's start date as YYYY-MM-DD (the one specific date, not a recurring day of month). */
export function phaseStartDate(phase: SchedulePhaseLike): string | null {
  return phase.start_date ? (new Date(phase.start_date * 1000).toISOString().split("T")[0] as string) : null;
}

/** The phase's price: an embedded amount, or the price id to fetch (the webhook payload does not embed it by default). */
export function phasePriceRef(phase: SchedulePhaseLike): { amount: number | null } | { priceId: string } | null {
  const ref = phase.items?.[0]?.price;
  if (typeof ref === "string") return { priceId: ref };
  if (ref && typeof ref === "object" && "unit_amount" in ref) {
    const amount = (ref as { unit_amount?: number | null }).unit_amount;
    return { amount: amount ?? null };
  }
  return null;
}

// --- the event ledger ------------------------------------------------------------------------------

/** A ledger row still 'processing' for longer than this is treated as abandoned (the request died) and taken over. */
export const STALE_PROCESSING_MS = 5 * 60_000;

export type LedgerDecision = "duplicate" | "in_flight" | "reclaim";

/** What to do when an event id is already in the ledger. */
export function ledgerDecision(existing: { status: string; claimed_at: string }, now: Date): LedgerDecision {
  if (existing.status === "processed" || existing.status === "ignored") return "duplicate";
  if (existing.status === "processing" && now.getTime() - Date.parse(existing.claimed_at) < STALE_PROCESSING_MS) return "in_flight";
  return "reclaim";
}

/** Test-mode events are acknowledged and ignored in production: production only holds real business data. */
/**
 * Is this the live deployment? APP_ENV is optional (it defaults to local), so Vercel's own VERCEL_ENV, which
 * Vercel always sets, counts too: a missing APP_ENV must never let Stripe test data into the real database.
 */
export function isProductionEnv(appEnv: string | undefined, vercelEnv: string | undefined): boolean {
  return appEnv === "production" || vercelEnv === "production";
}

export function ignoreTestModeEvent(livemode: boolean, appEnv: string | undefined, vercelEnv?: string | undefined): boolean {
  return !livemode && isProductionEnv(appEnv, vercelEnv);
}

// --- Resend invoice (owner button on the client page) -------------------------------------------

/** A Stripe invoice id. Charges (ch_...) and payments (py_...) cannot be re-sent. */
export const INVOICE_ID_PATTERN = /^in_[A-Za-z0-9]{8,}$/;

/** Why Stripe must not be asked to send this invoice, in plain words; null when it may be sent. */
export function invoiceSendBlock(status: string | null): string | null {
  if (status === "draft") return "This invoice is still a draft in Stripe. Finalize it in Stripe before sending it.";
  if (status === "void") return "This invoice was voided in Stripe, so it was not sent.";
  if (status === "uncollectible") return "This invoice is marked uncollectible in Stripe, so it was not sent.";
  return null;
}

const label = (number: string | null) => (number ? `Invoice ${number}` : "The invoice");

/** The message after Stripe accepted the send. */
export function invoiceSentMessage(number: string | null, status: string | null): string {
  if (status === "paid") return `${label(number)} was emailed to the client again. It is already paid, so nothing is due.`;
  return `${label(number)} was emailed to the client by Stripe.`;
}

/** The message when Stripe refused: Stripe's own reason, and the payment page to share by hand when there is one. */
export function invoiceRefusedMessage(stripeMessage: string | null, hostedUrl: string | null): string {
  const reason = (stripeMessage ?? "no reason given").replace(/\s+/g, " ").trim().slice(0, 240);
  const link = hostedUrl && /^https:\/\//.test(hostedUrl) ? ` You can send the client this payment page instead: ${hostedUrl}` : "";
  return `Stripe did not send it: ${reason}.${link}`;
}

// --- "Sync from Stripe" (the old Sync Stripe and Sync Stripe Customers buttons) ---------------------------------

/** A subscription in these states is finished. Every other state has a real price and billing date worth showing. */
export const DEAD_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);

/**
 * The subscription a sync takes the price and billing date from: the first one that is not finished. An exclude-list,
 * not an allow-list: the old app's allow-list missed a client whose subscription sat in 'incomplete' (payment method
 * not confirmed yet), and 'active' alone missed one created with a future start date ('trialing' until then).
 */
export function pickSyncSubscription<T extends { status: string }>(subs: T[]): T | null {
  return subs.find((s) => !DEAD_SUBSCRIPTION_STATUSES.has(s.status)) ?? null;
}

/**
 * The revenue_events row for a paid invoice found by a sync. Unlike the webhook (which runs as the payment happens),
 * a backfill never falls back to "now": an old invoice with no paid_at was once stamped as paid on the day of the
 * sync and showed up in that month's money. The invoice's creation time is far closer to the truth.
 */
export function syncedInvoiceRevenue(
  invoice: { id: string; amount_paid: number | null; created: number; status_transitions?: { paid_at?: number | null } | null; subscriptionId: string | null },
  clientId: string,
) {
  const paidAt = invoice.status_transitions?.paid_at || invoice.created;
  return {
    stripe_invoice_id: invoice.id,
    client_id: clientId,
    amount: (invoice.amount_paid ?? 0) / 100,
    status: "paid" as const,
    event_type: invoice.subscriptionId ? "subscription" : "one_time",
    paid_at: new Date(paidAt * 1000).toISOString(),
  };
}

/** Two payments of the same amount less than this apart are taken to be the same payment. */
export const SAME_PAYMENT_WINDOW_MS = 60_000;

/**
 * Whether a standalone charge should be recorded by a sync. Skipped: anything not succeeded or of no value, a charge
 * that paid an invoice (the invoice is the record), and one that matches a payment already recorded for the client by
 * amount and time (a payment recorded before charges carried a link to their invoice).
 */
export function shouldRecordCharge(
  charge: { status: string; amount: number; created: number; paymentIntentId: string | null },
  invoicePaymentIntents: ReadonlySet<string>,
  recorded: { amount: number; paid_at: string | null }[],
): boolean {
  if (charge.status !== "succeeded" || charge.amount <= 0) return false;
  if (charge.paymentIntentId && invoicePaymentIntents.has(charge.paymentIntentId)) return false;
  const amount = charge.amount / 100;
  const at = charge.created * 1000;
  return !recorded.some((r) => Number(r.amount) === amount && r.paid_at !== null && Math.abs(Date.parse(r.paid_at) - at) < SAME_PAYMENT_WINDOW_MS);
}

/** Lifetime value: the sum of the client's paid payments, in whole cents (no floating-point dust). */
export function lifetimeValueOf(paid: { amount: number }[]): number {
  return Math.round(paid.reduce((sum, p) => sum + Number(p.amount) * 100, 0)) / 100;
}

/** True when a payment arrived after the client was put on hold: the hold is lifted, as the webhook does live. */
export function paidSinceHold(onHoldSince: string | null, paid: { paid_at: string | null }[]): boolean {
  if (!onHoldSince) return false;
  const since = Date.parse(onHoldSince);
  return paid.some((p) => p.paid_at !== null && Date.parse(p.paid_at) > since);
}

export interface SyncSummary {
  customersRead: number;
  clientsCreated: number;
  clientsUpdated: number;
  accountsLinked: number;
  clientsChecked: number;
  clientsTotal: number;
  paymentsRecorded: number;
  statusChanges: number;
  problems: number;
  stoppedForTime: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The one-line result shown under the button. */
export function syncMessage(s: SyncSummary): string {
  const parts = [
    `${plural(s.clientsCreated, "new client")}`,
    `${plural(s.clientsUpdated, "client")} filled in`,
    `${plural(s.paymentsRecorded, "missing payment")} recorded`,
    `${plural(s.statusChanges, "status change")}`,
  ];
  let text = `Read ${plural(s.customersRead, "Stripe customer")} and checked ${s.clientsChecked} of ${s.clientsTotal} clients: ${parts.join(", ")}.`;
  if (s.problems > 0) text += ` ${plural(s.problems, "step")} could not be completed; run the sync again, and if it keeps failing check that STRIPE_SECRET_KEY can read customers, subscriptions, invoices and charges.`;
  if (s.stoppedForTime) text += " It stopped early to stay within the time limit; run it again to finish (nothing is recorded twice).";
  return text;
}
