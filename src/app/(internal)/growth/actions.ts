"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/actor";
import { formToObject } from "@/platform/action-errors";
import { runAction } from "@/platform/actions";
import { leadSavedMessage, stageMessage } from "@/domains/growth/rules";
import * as growth from "@/domains/growth/service";
import type { ActionState } from "@/ui/action-state";

// Server actions are public endpoints, so each one re-checks the owner first.

function refresh() {
  revalidatePath("/growth");
  revalidatePath("/");
}

export async function createLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireOwner();
  let id: string | null = null;
  const result = await runAction(async () => {
    id = (await growth.createLead(actor, formToObject(formData))).id;
  }, "Lead added.");
  if (result.status !== "ok" || !id) return result;
  refresh();
  // Open the lead just added (or the one already saved, after a double tap).
  redirect(`/growth?lead=${id}`);
}

export async function updateLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireOwner();
  let message = "Lead saved.";
  const result = await runAction(
    async () => {
      message = leadSavedMessage((await growth.updateLead(actor, formToObject(formData))).changed);
    },
    () => message,
  );
  if (result.status === "ok") refresh();
  return result;
}

export async function setLeadStageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireOwner();
  let message = "Stage changed.";
  const result = await runAction(
    async () => {
      message = stageMessage(await growth.setLeadStage(actor, formToObject(formData)));
    },
    () => message,
  );
  if (result.status === "ok") refresh();
  return result;
}

export async function setLeadFollowUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireOwner();
  let message = "Follow-up date saved.";
  const result = await runAction(
    async () => {
      const r = await growth.setLeadFollowUp(actor, formToObject(formData));
      message = !r.changed ? "Nothing changed." : r.followUpDate ? "Follow-up date saved." : "Follow-up date cleared.";
    },
    () => message,
  );
  if (result.status === "ok") refresh();
  return result;
}

export async function deleteLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireOwner();
  const result = await runAction(() => growth.deleteLead(actor, formToObject(formData)), "Lead deleted.");
  if (result.status !== "ok") return result;
  refresh();
  redirect("/growth");
}
