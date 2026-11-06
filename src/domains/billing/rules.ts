// Pure rules for the Stripe webhook. No database, no network, no clock reads: `now` is passed in.
// Ported from the old app's src/app/api/webhooks/stripe/route.ts; the comments that explain past bugs are kept.

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
  const anchor = new Date(anchorTimestamp * 1000);
  const billingDay = anchor.getUTCDate();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let candidate = new Date(Date.UTC(year, month, billingDay));
  if (candidate <= now) {
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
    candidate = new Date(Date.UTC(year, month, billingDay));
  }
  return candidate.toISOString().split("T")[0] as string;
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
export function ignoreTestModeEvent(livemode: boolean, appEnv: string | undefined): boolean {
  return !livemode && appEnv === "production";
}
