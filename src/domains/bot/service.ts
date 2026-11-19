// Bot write API. The route calls applyBatch; each operation calls an existing domain service
// so the same permission check and audit row apply. Reads stay on /api/mcp.
import type { Json } from "@/types/database";
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { parseInput } from "@/platform/auth/schemas";
import { createAdminClient } from "@/platform/db/server";
import { PermissionError, RateLimitError, RuleError, ValidationError } from "@/platform/errors";
import { AuditWriteError } from "@/platform/audit/audit";
import { patchLead, createLead } from "@/domains/growth/service";
import { createClientNote, updateClientNote } from "@/domains/clients/service";
import { addRequestComment, createRequest, createTask, updateTask } from "@/domains/work/service";
import { batchSchema } from "./schemas";
import * as repo from "./repo";
import {
  botTaskSourceReference,
  decideClaim,
  payloadHash,
  PENDING_STALE_MS,
  resolveRefs,
  taskSubmissionKey,
  UnresolvedRef,
  type BotOp,
  type ClaimDecision,
} from "./rules";

export class BotStoreNotReadyError extends Error {
  constructor() {
    super("The bot write store is not ready. Apply migration 0010 before using this API.");
    this.name = "BotStoreNotReadyError";
  }
}

export interface OpResult {
  idempotencyKey: string;
  op: string;
  ok: boolean;
  replayed: boolean;
  id?: string;
  displayId?: string;
  changed?: string[];
  duplicate?: boolean;
  coverageStored?: boolean;
  /** False when the write succeeded but the idempotency row could not be saved. A retry may write again. */
  idempotencyRecorded?: boolean;
  error?: string;
}

type SuccessBody = {
  ok: true;
  id?: string;
  displayId?: string;
  changed?: string[];
  duplicate?: boolean;
  coverageStored?: boolean;
};

function assertBot(actor: Actor): asserts actor is Extract<Actor, { type: "bot" }> {
  if (actor.type !== "bot") throw new PermissionError();
  assertCan(actor, "leads.write");
  assertCan(actor, "notes.write");
  assertCan(actor, "work.write");
}

function failureMessage(error: unknown): string {
  if (error instanceof ValidationError) return error.issues.join("; ");
  if (error instanceof RuleError || error instanceof RateLimitError || error instanceof UnresolvedRef) return error.message;
  if (error instanceof PermissionError) return "Not permitted.";
  if (error instanceof AuditWriteError) return "The change was saved but the audit entry could not be written. Check the record before retrying.";
  return "The operation failed.";
}

function asSuccess(body: unknown): OpResult | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  if (row.ok !== true) return null;
  const result: OpResult = { idempotencyKey: "", op: "", ok: true, replayed: true };
  if (typeof row.id === "string") result.id = row.id;
  if (typeof row.displayId === "string") result.displayId = row.displayId;
  if (Array.isArray(row.changed) && row.changed.every((c) => typeof c === "string")) result.changed = row.changed;
  if (typeof row.duplicate === "boolean") result.duplicate = row.duplicate;
  if (typeof row.coverageStored === "boolean") result.coverageStored = row.coverageStored;
  return result;
}

async function runOp(actor: Extract<Actor, { type: "bot" }>, op: BotOp, input: unknown, idempotencyKey: string, now: Date): Promise<SuccessBody> {
  switch (op) {
    case "lead.create": {
      const saved = await createLead(actor, input, now);
      return { ok: true, id: saved.id, duplicate: saved.duplicate };
    }
    case "lead.update": {
      const saved = await patchLead(actor, input, now);
      return { ok: true, id: saved.id, changed: saved.changed };
    }
    case "note.create": {
      const saved = await createClientNote(actor, input);
      return { ok: true, id: saved.id };
    }
    case "note.update": {
      const saved = await updateClientNote(actor, input);
      return { ok: true, id: saved.id, changed: saved.changed ? ["content"] : [] };
    }
    case "request.create": {
      const saved = await createRequest(actor, input);
      const body: SuccessBody = { ok: true, id: saved.id, displayId: saved.displayId, duplicate: saved.duplicate };
      if (saved.coverageStored !== null) body.coverageStored = saved.coverageStored;
      return body;
    }
    case "request.comment": {
      const saved = await addRequestComment(actor, input);
      return { ok: true, id: saved.id };
    }
    case "task.create": {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError(["Send the task fields as an object."]);
      const saved = await createTask(
        actor,
        { ...input, submissionKey: taskSubmissionKey(idempotencyKey) },
        { sourceReference: botTaskSourceReference(actor.name, idempotencyKey) },
      );
      return { ok: true, id: saved.id, duplicate: saved.duplicate };
    }
    case "task.update": {
      const saved = await updateTask(actor, input);
      return { ok: true, id: saved.id, changed: saved.changed };
    }
    default: {
      const neverOp: never = op;
      throw new RuleError(`Unknown operation ${neverOp}.`);
    }
  }
}

