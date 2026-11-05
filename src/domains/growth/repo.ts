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

// --- Website contact form (service-role client) -------------------------------

export async function countSourceSince(db: Db, source: string, since: Date): Promise<number> {
  const { count, error } = await db.from("leads").select("id", { count: "exact", head: true }).eq("source", source).gte("created_at", since.toISOString());
  if (error) throw new Error("Could not count leads");
  return count ?? 0;
}

/** The same person sending the form twice in a row (a double click, a retry). */
export async function findRecentDuplicate(db: Db, args: { name: string; email: string; phone: string; since: Date }): Promise<boolean> {
  let q = db.from("leads").select("id").eq("name", args.name).gte("created_at", args.since.toISOString()).limit(1);
  q = args.email ? q.eq("email", args.email) : q.eq("phone", args.phone);
  const { data, error } = await q;
  if (error) throw new Error("Could not check for duplicates");
  return (data?.length ?? 0) > 0;
}

export async function insertLead(
  db: Db,
  lead: { name: string; businessName: string; email: string; phone: string; notes: string; source: string },
): Promise<string> {
  const { data, error } = await db
    .from("leads")
    .insert({
      name: lead.name,
      business_name: lead.businessName,
      email: lead.email || null,
      phone: lead.phone || null,
      notes: lead.notes || null,
      source: lead.source,
      status: "interested",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("Could not save lead");
  return data.id;
}
