// The few Stripe API reads the webhook needs, behind a small interface so the billing service can be tested
// with a fake. Read only: nothing here creates or changes anything in Stripe.
import type Stripe from "stripe";
import type { CustomerLike } from "@/domains/billing/rules";

export interface LiveSubscription {
  id: string;
  status: string;
  pause_collection?: unknown;
  billing_cycle_anchor?: number | null;
}

export interface StripeReads {
  /** null when the customer was deleted in Stripe. */
  retrieveCustomer(customerId: string): Promise<CustomerLike | null>;
  /** The invoice's live status ("paid", "open", ...). */
  retrieveInvoiceStatus(invoiceId: string): Promise<string | null>;
  retrieveSubscription(subscriptionId: string): Promise<LiveSubscription>;
  /** The customer's non-canceled subscriptions (the default listing excludes canceled ones), first 100. */
  listSubscriptions(customerId: string): Promise<{ id: string; status: string }[]>;
  retrievePriceAmount(priceId: string): Promise<number | null>;
  /** True when a payment intent belongs to an invoice (then invoice.paid already recorded it). */
  paymentIntentHasInvoice(paymentIntentId: string): Promise<boolean>;
}

export function createStripeReads(stripe: Stripe): StripeReads {
  return {
    async retrieveCustomer(customerId) {
      const c = await stripe.customers.retrieve(customerId);
      if ((c as { deleted?: boolean }).deleted) return null;
      const customer = c as Stripe.Customer;
      return { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, metadata: customer.metadata };
    },
    async retrieveInvoiceStatus(invoiceId) {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      return invoice.status ?? null;
    },
    async retrieveSubscription(subscriptionId) {
      const s = await stripe.subscriptions.retrieve(subscriptionId);
      return { id: s.id, status: s.status, pause_collection: s.pause_collection, billing_cycle_anchor: s.billing_cycle_anchor };
    },
    async listSubscriptions(customerId) {
      const list = await stripe.subscriptions.list({ customer: customerId, limit: 100 });
      return list.data.map((s) => ({ id: s.id, status: s.status }));
    },
    async retrievePriceAmount(priceId) {
      const price = await stripe.prices.retrieve(priceId);
      return price.unit_amount ?? null;
    },
    async paymentIntentHasInvoice(paymentIntentId) {
      const payments = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: paymentIntentId } });
      return payments.data.length > 0;
    },
  };
}
