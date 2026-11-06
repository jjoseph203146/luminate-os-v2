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
  "alerts.run",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// Contractor, client, integration and ai have no permissions yet: those
// actors are designed but switched off (docs/architecture/04 s3).
const GRANTS: Record<ActorType, readonly Permission[]> = {
  owner: PERMISSIONS,
  system: ["jobs.read", "jobs.run", "growth.intake", "notifications.send", "monitoring.read", "alerts.run"],
  contractor: [],
  client: [],
  integration: [],
  ai: [],
};

export function can(actor: Actor, permission: Permission): boolean {
  return GRANTS[actor.type].includes(permission);
}

export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw new PermissionError();
}
