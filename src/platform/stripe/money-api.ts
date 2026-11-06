// The two live Stripe reads behind the Money page: every subscription that is not canceled, and every open invoice.
// Read only (STRIPE_SECRET_KEY, the read-only key). Shapes are reduced to what the money rules need, so the rules can
// be tested without Stripe.
import type Stripe from "stripe";
import { monthlyCentsOf } from "@/domains/money/rules";

/** At most this many subscriptions or open invoices are read (far more than the business has). */
export const MAX_MONEY_ROWS = 500;

export interface MoneySubscription {
  id: string;
  customerId: string;
  /** Stripe's customer name, used when the customer is not one of our clients. */
  customerName: string | null;
  status: string;
  /** "charge_automatically" (autopay) or "send_invoice". */
  collectionMethod: string;
  /** What one billing period costs, in cents, before discounts and tax. */
  periodCents: number;
  /** The same, as a monthly amount in cents (a yearly price divided by 12). */
  monthlyCents: number;
  /** When the next period starts and Stripe bills again (unix seconds), or null. */
  nextBillingAt: number | null;
  cancelAtPeriodEnd: boolean;
  /** pause_collection is set (Stripe keeps the subscription but collects nothing). */
  paused: boolean;
  /** When a pause ends by itself (unix seconds), or null. */
  pauseResumesAt: number | null;
  /** The subscription's latest invoice (the current period's) is paid with money. */
  currentPeriodPaid: boolean;
  /** Stripe's billing anchor (unix seconds): its day of the month is the renewal day. */
  billingCycleAnchor: number | null;
  /** When the subscription started (unix seconds). */
  startDate: number | null;
}

export interface MoneyInvoice {
  id: string;
  customerId: string;
  customerName: string | null;
  amountRemainingCents: number;
  collectionMethod: string;
  /** The invoice's due date (send_invoice), else when it was finalized (autopay is charged then). Unix seconds. */
  dueAt: number;
  /** How many times Stripe tried to charge it (autopay); more than 0 means a failed attempt. */
  attemptCount: number;
  number: string | null;
}

export interface StripeMoneyReads {
  listSubscriptions(): Promise<MoneySubscription[]>;
  listOpenInvoices(): Promise<MoneyInvoice[]>;
}

const idOf = (ref: unknown): string | null =>
  typeof ref === "string" ? ref : ref && typeof ref === "object" && typeof (ref as { id?: unknown }).id === "string" ? (ref as { id: string }).id : null;

const nameOf = (ref: unknown): string | null =>
  ref && typeof ref === "object" && !(ref as { deleted?: boolean }).deleted ? ((ref as { name?: string | null }).name ?? null) : null;

export function createStripeMoneyReads(stripe: Stripe): StripeMoneyReads {
  return {
    async listSubscriptions() {
      // The default listing leaves out canceled subscriptions. The customer and latest invoice are expanded so this
      // stays one paged call.
      const subs = await stripe.subscriptions
        .list({ limit: 100, expand: ["data.customer", "data.latest_invoice"] })
        .autoPagingToArray({ limit: MAX_MONEY_ROWS });
      return subs.flatMap((s) => {
        const customerId = idOf(s.customer);
        if (!customerId) return [];
        let periodCents = 0;
        let monthlyCents = 0;
        let nextBillingAt: number | null = null;
        for (const item of s.items.data) {
          const unit = (item.price?.unit_amount ?? 0) * (item.quantity ?? 1);
          periodCents += unit;
          monthlyCents += monthlyCentsOf(unit, item.price?.recurring);
          // API 2025-03-31.basil moved the period to the items.
          const end = (item as { current_period_end?: number }).current_period_end ?? null;
          if (end !== null && (nextBillingAt === null || end < nextBillingAt)) nextBillingAt = end;
        }
        const latest = s.latest_invoice && typeof s.latest_invoice === "object" ? s.latest_invoice : null;
        return [
          {
            id: s.id,
            customerId,
            customerName: nameOf(s.customer),
            status: s.status,
            collectionMethod: s.collection_method,
            periodCents,
            monthlyCents,
            nextBillingAt,
            cancelAtPeriodEnd: Boolean(s.cancel_at_period_end),
            paused: s.status === "paused" || Boolean(s.pause_collection),
            pauseResumesAt: s.pause_collection?.resumes_at ?? null,
            currentPeriodPaid: latest?.status === "paid" && (latest.amount_paid ?? 0) > 0,
            billingCycleAnchor: s.billing_cycle_anchor ?? null,
            startDate: s.start_date ?? null,
          },
        ];
      });
    },
    async listOpenInvoices() {
      const invoices = await stripe.invoices.list({ status: "open", limit: 100, expand: ["data.customer"] }).autoPagingToArray({ limit: MAX_MONEY_ROWS });
      return invoices.flatMap((inv) => {
        const customerId = idOf(inv.customer);
        if (!customerId || !inv.id) return [];
        return [
          {
            id: inv.id,
            customerId,
            customerName: nameOf(inv.customer) ?? inv.customer_name ?? null,
            amountRemainingCents: inv.amount_remaining ?? 0,
            collectionMethod: inv.collection_method,
            dueAt: inv.due_date ?? inv.status_transitions?.finalized_at ?? inv.created,
            attemptCount: inv.attempt_count ?? 0,
            number: inv.number ?? null,
          },
        ];
      });
    },
  };
}
