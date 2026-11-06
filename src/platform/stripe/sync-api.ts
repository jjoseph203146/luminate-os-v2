// The Stripe reads "Sync from Stripe" needs, behind a small interface so the sync can be tested with a fake.
// Read only: nothing here creates or changes anything in Stripe. Uses STRIPE_SECRET_KEY (the read-only key).
import type Stripe from "stripe";
import { getInvoiceSubscriptionId, type CustomerLike, type SchedulePhaseLike } from "@/domains/billing/rules";

/** At most this many customers are read in one sync (far more than the business has). */
export const MAX_SYNC_CUSTOMERS = 1000;

export interface SyncSubscription {
  id: string;
  status: string;
  pause_collection?: unknown;
  billing_cycle_anchor?: number | null;
  items?: { data?: { price?: { unit_amount?: number | null } | null }[] } | null;
}

export interface SyncSchedule {
  status: string;
  phases?: SchedulePhaseLike[];
}

export interface SyncInvoice {
  id: string;
  amount_paid: number | null;
  created: number;
  status_transitions?: { paid_at?: number | null } | null;
  subscriptionId: string | null;
  /** The payment intents that paid this invoice, so their charges are not recorded a second time. */
  paymentIntentIds: string[];
}

export interface SyncCharge {
  id: string;
  status: string;
  amount: number;
  created: number;
  paymentIntentId: string | null;
}

export interface StripeSyncReads {
  /** Every live (not deleted) customer, newest first, up to MAX_SYNC_CUSTOMERS. */
  listCustomers(): Promise<CustomerLike[]>;
  /** The customer's subscriptions in every status (newest first, first 10, as the old sync read them). */
  listSubscriptions(customerId: string): Promise<SyncSubscription[]>;
  listSchedules(customerId: string): Promise<SyncSchedule[]>;
  retrievePriceAmount(priceId: string): Promise<number | null>;
  /** The customer's paid invoices, first 100. */
  listPaidInvoices(customerId: string): Promise<SyncInvoice[]>;
  /** The customer's charges, first 100. */
  listCharges(customerId: string): Promise<SyncCharge[]>;
}

const idOf = (ref: unknown): string | null =>
  typeof ref === "string" ? ref : ref && typeof ref === "object" && typeof (ref as { id?: unknown }).id === "string" ? (ref as { id: string }).id : null;

/**
 * invoice.payment_intent was removed in Stripe API 2025-03-31.basil; payment intents now hang off invoice.payments
 * (expanded on the list call). Both shapes are read, so the "already recorded" set is never silently empty (when it
 * was, invoice-backed charges were recorded again under their ch_ ids in the old app).
 */
export function invoicePaymentIntentIds(invoice: unknown): string[] {
  const raw = invoice as Record<string, unknown>;
  const ids: string[] = [];
  const legacy = idOf(raw.payment_intent);
  if (legacy) ids.push(legacy);
  const payments = raw.payments as { data?: { payment?: { payment_intent?: unknown } }[] } | undefined;
  for (const p of payments?.data ?? []) {
    const id = idOf(p.payment?.payment_intent);
    if (id) ids.push(id);
  }
  return ids;
}

export function createStripeSyncReads(stripe: Stripe): StripeSyncReads {
  return {
    async listCustomers() {
      const all = await stripe.customers.list({ limit: 100 }).autoPagingToArray({ limit: MAX_SYNC_CUSTOMERS });
      return all.map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, metadata: c.metadata }));
    },
    async listSubscriptions(customerId) {
      const list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
      return list.data.map((s) => ({
        id: s.id,
        status: s.status,
        pause_collection: s.pause_collection,
        billing_cycle_anchor: s.billing_cycle_anchor,
        items: { data: s.items.data.map((i) => ({ price: { unit_amount: i.price?.unit_amount ?? null } })) },
      }));
    },
    async listSchedules(customerId) {
      const list = await stripe.subscriptionSchedules.list({ customer: customerId, limit: 10 });
      return list.data.map((s) => ({ status: s.status, phases: s.phases as unknown as SchedulePhaseLike[] }));
    },
    async retrievePriceAmount(priceId) {
      const price = await stripe.prices.retrieve(priceId);
      return price.unit_amount ?? null;
    },
    async listPaidInvoices(customerId) {
      const list = await stripe.invoices.list({ customer: customerId, status: "paid", limit: 100, expand: ["data.payments"] });
      return list.data.flatMap((inv) =>
        inv.id
          ? [
              {
                id: inv.id,
                amount_paid: inv.amount_paid ?? null,
                created: inv.created,
                status_transitions: { paid_at: inv.status_transitions?.paid_at ?? null },
                subscriptionId: getInvoiceSubscriptionId(inv),
                paymentIntentIds: invoicePaymentIntentIds(inv),
              },
            ]
          : [],
      );
    },
    async listCharges(customerId) {
      const list = await stripe.charges.list({ customer: customerId, limit: 100 });
      return list.data.map((c) => ({ id: c.id, status: c.status, amount: c.amount, created: c.created, paymentIntentId: idOf(c.payment_intent) }));
    },
  };
}
