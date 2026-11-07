import { ActionForm } from "@/ui/ActionForm";
import { BTN_PRIMARY, Card, Heading } from "@/ui/forms";
import { Pill } from "@/ui/kit";
import { requireOwner } from "@/platform/auth/actor";
import { getStripeSetup } from "@/domains/billing/service";
import { syncStripeAction } from "../actions";

export const metadata = { title: "Stripe" };
// The sync can take up to about 45 seconds on a slow Stripe; the action runs under this page's limit.
export const maxDuration = 60;

function Row({ label, on, help }: { label: string; on: boolean; help: string }) {
  return (
    <div className="flex min-h-[48px] items-center gap-3 border-t border-line px-4 py-2 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{label}</div>
        <div className="mt-0.5 text-[12px] leading-[1.45] text-dim">{help}</div>
      </div>
      <Pill tone={on ? "green" : "gray"}>{on ? "Set" : "Not set"}</Pill>
    </div>
  );
}

export default async function StripeSettingsPage() {
  const actor = await requireOwner();
  const setup = getStripeSetup(actor);
  return (
    <div className="flex flex-col gap-5">
      <section>
        <Heading>Sync from Stripe</Heading>
        <Card className="px-4 py-4">
          <p className="m-0 text-[14px] leading-[1.5]">
            Payments and new customers arrive by themselves through the Stripe webhook. Use this only to fill in what the webhook missed (for example
            while it was down): it adds clients for Stripe customers the app does not have, fills blank contact details (never overwrites yours), records
            paid invoices and charges that are missing (including Payment Link payments with no Stripe customer, as unassigned), and refreshes prices, billing dates and lifetime values. It never changes anything in Stripe, and
            running it twice records nothing twice.
          </p>
          <ActionForm
            action={syncStripeAction}
            submitLabel="Sync from Stripe"
            className="mt-3 flex flex-col gap-2"
            buttonClassName={BTN_PRIMARY}
            note="Takes up to about a minute."
          >
            {null}
          </ActionForm>
        </Card>
      </section>

      <section>
        <Heading>Setup</Heading>
        <Card className="overflow-hidden">
          <Row label="Read key (STRIPE_SECRET_KEY)" on={setup.readKey} help="Read-only restricted key. Used by the webhook and by Sync from Stripe." />
          <Row label="Webhook secret (STRIPE_WEBHOOK_SECRET)" on={setup.webhookSecret} help="Lets the app trust events Stripe sends." />
          <Row label="Invoice key (STRIPE_INVOICE_KEY)" on={setup.invoiceKey} help="Optional. Restricted key with Invoices: Write, for the Resend invoice button." />
        </Card>
      </section>
    </div>
  );
}
