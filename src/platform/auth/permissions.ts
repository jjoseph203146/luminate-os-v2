import { PermissionError } from "@/platform/errors";
import type { Actor, ActorType } from "./types";

export const PERMISSIONS = [
  "settings.read",
  "settings.write",
  "users.manage",
  "audit.read",
  "jobs.read",
  "jobs.run",
  "system.read",
  "clients.read",
  "work.read",
  "work.write",
  "growth.read",
  "growth.intake",
  "notifications.manage",
  "notifications.send",
  "monitoring.read",
  "monitoring.scan",
  "alerts.run",
  "assistant.read",
  "calendar.read",
  "billing.ingest",
  "billing.invoice_send",
  /** Archive, hold, stop monitoring, edit details and websites. */
  "clients.write",
  /** Add and edit leads, change their stage. Does not include deleting a lead. */
  "leads.write",
  /** Add and edit client notes. */
  "notes.write",
  /** Add and edit leads, change their stage, and delete a lead. */
  "growth.write",
  /** "Sync from Stripe": record customers and payments the webhook missed. */
  "billing.sync",
  /** The Money page: payments, MRR, overdue and paused (read only). */
  "money.read",
  /** SOP billing tasks: billing schedules, renewals, Mark sent / reminder sent, manual payments. */
  "billing.tasks",
  /** The billing job: creates and closes billing tasks. Never sends anything. */
  "billing.schedule",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// Contractor, client, integration and ai have no permissions yet: those
// actors are designed but switched off (docs/architecture/04 s3).
const GRANTS: Record<ActorType, readonly Permission[]> = {
  owner: PERMISSIONS,
  system: ["jobs.read", "jobs.run", "growth.intake", "notifications.send", "monitoring.read", "monitoring.scan", "alerts.run", "billing.schedule"],
  contractor: [],
  client: [],
  // The Stripe webhook: records customers, payments and subscription state. Nothing else.
  integration: ["billing.ingest"],
  // Read only. The ai actor reaches services only through the fixed tool list in domains/assistant,
  // and every tool returns an explicit set of fields (no contact details, notes or ids from other systems).
  ai: ["assistant.read", "clients.read", "work.read", "growth.read", "monitoring.read", "calendar.read"],
  // The bot write API. Leads (not delete), client notes, change requests, comments and tasks.
  // No money, legal, settings, users, deletes, or the read-only assistant tools.
  bot: ["leads.write", "notes.write", "work.write"],
};

export function can(actor: Actor, permission: Permission): boolean {
  return GRANTS[actor.type].includes(permission);
}

export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw new PermissionError();
}
