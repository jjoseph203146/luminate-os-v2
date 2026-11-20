// Database access for the growth domain. Called only from service.ts.
// The Growth screen runs as the signed-in owner, so row-level security applies;
// the website form, the bot, and the Won backfill use the service-role client.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isUndefinedColumn, isUndefinedTable } from "@/platform/db/schema-errors";
import type { ReadOnlyDb } from "./readonly-db";
import { isLostReason, stageOf, type LeadFields } from "./rules";
import type { ActivityDirection, ActivityKind, Lead, LeadKind, LeadStatus, Stage } from "./types";

type Db = SupabaseClient<Database>;

/** Selects use the Supabase row types. A preview client is still the read-only wrapper at runtime, so a write throws. */
function asDb(db: Db | ReadOnlyDb): Db {
  return db as Db;
}

const LIMIT = 500;

const BASE_COLUMNS = "id,name,business_name,email,phone,status,follow_up_date,notes,source,estimated_value,created_at";
const PIPELINE_COLUMNS = "client_id,stage_changed_at,last_touch_at,next_step,next_step_on,lost_reason,kind,campaign";
const EXTENDED_COLUMNS = `${BASE_COLUMNS},${PIPELINE_COLUMNS}`;

const PIPELINE_COLUMN_NAMES = ["client_id", "stage_changed_at", "last_touch_at", "next_step", "next_step_on", "lost_reason", "kind", "campaign"] as const;

/** Migration 0011 is not visible yet. Callers turn this into a message and write nothing new. */
export class PipelineNotReadyError extends Error {
  constructor() {
    super("Apply migration 0011 before saving this.");
    this.name = "PipelineNotReadyError";
  }
}

function missingPipelineColumn(error: { code?: string; message?: string } | null): boolean {
  return PIPELINE_COLUMN_NAMES.some((column) => isUndefinedColumn(error, column));
}

type LeadRow = {
  id: string;
  name: string;
  business_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  follow_up_date: string | null;
  notes: string | null;
  source: string | null;
  estimated_value: number | null;
  created_at: string;
  client_id?: string | null;
  stage_changed_at?: string | null;
  last_touch_at?: string | null;
  next_step?: string | null;
  next_step_on?: string | null;
  lost_reason?: string | null;
  kind?: string | null;
  campaign?: string | null;
};

function kindOf(value: string | null | undefined): LeadKind | null {
  return value === "inbound" || value === "outbound" ? value : null;
}

function toLead(row: LeadRow, pipeline: boolean): Lead {
  return {
    id: row.id,
    name: row.name,
    businessName: row.business_name,
    email: row.email,
    phone: row.phone,
    stage: stageOf(row.status),
    followUpDate: row.follow_up_date,
    notes: row.notes,
    source: row.source,
    value: row.estimated_value === null ? null : Number(row.estimated_value),
    createdAt: row.created_at,
    clientId: pipeline ? (row.client_id ?? null) : null,
    stageChangedAt: pipeline ? (row.stage_changed_at ?? null) : null,
    lastTouchAt: pipeline ? (row.last_touch_at ?? null) : null,
    nextStep: pipeline ? (row.next_step ?? null) : null,
    nextStepOn: pipeline ? (row.next_step_on ?? null) : null,
    lostReason: pipeline && isLostReason(row.lost_reason) ? row.lost_reason : null,
    kind: pipeline ? kindOf(row.kind) : null,
    campaign: pipeline ? (row.campaign ?? null) : null,
  };
}

export async function listLeads(db: Db): Promise<Lead[]> {
  const extended = await db.from("leads").select(EXTENDED_COLUMNS).order("created_at", { ascending: false }).limit(LIMIT);
  if (!extended.error && extended.data) return (extended.data as LeadRow[]).map((row) => toLead(row, true));
  if (!missingPipelineColumn(extended.error)) throw new Error("Could not list leads");
  const basic = await db.from("leads").select(BASE_COLUMNS).order("created_at", { ascending: false }).limit(LIMIT);
  if (basic.error || !basic.data) throw new Error("Could not list leads");
  return (basic.data as LeadRow[]).map((row) => toLead(row, false));
}

