// Sending an invoice again through Stripe. Uses the separate invoice key (Invoices: Write), never the webhook's
// read-only key. Behind a small interface so the billing service can be tested with a fake.
import type Stripe from "stripe";

export interface InvoiceForSend {
  id: string;
  customerId: string | null;
  status: string | null;
  number: string | null;
  /** Stripe's hosted page where the client can see and pay the invoice. */
  hostedUrl: string | null;
}

export interface InvoiceSender {
  retrieve(invoiceId: string): Promise<InvoiceForSend>;
  /** Asks Stripe to email the invoice to the customer again. Throws Stripe's error when Stripe refuses. */
  send(invoiceId: string): Promise<void>;
}

export function createInvoiceSender(stripe: Stripe): InvoiceSender {
  return {
    async retrieve(invoiceId) {
      const inv = await stripe.invoices.retrieve(invoiceId);
      const customer = typeof inv.customer === "string" ? inv.customer : (inv.customer?.id ?? null);
      return { id: inv.id ?? invoiceId, customerId: customer, status: inv.status ?? null, number: inv.number ?? null, hostedUrl: inv.hosted_invoice_url ?? null };
    },
    async send(invoiceId) {
      await stripe.invoices.sendInvoice(invoiceId);
    },
  };
}
