// Notifications domain: which phones may receive pushes, and sending them.
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { writeAudit } from "@/platform/audit/audit";
import { parseInput } from "@/platform/auth/schemas";
import { createAdminClient, createUserClient } from "@/platform/db/server";
import { getPushConfig } from "@/platform/env";
import { RuleError } from "@/platform/errors";
import { sendPush, type PushPayload } from "@/platform/push/send";
import { deviceIdSchema, deviceSchema } from "./schemas";
import { deviceLabel } from "./rules";
import * as repo from "./repo";
import type { NotifyResult, PushDevice } from "./types";

type Owner = Extract<Actor, { type: "owner" }>;

/** Whether push is set up on the server, and the public key the browser needs to subscribe. */
export function pushStatus(actor: Actor): { configured: boolean; publicKey: string | null } {
  assertCan(actor, "notifications.manage");
  const config = getPushConfig();
  return { configured: config !== null, publicKey: config?.publicKey ?? null };
}

export async function listDevices(actor: Actor): Promise<PushDevice[]> {
  assertCan(actor, "notifications.manage");
  return repo.listDevices(await createUserClient());
}

export async function registerDevice(actor: Owner, raw: Record<string, unknown>, userAgent: string | null): Promise<void> {
  assertCan(actor, "notifications.manage");
  const input = parseInput(deviceSchema, raw);
  const id = await repo.saveDevice(await createUserClient(), actor.userId, {
    ...input,
    label: input.label ?? deviceLabel(userAgent),
  });
  await writeAudit(actor, { action: "push_device.registered", entityType: "push_device", entityId: id, after: { label: input.label ?? deviceLabel(userAgent) } });
}

export async function removeDevice(actor: Owner, raw: unknown): Promise<void> {
  assertCan(actor, "notifications.manage");
  const { id } = parseInput(deviceIdSchema, raw);
  const removed = await repo.deleteDevice(await createUserClient(), id);
  if (!removed) throw new RuleError("That device was already removed.");
  await writeAudit(actor, { action: "push_device.removed", entityType: "push_device", entityId: id });
}

/**
 * Sends one notification to every registered device. Best effort: it never throws for a delivery
 * problem, so the thing that triggered it (a lead, a monitor check) is never blocked by it.
 * Devices the phone has dropped (404/410) are removed; other failures are counted.
 */
export async function notifyOwner(actor: Actor, payload: PushPayload): Promise<NotifyResult> {
  assertCan(actor, "notifications.send");
  const config = getPushConfig();
  if (!config) return { sent: 0, failed: 0, removed: 0, skipped: "not_configured" };
  try {
    const db = createAdminClient();
    const targets = await repo.listTargets(db);
    if (targets.length === 0) return { sent: 0, failed: 0, removed: 0, skipped: "no_devices" };
    const results = await sendPush(config, targets, payload);
    const ok = results.filter((r) => r.ok).map((r) => r.id);
    const gone = results.filter((r) => !r.ok && r.gone).map((r) => r.id);
    const failed = results.filter((r) => !r.ok && !r.gone).map((r) => r.id);
    await repo.recordSuccess(db, ok, new Date());
    await repo.removeDevices(db, gone);
    await repo.recordFailure(db, failed);
    return { sent: ok.length, failed: failed.length, removed: gone.length, skipped: null };
  } catch (e) {
    console.error("notify failed", e);
    return { sent: 0, failed: 0, removed: 0, skipped: null };
  }
}

export async function sendTest(actor: Owner): Promise<NotifyResult> {
  assertCan(actor, "notifications.manage");
  const result = await notifyOwner({ type: "system", name: "test_notification" }, {
    title: "Luminate OS test",
    body: "Push notifications are working on this device.",
    url: "/settings/notifications",
    tag: "test",
  });
  if (result.skipped === "not_configured") throw new RuleError("Push is not set up on the server yet (VAPID keys missing). See System status.");
  if (result.skipped === "no_devices") throw new RuleError("No device is registered yet. Turn notifications on first.");
  if (result.sent === 0) throw new RuleError("The notification could not be delivered. Turn notifications off and on again on this device.");
  return result;
}