/** True when migration 0011's lead columns and lead_activities table are both visible. */
export async function pipelineReady(db: ReadOnlyDb): Promise<boolean>;
export async function pipelineReady(db: Db): Promise<boolean>;
export async function pipelineReady(db: Db | ReadOnlyDb): Promise<boolean> {
  db = asDb(db);
  const column = await db.from("leads").select("client_id").limit(1);
  if (column.error) {
    if (missingPipelineColumn(column.error)) return false;
    throw new Error("Could not read leads");
  }
  const table = await db.from("lead_activities").select("id").limit(1);
  if (table.error) {
    if (isUndefinedTable(table.error, "lead_activities")) return false;
    throw new Error("Could not read lead activities");
  }
  return true;
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

const toRow = (f: Partial<LeadFields>): Database["public"]["Tables"]["leads"]["Update"] => {
  const row: Database["public"]["Tables"]["leads"]["Update"] = {};
  if (f.name !== undefined) row.name = f.name;
  if (f.businessName !== undefined) row.business_name = f.businessName;
  if (f.email !== undefined) row.email = f.email;
  if (f.phone !== undefined) row.phone = f.phone;
  if (f.notes !== undefined) row.notes = f.notes;
  if (f.followUpDate !== undefined) row.follow_up_date = f.followUpDate;
  if (f.source !== undefined) row.source = f.source;
  if (f.value !== undefined) row.estimated_value = f.value;
  if (f.nextStep !== undefined) row.next_step = f.nextStep;
  if (f.nextStepOn !== undefined) row.next_step_on = f.nextStepOn;
  if (f.lostReason !== undefined) row.lost_reason = f.lostReason;
  if (f.kind !== undefined) row.kind = f.kind;
  if (f.campaign !== undefined) row.campaign = f.campaign;
  return row;
};

export interface StoredLead extends LeadFields {
  id: string;
  stage: Stage;
  clientId: string | null;
  stageChangedAt: string | null;
  lastTouchAt: string | null;
}

function toStored(lead: Lead): StoredLead {
  return {
    id: lead.id,
    name: lead.name,
    businessName: lead.businessName,
    email: lead.email,
    phone: lead.phone,
    notes: lead.notes,
    followUpDate: lead.followUpDate,
    source: lead.source,
    value: lead.value,
    nextStep: lead.nextStep ?? null,
    nextStepOn: lead.nextStepOn ?? null,
    lostReason: lead.lostReason ?? null,
    kind: lead.kind ?? null,
    campaign: lead.campaign ?? null,
    stage: lead.stage,
    clientId: lead.clientId ?? null,
    stageChangedAt: lead.stageChangedAt ?? null,
    lastTouchAt: lead.lastTouchAt ?? null,
  };
}

/** One lead's editable fields and stage, or null when there is no such lead. */
export async function getLead(db: Db, id: string): Promise<StoredLead | null> {
  const extended = await db.from("leads").select(EXTENDED_COLUMNS).eq("id", id).maybeSingle();
  if (!extended.error) return extended.data ? toStored(toLead(extended.data as LeadRow, true)) : null;
  if (!missingPipelineColumn(extended.error)) throw new Error("Could not read the lead");
  const basic = await db.from("leads").select(BASE_COLUMNS).eq("id", id).maybeSingle();
  if (basic.error) throw new Error("Could not read the lead");
  return basic.data ? toStored(toLead(basic.data as LeadRow, false)) : null;
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
  const row = toRow(fields);
  const pipeline = PIPELINE_COLUMN_NAMES.some((column) => column in row && row[column as keyof typeof row] != null);
  const insertRow = pipeline ? row : stripPipeline(row);
  const { data, error } = await db.from("leads").insert({ ...insertRow, business_name: fields.businessName, name: fields.name, status }).select("id").single();
  if (error && pipeline && missingPipelineColumn(error)) throw new PipelineNotReadyError();
  if (error || !data) throw new Error("Could not save lead");
  return data.id;
}

function stripPipeline(row: Database["public"]["Tables"]["leads"]["Update"]): Database["public"]["Tables"]["leads"]["Insert"] {
  const next = { ...row };
  delete next.next_step;
  delete next.next_step_on;
  delete next.lost_reason;
  delete next.kind;
  delete next.campaign;
  delete next.client_id;
  delete next.stage_changed_at;
  delete next.last_touch_at;
  return next as Database["public"]["Tables"]["leads"]["Insert"];
}

/** Saves the edited fields (only those given). Returns false when the lead no longer exists. */
export async function updateLead(db: Db, id: string, fields: Partial<LeadFields>): Promise<boolean> {
  // updated_at is set by the trg_leads_updated_at trigger.
  const row = toRow(fields);
  const { data, error } = await db.from("leads").update(row).eq("id", id).select("id");
  if (error && missingPipelineColumn(error)) throw new PipelineNotReadyError();
  if (error) throw new Error("Could not save lead");
  return (data?.length ?? 0) > 0;
}

/**
 * Writes the old status value. When migration 0011 is visible, also stamps stage_changed_at
 * unless the caller passes null (the status did not change). Returns "legacy" when the timestamp
 * column is not there yet: the status was still saved.
 */
export async function setLeadStatus(db: Db, id: string, status: LeadStatus, stageChangedAt: string | null): Promise<"ok" | "legacy" | "missing"> {
  const patch: Database["public"]["Tables"]["leads"]["Update"] = { status };
  if (stageChangedAt) patch.stage_changed_at = stageChangedAt;
  const first = await db.from("leads").update(patch).eq("id", id).select("id");
  if (!first.error) return (first.data?.length ?? 0) > 0 ? "ok" : "missing";
  if (!stageChangedAt || !isUndefinedColumn(first.error, "stage_changed_at")) throw new Error("Could not change the lead's stage");
  const second = await db.from("leads").update({ status }).eq("id", id).select("id");
  if (second.error) throw new Error("Could not change the lead's stage");
  return (second.data?.length ?? 0) > 0 ? "legacy" : "missing";
}

export async function setLeadClient(db: Db, id: string, clientId: string): Promise<boolean> {
  const { data, error } = await db.from("leads").update({ client_id: clientId }).eq("id", id).is("client_id", null).select("id");
  if (error && missingPipelineColumn(error)) throw new PipelineNotReadyError();
  if (error) throw new Error("Could not link the lead");
  return (data?.length ?? 0) > 0;
}

export async function setLastTouch(db: Db, id: string, at: string | null): Promise<boolean> {
  const { data, error } = await db.from("leads").update({ last_touch_at: at }).eq("id", id).select("id");
  if (error && isUndefinedColumn(error, "last_touch_at")) throw new PipelineNotReadyError();
  if (error) throw new Error("Could not save the last touch");
  return (data?.length ?? 0) > 0;
}

export async function deleteLead(db: Db, id: string): Promise<boolean> {
  const { data, error } = await db.from("leads").delete().eq("id", id).select("id");
  if (error) throw new Error("Could not delete the lead");
  return (data?.length ?? 0) > 0;
}

export interface ClientCandidateRow {
  id: string;
  businessName: string;
  email: string;
  contactName: string;
  phone: string | null;
  archived: boolean;
  lifetimeValue: number;
}

export async function listClientCandidates(db: ReadOnlyDb): Promise<ClientCandidateRow[]>;
export async function listClientCandidates(db: Db): Promise<ClientCandidateRow[]>;
export async function listClientCandidates(db: Db | ReadOnlyDb): Promise<ClientCandidateRow[]> {
  db = asDb(db);
  const { data, error } = await db.from("clients").select("id,business_name,email,contact_name,phone,archived_at,lifetime_value").limit(LIMIT);
  if (error || !data) throw new Error("Could not list clients");
  if (data.length >= LIMIT) throw new Error("Too many clients to read in one pass.");
  return data.map((row) => ({
    id: row.id,
    businessName: row.business_name,
    email: row.email,
    contactName: row.contact_name,
    phone: row.phone,
    archived: row.archived_at !== null,
    lifetimeValue: Number(row.lifetime_value ?? 0),
  }));
}

/** Client ids that have at least one paid revenue row with a positive amount. */
export async function listPaidClientIds(db: ReadOnlyDb): Promise<Set<string>>;
export async function listPaidClientIds(db: Db): Promise<Set<string>>;
export async function listPaidClientIds(db: Db | ReadOnlyDb): Promise<Set<string>> {
  db = asDb(db);
  const ids = new Set<string>();
  const page = 1000;
  for (let from = 0; from < 20_000; from += page) {
    const { data, error } = await db.from("revenue_events").select("client_id").eq("status", "paid").gt("amount", 0).not("client_id", "is", null).range(from, from + page - 1);
    if (error) throw new Error("Could not read payments");
    for (const row of data ?? []) if (row.client_id) ids.add(row.client_id);
    if ((data?.length ?? 0) < page) break;
  }
  return ids;
}

export async function clientExists(db: Db, id: string): Promise<boolean> {
  const { data, error } = await db.from("clients").select("id").eq("id", id).maybeSingle();
  if (error) throw new Error("Could not read the client");
  return data !== null;
}

export async function insertClient(db: Db, fields: { business_name: string; contact_name: string; email: string; phone: string | null; status: "active" }): Promise<string> {
  const { data, error } = await db.from("clients").insert(fields).select("id").single();
  if (error || !data) throw new Error("Could not create the client");
  return data.id;
}

export async function insertAccount(db: Db, name: string): Promise<string> {
  const { data, error } = await db.from("accounts").insert({ name }).select("id").single();
  if (error || !data) throw new Error("Could not create the account");
  return data.id;
}

/** Links only while the client has no account. Returns false when another link won the race. */
export async function linkAccount(db: Db, clientId: string, accountId: string): Promise<boolean> {
  const { data, error } = await db.from("clients").update({ account_id: accountId }).eq("id", clientId).is("account_id", null).select("id");
  if (error) throw new Error("Could not link the account");
  return (data?.length ?? 0) > 0;
}

/** Removes an account this same call just created, when the client link lost a race. */
export async function deleteUnusedAccount(db: Db, accountId: string): Promise<void> {
  await db.from("accounts").delete().eq("id", accountId);
}

export interface LeadActivityInput {
  leadId: string;
  kind: ActivityKind;
  direction?: ActivityDirection | null;
  occurredAt?: string;
  summary: string;
  body?: string | null;
  actorType: string;
  actorName?: string | null;
}

/** Inserts one activity. "unavailable" when migration 0011 has not created the table. */
export async function insertLeadActivity(db: Db, input: LeadActivityInput): Promise<string | "unavailable"> {
  const { data, error } = await db
    .from("lead_activities")
    .insert({
      lead_id: input.leadId,
      kind: input.kind,
      direction: input.direction ?? null,
      ...(input.occurredAt ? { occurred_at: input.occurredAt } : {}),
      summary: input.summary,
      body: input.body ?? null,
      actor_type: input.actorType,
      actor_name: input.actorName ?? null,
    })
    .select("id")
    .single();
  if (error && isUndefinedTable(error, "lead_activities")) return "unavailable";
  if (error || !data) throw new Error("Could not log the lead activity");
  return data.id;
}

export interface BackfillLeadRow {
  id: string;
  name: string;
  businessName: string;
  email: string | null;
  phone: string | null;
  stage: Stage;
  clientId: string | null;
}

/** Every lead the backfill needs. Refuses a full page so a truncated read cannot skip someone. */
export async function listLeadsForBackfill(db: ReadOnlyDb): Promise<BackfillLeadRow[]>;
export async function listLeadsForBackfill(db: Db): Promise<BackfillLeadRow[]>;
export async function listLeadsForBackfill(db: Db | ReadOnlyDb): Promise<BackfillLeadRow[]> {
  db = asDb(db);
  const { data, error } = await db.from("leads").select("id,name,business_name,email,phone,status,client_id").limit(LIMIT);
  if (error && missingPipelineColumn(error)) throw new PipelineNotReadyError();
  if (error || !data) throw new Error("Could not list leads");
  if (data.length >= LIMIT) throw new Error("Too many leads to backfill in one pass.");
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    businessName: row.business_name,
    email: row.email,
    phone: row.phone,
    stage: stageOf(row.status),
    clientId: row.client_id,
  }));
}
