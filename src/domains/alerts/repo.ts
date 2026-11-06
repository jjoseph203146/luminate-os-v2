// Database access for the activity alerts. Called only from service.ts, with the service-role client.
// Reads what the old app already writes (revenue_events, notifications, requests, clients) and writes only alert_state.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { SEEDED_KEY } from "./rules";
import type { AlertStateRow, ClientInfo, NoticeRow, PaymentRow, RequestInfo } from "./types";

type Db = SupabaseClient<Database>;

const LIMIT = 500;

export async function listRecentPayments(db: Db, since: Date): Promise<PaymentRow[]> {
  const iso = since.toISOString();
  const { data, error } = await db
    .from("revenue_events")
    .select("id,client_id,amount,status,created_at,paid_at")
    .or(`created_at.gte.${iso},paid_at.gte.${iso}`)
    .order("created_at", { ascending: true })
    .limit(LIMIT);
  if (error || !data) throw new Error("Could not read payments");
  return data.map((p) => ({ id: p.id, clientId: p.client_id, amount: Number(p.amount), status: p.status, createdAt: p.created_at, paidAt: p.paid_at }));
}

export async function listRecentNotices(db: Db, since: Date): Promise<NoticeRow[]> {
  const { data, error } = await db
    .from("notifications")
    .select("id,type,client_id,request_id,read,created_at")
    .in("type", ["new_request", "new_comment"])
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: true })
    .limit(LIMIT);
  if (error || !data) throw new Error("Could not read client notifications");
  return data.map((n) => ({ id: n.id, type: n.type, clientId: n.client_id, requestId: n.request_id, read: n.read, createdAt: n.created_at }));
}

export async function listClients(db: Db, ids: string[]): Promise<ClientInfo[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db.from("clients").select("id,business_name,archived_at,on_hold_since").in("id", ids);
  if (error || !data) throw new Error("Could not read clients");
  return data.map((c) => ({ id: c.id, name: c.business_name, archived: c.archived_at !== null, onHold: c.on_hold_since !== null }));
}

export async function listRequests(db: Db, ids: string[]): Promise<RequestInfo[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db.from("requests").select("id,display_id,title").in("id", ids);
  if (error || !data) throw new Error("Could not read requests");
  return data.map((r) => ({ id: r.id, displayId: r.display_id, title: r.title }));
}

/** Keys per request: keeps the URL short, and each answer far below the API's row cap. */
const KEY_CHUNK = 100;

/**
 * What was already announced, for exactly these keys (plus the "seeded" marker). Asking by key, not reading
 * the whole table, means old keys that are never pruned can never push a recent one out of the answer.
 */
export async function listAlertState(db: Db, keys: string[]): Promise<AlertStateRow[]> {
  const wanted = [SEEDED_KEY, ...new Set(keys)];
  const out: AlertStateRow[] = [];
  for (let i = 0; i < wanted.length; i += KEY_CHUNK) {
    const { data, error } = await db.from("alert_state").select("key,state").in("key", wanted.slice(i, i + KEY_CHUNK));
    if (error || !data) throw new Error("Could not read alert state");
    out.push(...data);
  }
  return out;
}

export async function saveAlertState(db: Db, key: string, state: string, notifiedAt: Date | null): Promise<void> {
  const row: Database["public"]["Tables"]["alert_state"]["Insert"] = { key, state, updated_at: new Date().toISOString() };
  if (notifiedAt) row.notified_at = notifiedAt.toISOString();
  const { error } = await db.from("alert_state").upsert(row, { onConflict: "key" });
  if (error) throw new Error("Could not save alert state");
}
