// Database access for the growth domain. Called only from service.ts.
// The Growth screen runs as the signed-in owner, so row-level security applies;
// the website form uses the service-role client (see below).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { stageOf, type LeadFields } from "./rules";
import type { Lead, LeadStatus, Stage } from "./types";

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

// --- Leads added and edited by hand (owner's client) -----------------------------

const toRow = (f: LeadFields) => ({
  name: f.name,
  business_name: f.businessName,
  email: f.email,
  phone: f.phone,
  notes: f.notes,
  follow_up_date: f.followUpDate,
  source: f.source,
  estimated_value: f.value,
});

/** One lead's editable fields and stage, or null when there is no such lead. */
export async function getLead(db: Db, id: string): Promise<(LeadFields & { id: string; stage: Stage }) | null> {
  const { data, error } = await db
    .from("leads")
    .select("id,name,business_name,email,phone,status,follow_up_date,notes,source,estimated_value")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Could not read the lead");
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    businessName: data.business_name,
    email: data.email,
    phone: data.phone,
    stage: stageOf(data.status),
    followUpDate: data.follow_up_date,
    notes: data.notes,
    source: data.source,
    value: data.estimated_value === null ? null : Number(data.estimated_value),
  };
}

/** A lead with the same name and contact saved since `since` (a double tap or a retry). */
export async function findRecentLeadId(db: Db, args: { name: string; businessName: string; email: string | null; phone: string | null; since: Date }): Promise<string | null> {
  let q = db.from("leads").select("id").eq("name", args.name).gte("created_at", args.since.toISOString());
  if (args.email) q = q.eq("email", args.email);
  else if (args.phone) q = q.eq("phone", args.phone);
  else q = q.eq("business_name", args.businessName);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error("Could not check for duplicates");
  return data?.[0]?.id ?? null;
}

export async function insertManualLead(db: Db, fields: LeadFields, status: LeadStatus): Promise<string> {
  const { data, error } = await db.from("leads").insert({ ...toRow(fields), status }).select("id").single();
  if (error || !data) throw new Error("Could not save lead");
  return data.id;
}

/** Saves the edited fields (only those given). Returns false when the lead no longer exists. */
export async function updateLead(db: Db, id: string, fields: Partial<LeadFields>): Promise<boolean> {
  // updated_at is set by the trg_leads_updated_at trigger.
  const row: Database["public"]["Tables"]["leads"]["Update"] = {};
  if (fields.name !== undefined) row.name = fields.name;
  if (fields.businessName !== undefined) row.business_name = fields.businessName;
  if (fields.email !== undefined) row.email = fields.email;
  if (fields.phone !== undefined) row.phone = fields.phone;
  if (fields.notes !== undefined) row.notes = fields.notes;
  if (fields.followUpDate !== undefined) row.follow_up_date = fields.followUpDate;
  if (fields.source !== undefined) row.source = fields.source;
  if (fields.value !== undefined) row.estimated_value = fields.value;
  const { data, error } = await db.from("leads").update(row).eq("id", id).select("id");
  if (error) throw new Error("Could not save lead");
  return (data?.length ?? 0) > 0;
}

export async function setLeadStatus(db: Db, id: string, status: LeadStatus): Promise<boolean> {
  const { data, error } = await db.from("leads").update({ status }).eq("id", id).select("id");
  if (error) throw new Error("Could not change the lead's stage");
  return (data?.length ?? 0) > 0;
}

export async function deleteLead(db: Db, id: string): Promise<boolean> {
  const { data, error } = await db.from("leads").delete().eq("id", id).select("id");
  if (error) throw new Error("Could not delete the lead");
  return (data?.length ?? 0) > 0;
}
