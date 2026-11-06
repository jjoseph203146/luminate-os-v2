"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/platform/auth/actor";
import { formToObject } from "@/platform/action-errors";
import { runAction } from "@/platform/actions";
import * as renewals from "@/domains/renewals/service";
import type { ActionState } from "@/ui/action-state";

// Billing task actions (Today and the client Billing tab). Server actions are public endpoints: each re-checks the
// owner first. None of them sends anything: the owner sends invoices and reminders, then records it here.

type Work = (actor: Awaited<ReturnType<typeof requireOwner>>, raw: Record<string, unknown>) => Promise<{ message: string }>;

function billingAction(work: Work) {
  return async (_prev: ActionState, formData: FormData): Promise<ActionState> => {
    const actor = await requireOwner();
    let message = "Saved.";
    const result = await runAction(
      async () => {
        message = (await work(actor, formToObject(formData))).message;
      },
      () => message,
    );
    if (result.status === "ok") {
      revalidatePath("/");
      revalidatePath("/work");
      revalidatePath("/clients", "layout");
    }
    return result;
  };
}

export const markInvoiceSentAction = billingAction((a, raw) => renewals.markInvoiceSent(a, raw));
export const markReminderSentAction = billingAction((a, raw) => renewals.markReminderSent(a, raw));
export const markReviewedAction = billingAction((a, raw) => renewals.markReviewed(a, raw));
export const recordPaymentAction = billingAction((a, raw) => renewals.recordManualPayment(a, raw));
export const saveScheduleAction = billingAction((a, raw) => renewals.saveAgreement(a, raw));
export const scheduleStatusAction = billingAction((a, raw) => renewals.changeAgreementStatus(a, raw));
export const followStripeAction = billingAction((a, raw) => renewals.followStripe(a, raw));
