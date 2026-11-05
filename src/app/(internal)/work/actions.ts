"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/platform/auth/actor";
import { formToObject } from "@/platform/action-errors";
import { runAction } from "@/platform/actions";
import * as work from "@/domains/work/service";
import type { ActionState } from "@/ui/action-state";

// Server actions are public endpoints, so each one re-checks the owner first.

export async function createRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireOwner();
  let message = "Request saved.";
  const result = await runAction(
    async () => {
      const created = await work.createRequest(actor, formToObject(formData));
      message = created.duplicate
        ? `That request was already saved as ${created.displayId}. No second one was made.`
        : `Request ${created.displayId} saved.`;
    },
    () => message,
  );
  if (result.status === "ok") {
    revalidatePath("/work");
    revalidatePath("/clients", "layout");
    revalidatePath("/");
  }
  return result;
}

export async function createTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireOwner();
  let message = "Task saved.";
  const result = await runAction(
    async () => {
      const created = await work.createTask(actor, formToObject(formData));
      message = created.duplicate ? "That task was already saved. No second one was made." : "Task saved.";
    },
    () => message,
  );
  if (result.status === "ok") {
    revalidatePath("/work");
    revalidatePath("/");
  }
  return result;
}

export async function setTaskStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireOwner();
  const result = await runAction(() => work.setTaskStatus(actor, formToObject(formData)), "Status updated.");
  if (result.status === "ok") {
    revalidatePath("/work");
    revalidatePath("/");
  }
  return result;
}
