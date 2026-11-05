// Audit writer (docs/architecture/04 s2 rule 5). The log is insert-only and is
// written with the service-role client.
import type { Json } from "@/types/database";
import { createAdminClient } from "@/platform/db/server";
import { actorId, actorIp, type Actor } from "@/platform/auth/types";

export interface AuditEntry {
  action: string; // e.g. "catalog_item.updated"
  entityType: string;
  entityId?: string | null;
  clientId?: string | null;
  before?: unknown;
  after?: unknown;
  approvalId?: string | null;
}

export interface AuditRow {
  actor_type: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  client_id: string | null;
  before: Json | null;
  after: Json | null;
  approval_id: string | null;
  request_ip: string | null;
}

const SECRET_KEY = /pass(word)?|secret|token|api[_-]?key|service[_-]?role|authorization|credential/i;
const MAX_STRING = 500;

/** Keeps audit rows small and free of secrets. */
export function minimizeForAudit(value: unknown, depth = 0): Json | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => minimizeForAudit(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, Json | undefined> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : (minimizeForAudit(v, depth + 1) ?? null);
    }
    return out;
  }
  return String(value);
}

export function buildAuditRow(actor: Actor, entry: AuditEntry): AuditRow {
  return {
    actor_type: actor.type,
    actor_id: actorId(actor),
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    client_id: entry.clientId ?? null,
    before: minimizeForAudit(entry.before),
    after: minimizeForAudit(entry.after),
    approval_id: entry.approvalId ?? null,
    request_ip: actorIp(actor),
  };
}

export class AuditWriteError extends Error {
  constructor() {
    super("The change was saved but the audit entry could not be written.");
    this.name = "AuditWriteError";
  }
}

export async function writeAudit(actor: Actor, entry: AuditEntry): Promise<void> {
  const { error } = await createAdminClient().from("audit_log").insert(buildAuditRow(actor, entry));
  if (error) {
    console.error("audit write failed", { action: entry.action, code: error.code });
    throw new AuditWriteError();
  }
}