type GoOrAnswer = { kind: "go" } | { kind: "replay"; result: unknown } | { kind: "conflict" } | { kind: "in_progress" };

async function claim(db: ReturnType<typeof createAdminClient>, actorName: string, key: string, op: string, hash: string, now: Date): Promise<GoOrAnswer> {
  const finish = async (decision: ClaimDecision): Promise<GoOrAnswer> => {
    if (decision.kind === "replay" || decision.kind === "conflict" || decision.kind === "in_progress") return decision;
    if (decision.kind === "takeover") {
      const ok = await repo.takeOver(db, actorName, key, hash, new Date(now.getTime() - PENDING_STALE_MS).toISOString(), now.toISOString());
      return ok ? { kind: "go" } : { kind: "in_progress" };
    }
    const inserted = await repo.insertPending(db, { botName: actorName, key, operation: op, hash });
    if (inserted === "inserted") return { kind: "go" };
    const again = decideClaim(await repo.readKey(db, actorName, key), hash, now);
    if (again.kind === "insert") return { kind: "in_progress" };
    return finish(again);
  };
  return finish(decideClaim(await repo.readKey(db, actorName, key), hash, now));
}

function fromClaim(key: string, op: string, claim: Exclude<GoOrAnswer, { kind: "go" }>): OpResult {
  if (claim.kind === "replay") {
    const stored = asSuccess(claim.result);
    if (stored) return { ...stored, idempotencyKey: key, op, replayed: true };
    return { idempotencyKey: key, op, ok: false, replayed: false, error: "The stored result for this key could not be read." };
  }
  if (claim.kind === "conflict") {
    return { idempotencyKey: key, op, ok: false, replayed: false, error: "This idempotency key was already used for a different operation." };
  }
  return { idempotencyKey: key, op, ok: false, replayed: false, error: "This idempotency key is already running. Retry shortly." };
}

/**
 * Runs one daily batch. Operations run in order. A later operation may use `{ "$ref": "<idempotencyKey>" }`
 * as an id from an earlier success in the same batch. One operation failing does not roll back the others.
 */
export async function applyBatch(actor: Actor, raw: unknown, now: Date = new Date()): Promise<{ results: OpResult[] }> {
  assertBot(actor);
  const batch = parseInput(batchSchema, raw);
  const seen = new Set<string>();
  for (const op of batch.operations) {
    if (seen.has(op.idempotencyKey)) throw new ValidationError([`The idempotency key "${op.idempotencyKey}" is used more than once in this batch.`]);
    seen.add(op.idempotencyKey);
  }

  const db = createAdminClient();
  if ((await repo.probeStore(db)) === "missing") throw new BotStoreNotReadyError();

  const ids = new Map<string, string>();
  const results: OpResult[] = [];

  for (const op of batch.operations) {
    const hash = payloadHash(op.op, op.input);
    let owned = false;
    try {
      const decision = await claim(db, actor.name, op.idempotencyKey, op.op, hash, now);
      if (decision.kind !== "go") {
        const answered = fromClaim(op.idempotencyKey, op.op, decision);
        if (answered.ok && answered.id) ids.set(op.idempotencyKey, answered.id);
        results.push(answered);
        continue;
      }
      owned = true;
      const input = resolveRefs(op.input, ids);
      const saved = await runOp(actor, op.op, input, op.idempotencyKey, now);
      // The CRM row exists. Dropping the lock now would let a retry write it again.
      owned = false;
      const body: Json = saved;
      let recorded = false;
      try {
        recorded = await repo.completeKey(db, actor.name, op.idempotencyKey, {
          entityType: op.op,
          entityId: saved.id ?? null,
          body,
        });
      } catch {
        recorded = false;
      }
      if (saved.id) ids.set(op.idempotencyKey, saved.id);
      results.push({
        idempotencyKey: op.idempotencyKey,
        op: op.op,
        replayed: false,
        idempotencyRecorded: recorded,
        ...saved,
      });
    } catch (error) {
      if (owned) {
        await repo.deletePending(db, actor.name, op.idempotencyKey).catch(() => {});
      }
      if (!(error instanceof ValidationError || error instanceof RuleError || error instanceof PermissionError || error instanceof RateLimitError || error instanceof UnresolvedRef || error instanceof AuditWriteError)) {
        console.error("bot write failed", { op: op.op, name: error instanceof Error ? error.name : "unknown" });
      }
      results.push({ idempotencyKey: op.idempotencyKey, op: op.op, ok: false, replayed: false, error: failureMessage(error) });
    }
  }

  return { results };
}
