// Audit writer (docs/architecture/04 s2 rule 5). The log is insert-only and is
// written with the service-role client.
import type { Json } from "@/types/database";
import { createAdminClient } from "@/platform/db/server";
import { isUndefinedColumn } from "@/platform/db/schema-errors";
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
  /** Set for the bot actor only. Omitted otherwise so an un-migrated database still accepts owner rows. */
  actor_name?: string;
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
  const row: AuditRow = {
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
  // Only the bot row names the machine. Leaving the key off other rows means those inserts
  // do not depend on migration 0010.
  if (actor.type === "bot") row.actor_name = actor.name;
  return row;
}

/** Shown on the audit log. Reads the bot name from the after payload, which is written even if actor_name is not stored yet. */
export function actorLabel(actorType: string, after: unknown): string {
  if (actorType !== "bot" || !after || typeof after !== "object" || Array.isArray(after)) return actorType;
  const bot = (after as Record<string, unknown>).bot;
  if (typeof bot !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(bot)) return actorType;
  return `bot (${bot})`;
}

export class AuditWriteError extends Error {
  constructor() {
    super("The change was saved but the audit entry could not be written.");
    this.name = "AuditWriteError";
  }
}

export async function writeAudit(actor: Actor, entry: AuditEntry): Promise<void> {
  const row = buildAuditRow(actor, entry);
  const db = createAdminClient();
  const first = await db.from("audit_log").insert(row);
  if (!first.error) return;
  // Migration 0010 adds actor_name. Until PostgREST sees it, store the bot name in `after.bot` only.
  if (row.actor_name && isUndefinedColumn(first.error, "actor_name")) {
    const rest = { ...row };
    delete rest.actor_name;
    const second = await db.from("audit_log").insert(rest);
    if (!second.error) return;
    console.error("audit write failed", { action: entry.action, code: second.error.code });
    throw new AuditWriteError();
  }
  console.error("audit write failed", { action: entry.action, code: first.error.code });
  throw new AuditWriteError();
}
