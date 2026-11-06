"use server";

import { requireOwner } from "@/platform/auth/actor";
import { formToObject } from "@/platform/action-errors";
import { runAction } from "@/platform/actions";
import * as billing from "@/domains/billing/service";
import type { ActionState } from "@/ui/action-state";

// Server actions are public endpoints, so this one re-checks the owner first.

/** "Resend invoice": asks Stripe to email one of this client's invoices again. */
export async function resendInvoiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireOwner();
  let message = "Invoice sent.";
  return runAction(
    async () => {
      ({ message } = await billing.resendInvoice(actor, formToObject(formData)));
    },
    () => message,
  );
}
