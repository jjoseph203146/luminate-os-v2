// Database access for the growth domain. Read-only. Called only from service.ts.
// Runs as the signed-in owner, so row-level security applies.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { stageOf } from "./rules";
import type { Lead } from "./types";

type Db = SupabaseClient<Database>;

const LIMIT = 500;

export async function listLeads(db: Db): Promise<Lead[]> {
  const { data, error } = await db
    .from("leads")
    .select("id,name,business_name,email,phone,status,follow_up_date,notes,source,estimated_value,created_at")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error || !data) throw new Error("Could not list leads");
  return data.map((l) => ({
    id: l.id,
    name: l.name,
    businessName: l.business_name,
    email: l.email,
    phone: l.phone,
    stage: stageOf(l.status),
    followUpDate: l.follow_up_date,
    notes: l.notes,
    source: l.source,
    value: l.estimated_value === null ? null : Number(l.estimated_value),
    createdAt: l.created_at,
  }));
}
