// Database access for push devices. Called only from service.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { PushTarget } from "@/platform/push/send";
import type { PushDevice } from "./types";

type Db = SupabaseClient<Database>;

export async function listDevices(db: Db): Promise<PushDevice[]> {
  const { data, error } = await db
    .from("push_devices")
    .select("id,label,created_at,last_success_at,failure_count")
    .order("created_at", { ascending: false });
  if (error || !data) throw new Error("Could not list devices");
  return data.map((d) => ({ id: d.id, label: d.label, createdAt: d.created_at, lastSuccessAt: d.last_success_at, failureCount: d.failure_count }));
}

export async function listEndpoints(db: Db): Promise<string[]> {
  const { data, error } = await db.from("push_devices").select("endpoint");
  if (error || !data) throw new Error("Could not list devices");
  return data.map((d) => d.endpoint);
}

export async function saveDevice(
  db: Db,
  ownerId: string,
  device: { endpoint: string; p256dh: string; auth: string; label: string | null },
): Promise<string> {
  const { data, error } = await db
    .from("push_devices")
    .upsert({ owner_id: ownerId, ...device, failure_count: 0 }, { onConflict: "endpoint" })
    .select("id")
    .single();
  if (error || !data) throw new Error("Could not save device");
  return data.id;
}

export async function deleteDevice(db: Db, id: string): Promise<boolean> {
  const { data, error } = await db.from("push_devices").delete().eq("id", id).select("id");
  if (error) throw new Error("Could not remove device");
  return (data?.length ?? 0) > 0;
}

// --- Server side (service-role client) ---------------------------------------

export async function listTargets(db: Db): Promise<PushTarget[]> {
  const { data, error } = await db.from("push_devices").select("id,endpoint,p256dh,auth");
  if (error || !data) throw new Error("Could not read devices");
  return data;
}

export async function recordSuccess(db: Db, ids: string[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await db.from("push_devices").update({ last_success_at: at.toISOString(), failure_count: 0 }).in("id", ids);
  if (error) throw new Error("Could not record delivery");
}

export async function recordFailure(db: Db, ids: string[]): Promise<void> {
  for (const id of ids) {
    const { data } = await db.from("push_devices").select("failure_count").eq("id", id).maybeSingle();
    await db.from("push_devices").update({ failure_count: (data?.failure_count ?? 0) + 1 }).eq("id", id);
  }
}

export async function removeDevices(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await db.from("push_devices").delete().in("id", ids);
  if (error) throw new Error("Could not remove dead devices");
}
