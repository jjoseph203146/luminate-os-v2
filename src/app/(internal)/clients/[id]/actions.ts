"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/platform/auth/actor";
import { formToObject } from "@/platform/action-errors";
import { runAction } from "@/platform/actions";
import * as billing from "@/domains/billing/service";
import * as clients from "@/domains/clients/service";
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

type ClientChange = (actor: Awaited<ReturnType<typeof requireOwner>>, raw: unknown) => Promise<{ message: string; changed: boolean }>;

/** Runs one client change and refreshes every screen that shows clients or monitoring. */
async function runClientChange(change: ClientChange, formData: FormData): Promise<ActionState> {
  const actor = await requireOwner();
  let message = "Saved.";
  const result = await runAction(
    async () => {
      ({ message } = await change(actor, formToObject(formData)));
    },
    () => message,
  );
  if (result.status === "ok") {
    revalidatePath("/clients", "layout");
    revalidatePath("/monitoring");
    revalidatePath("/");
  }
  return result;
}

/** Archive / restore, hold / release, stop / resume monitoring. The form says which with hidden `flag` and `on` fields. */
export async function setClientFlagAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runClientChange((actor, raw) => clients.setClientFlag(actor, raw), formData);
}

export async function updateClientDetailsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runClientChange(clients.updateClientDetails, formData);
}

export async function addClientWebsiteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runClientChange(clients.addClientWebsite, formData);
}

export async function updateClientWebsiteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runClientChange(clients.updateClientWebsite, formData);
}

export async function removeClientWebsiteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runClientChange(clients.removeClientWebsite, formData);
}

export async function setProjectUrlAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runClientChange(clients.setProjectUrl, formData);
}
