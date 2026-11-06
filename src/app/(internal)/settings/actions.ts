"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireOwner } from "@/platform/auth/actor";
import { formToObject } from "@/platform/action-errors";
import { runAction } from "@/platform/actions";
import * as admin from "@/domains/admin/service";
import * as billing from "@/domains/billing/service";
import { syncMessage } from "@/domains/billing/rules";
import * as automation from "@/domains/automation/service";
import * as notifications from "@/domains/notifications/service";
import type { ActionState } from "@/ui/action-state";

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

// Every action re-checks the actor: server actions are public endpoints.
function owned(path: string, ok: string, work: (actor: Awaited<ReturnType<typeof requireOwner>>, raw: Record<string, unknown>) => Promise<void>): FormAction {
  return async (_prev, formData) => {
    const actor = await requireOwner();
    const result = await runAction(() => work(actor, formToObject(formData)), ok);
    if (result.status === "ok") revalidatePath(path);
    return result;
  };
}

export async function saveBusinessProfileAction(prev: ActionState, formData: FormData) {
  return owned("/settings/business-profile", "Business profile saved.", (a, raw) => admin.updateBusinessProfile(a, raw))(prev, formData);
}
export async function saveCalendarAction(prev: ActionState, formData: FormData) {
  return owned("/settings/calendar", "Calendar saved.", (a, raw) => admin.updateCalendar(a, raw))(prev, formData);
}
export async function addHolidayAction(prev: ActionState, formData: FormData) {
  return owned("/settings/calendar", "Holiday added.", (a, raw) => admin.addHoliday(a, raw))(prev, formData);
}
export async function removeHolidayAction(prev: ActionState, formData: FormData) {
  return owned("/settings/calendar", "Holiday removed.", (a, raw) => admin.removeHoliday(a, raw))(prev, formData);
}
export async function updateCatalogItemAction(prev: ActionState, formData: FormData) {
  return owned("/settings/catalog", "Catalog item saved.", (a, raw) => admin.updateCatalogItem(a, raw))(prev, formData);
}
export async function createCatalogItemAction(prev: ActionState, formData: FormData) {
  return owned("/settings/catalog", "Catalog item added.", (a, raw) => admin.createCatalogItem(a, raw))(prev, formData);
}
export async function updateCarePlanAction(prev: ActionState, formData: FormData) {
  return owned("/settings/catalog", "Care plan saved.", (a, raw) => admin.updateCarePlan(a, raw))(prev, formData);
}
export async function createCarePlanAction(prev: ActionState, formData: FormData) {
  return owned("/settings/catalog", "Care plan added.", (a, raw) => admin.createCarePlan(a, raw))(prev, formData);
}
export async function inviteOwnerAction(prev: ActionState, formData: FormData) {
  return owned("/settings/users", "Invitation sent.", (a, raw) => admin.inviteOwner(a, raw))(prev, formData);
}
export async function disableUserAction(prev: ActionState, formData: FormData) {
  return owned("/settings/users", "User disabled.", (a, raw) => admin.setUserDisabled(a, raw, true))(prev, formData);
}
export async function enableUserAction(prev: ActionState, formData: FormData) {
  return owned("/settings/users", "User enabled.", (a, raw) => admin.setUserDisabled(a, raw, false))(prev, formData);
}
export async function runJobNowAction(prev: ActionState, formData: FormData) {
  return owned("/automations", "Job run finished.", async (a, raw) => {
    await automation.runNow(a, typeof raw.jobKey === "string" ? raw.jobKey : "");
  })(prev, formData);
}

// --- Push notifications -------------------------------------------------------
export async function registerPushDeviceAction(prev: ActionState, formData: FormData) {
  const userAgent = (await headers()).get("user-agent");
  return owned("/settings/notifications", "Notifications are on for this device.", (a, raw) => notifications.registerDevice(a, raw, userAgent))(prev, formData);
}
export async function removePushDeviceAction(prev: ActionState, formData: FormData) {
  return owned("/settings/notifications", "Device removed.", (a, raw) => notifications.removeDevice(a, raw))(prev, formData);
}
export async function sendTestPushAction(prev: ActionState, formData: FormData) {
  return owned("/settings/notifications", "Test sent. It should appear on your phone within a few seconds.", async (a) => {
    await notifications.sendTest(a);
  })(prev, formData);
}

// --- Stripe -------------------------------------------------------------------------------

/** "Sync from Stripe": backfills customers and payments the webhook missed. Takes up to about 45 seconds. */
export async function syncStripeAction(): Promise<ActionState> {
  const actor = await requireOwner();
  let message = "Sync finished.";
  const result = await runAction(
    async () => {
      message = syncMessage(await billing.syncFromStripe(actor));
    },
    () => message,
  );
  if (result.status === "ok") {
    revalidatePath("/clients", "layout");
    revalidatePath("/");
  }
  return result;
}
