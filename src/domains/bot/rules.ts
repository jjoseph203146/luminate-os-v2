// Pure rules for the bot write API. No database.
import { createHash } from "node:crypto";

export const BOT_OPS = [
  "lead.create",
  "lead.update",
  "note.create",
  "note.update",
  "request.create",
  "request.comment",
  "task.create",
  "task.update",
] as const;

export type BotOp = (typeof BOT_OPS)[number];

/** Lowercase, so "Daily" and "daily" are the same bot in the audit log. 1–40 characters. */
export const BOT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function isBotName(value: string): boolean {
  return BOT_NAME_PATTERN.test(value);
}

/** A pending lock older than this can be taken over. A live one means another request is still working. */
export const PENDING_STALE_MS = 2 * 60_000;

export function pendingIsStale(createdAt: string, now: Date, windowMs = PENDING_STALE_MS): boolean {
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) return true;
  return now.getTime() - at >= windowMs;
}

/** Stable JSON: object keys are sorted, so `{b:1,a:2}` and `{a:2,b:1}` hash the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function payloadHash(op: string, input: unknown): string {
  return createHash("sha256").update(canonicalJson({ input, op })).digest("hex");
}

export class UnresolvedRef extends Error {
  readonly ref: string;
  constructor(ref: string) {
    super(`Nothing earlier in this batch produced an id for "${ref}".`);
    this.name = "UnresolvedRef";
    this.ref = ref;
  }
}

/**
 * Replaces `{ "$ref": "<idempotencyKey>" }` with the id of an earlier operation in this batch.
 * Any other object is walked. The hash is taken before this runs, so a retry hashes the same body.
 */
export function resolveRefs(input: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(input)) return input.map((v) => resolveRefs(v, ids));
  if (!input || typeof input !== "object") return input;
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 1 && keys[0] === "$ref" && typeof obj.$ref === "string") {
    const id = ids.get(obj.$ref);
    if (!id) throw new UnresolvedRef(obj.$ref);
    return id;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = resolveRefs(v, ids);
  return out;
}

export interface ClaimRow {
  status: string;
  payload_hash: string;
  result: unknown;
  created_at: string;
}

export type ClaimDecision =
  | { kind: "insert" }
  | { kind: "replay"; result: unknown }
  | { kind: "conflict" }
  | { kind: "in_progress" }
  | { kind: "takeover" };

/** What to do with an idempotency key that may already exist. `null` means it does not exist yet. */
export function decideClaim(existing: ClaimRow | null, hash: string, now: Date): ClaimDecision {
  if (!existing) return { kind: "insert" };
  if (existing.payload_hash !== hash) return { kind: "conflict" };
  if (existing.status === "completed") return { kind: "replay", result: existing.result };
  if (pendingIsStale(existing.created_at, now)) return { kind: "takeover" };
  return { kind: "in_progress" };
}

/** submissionKey for the task form: a hex digest, always valid, derived from the idempotency key. */
export function taskSubmissionKey(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);
}

/** Stored on internal_work_items.source_reference so a retried task create finds the same row. */
export function botTaskSourceReference(botName: string, idempotencyKey: string): string {
  return `bot:${botName}:${idempotencyKey}`;
}
