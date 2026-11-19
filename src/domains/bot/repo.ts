// Idempotency rows for the bot write API. Called only from service.ts, with the service-role client.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { isUndefinedTable } from "@/platform/db/schema-errors";
import type { ClaimRow } from "./rules";

type Db = SupabaseClient<Database>;

export class IdempotencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyError";
  }
}

export async function probeStore(db: Db): Promise<"ready" | "missing"> {
  const { error } = await db.from("bot_idempotency_keys").select("id").limit(1);
  if (!error) return "ready";
  if (isUndefinedTable(error, "bot_idempotency_keys")) return "missing";
  throw new IdempotencyError("Could not read the bot write store.");
}

export async function readKey(db: Db, botName: string, key: string): Promise<ClaimRow | null> {
  const { data, error } = await db
    .from("bot_idempotency_keys")
    .select("status,payload_hash,result,created_at")
    .eq("bot_name", botName)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (error) throw new IdempotencyError("Could not read an idempotency key.");
  if (!data) return null;
  return { status: data.status, payload_hash: data.payload_hash, result: data.result, created_at: data.created_at };
}

/** `exists` when this bot already has the key (unique violation). */
export async function insertPending(db: Db, row: { botName: string; key: string; operation: string; hash: string }): Promise<"inserted" | "exists"> {
  const { error } = await db.from("bot_idempotency_keys").insert({
    bot_name: row.botName,
    idempotency_key: row.key,
    operation: row.operation,
    payload_hash: row.hash,
    status: "pending",
  });
  if (!error) return "inserted";
  if (error.code === "23505") return "exists";
  throw new IdempotencyError("Could not store an idempotency key.");
}

/** True when this request took the stale lock. False when someone else still holds it. */
export async function takeOver(db: Db, botName: string, key: string, hash: string, staleBefore: string, nowIso: string): Promise<boolean> {
  const { data, error } = await db
    .from("bot_idempotency_keys")
    .update({ created_at: nowIso, updated_at: nowIso })
    .eq("bot_name", botName)
    .eq("idempotency_key", key)
    .eq("status", "pending")
    .eq("payload_hash", hash)
    .lt("created_at", staleBefore)
    .select("id");
  if (error) throw new IdempotencyError("Could not take over an idempotency key.");
  return (data?.length ?? 0) > 0;
}

export async function completeKey(
  db: Db,
  botName: string,
  key: string,
  result: { entityType: string | null; entityId: string | null; body: Json },
): Promise<boolean> {
  const { data, error } = await db
    .from("bot_idempotency_keys")
    .update({
      status: "completed",
      entity_type: result.entityType,
      entity_id: result.entityId,
      result: result.body,
      updated_at: new Date().toISOString(),
    })
    .eq("bot_name", botName)
    .eq("idempotency_key", key)
    .eq("status", "pending")
    .select("id");
  if (error) throw new IdempotencyError("Could not finish an idempotency key.");
  return (data?.length ?? 0) > 0;
}

/** Drops a pending lock after a failed attempt so the same key can be retried. Never deletes a completed row. */
export async function deletePending(db: Db, botName: string, key: string): Promise<void> {
  const { error } = await db.from("bot_idempotency_keys").delete().eq("bot_name", botName).eq("idempotency_key", key).eq("status", "pending");
  if (error) throw new IdempotencyError("Could not release an idempotency key.");
}
