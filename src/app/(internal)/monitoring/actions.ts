"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/platform/auth/actor";
import { formToObject } from "@/platform/action-errors";
import { runAction } from "@/platform/actions";
import { scanMessage } from "@/domains/monitoring/rules";
import { speedMessage } from "@/domains/monitoring/visual-rules";
import * as monitoring from "@/domains/monitoring/service";
import type { ActionState } from "@/ui/action-state";

// Server actions are public endpoints, so this one re-checks the owner first.

/** "Scan all now", or "Scan now" for one site when the form carries a clientId. */
export async function scanSitesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireOwner();
  let message = "Scan finished.";
  const result = await runAction(
    async () => {
      const { summary, outcomes } = await monitoring.scanNow(actor, formToObject(formData));
      message = scanMessage(outcomes, summary.skippedForTime);
    },
    () => message,
  );
  if (result.status === "ok") {
    revalidatePath("/monitoring");
    revalidatePath("/");
    revalidatePath("/clients", "layout");
  }
  return result;
}

/** "Check speed now" for one site (PageSpeed Insights; takes up to about 40 seconds). */
export async function checkSpeedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireOwner();
  let message = "Speed check finished.";
  let failed = false;
  const result = await runAction(
    async () => {
      const outcome = await monitoring.checkSpeedNow(actor, formToObject(formData));
      message = speedMessage(outcome);
      failed = !outcome.ok;
    },
    () => message,
  );
  if (result.status === "ok") revalidatePath("/monitoring");
  // A failed check still saved its error on the site; show it as an error so it stands out.
  return result.status === "ok" && failed ? { status: "error", message } : result;
}
