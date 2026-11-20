// Database reads for the owner dashboard. No writes. Contact details and notes are not selected.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isUndefinedColumn, isUndefinedTable, type DbErrorLike } from "@/platform/db/schema-errors";
import { stageOf } from "@/domains/growth/rules";
import type { ClientsLoad, DashboardClient, DashboardLead, DashboardPayment, LeadsLoad, PaymentsLoad } from "./types";

type Db = SupabaseClient<Database>;

const PAGE = 1000;
const MAX_PAGES = 20;

const BASE_COLUMNS = ["id", "business_name", "status", "follow_up_date", "source", "estimated_value", "created_at"] as const;
const PIPELINE_COLUMNS = ["client_id", "stage_changed_at", "last_touch_at", "next_step", "next_step_on", "lost_reason", "kind"] as const;

/** Columns read for every lead. Email, phone, contact name and notes are intentionally absent. */
export const LEAD_BASE_COLUMNS = BASE_COLUMNS.join(",");
/** Migration 0011 columns. Read only when they exist. */
export const LEAD_PIPELINE_COLUMNS = PIPELINE_COLUMNS.join(",");

const CLIENT_COLUMNS = ["id", "business_name", "archived_at", "lifetime_value"] as const;
const PAYMENT_COLUMNS = ["amount", "status", "paid_at", "client_id"] as const;

/** Client columns. Email, phone and contact name are intentionally absent. */
export const CLIENT_READ_COLUMNS = CLIENT_COLUMNS.join(",");
export const PAYMENT_READ_COLUMNS = PAYMENT_COLUMNS.join(",");

export function isUndefinedColumnError(error: DbErrorLike | null | undefined): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

/** Column name as its own word, so `id` does not match `client_id`. */
function namesColumn(error: DbErrorLike | null | undefined, column: string): boolean {
  if (!isUndefinedColumnError(error)) return false;
  return new RegExp(`\\b${column}\\b`, "i").test(error?.message ?? "");
}

/** True when a pipeline column from migration 0011 is the one Postgres or PostgREST could not find. */
export function isPipelineColumnMiss(error: DbErrorLike | null | undefined): boolean {
  return PIPELINE_COLUMNS.some((column) => namesColumn(error, column) || isUndefinedColumn(error, column));
}

export function isLeadSchemaMiss(error: DbErrorLike | null | undefined): boolean {
  if (isUndefinedColumnError(error)) return BASE_COLUMNS.some((column) => namesColumn(error, column));
  return isUndefinedTable(error, "leads");
}

export function isClientSchemaMiss(error: DbErrorLike | null | undefined): boolean {
  if (isUndefinedColumnError(error)) return CLIENT_COLUMNS.some((column) => namesColumn(error, column));
  return isUndefinedTable(error, "clients");
}

export function isPaymentSchemaMiss(error: DbErrorLike | null | undefined): boolean {
  if (isUndefinedColumnError(error)) return PAYMENT_COLUMNS.some((column) => namesColumn(error, column));
  return isUndefinedTable(error, "revenue_events");
}

type PageResult<T> = { data: T[] | null; error: DbErrorLike | null };

async function eachPage<T>(fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<{ rows: T[]; truncated: boolean; error: DbErrorLike | null }> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) return { rows, truncated: false, error };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, truncated: false, error: null };
  }
  return { rows, truncated: true, error: null };
}

type LeadRow = {
  id: string;
  business_name: string;
  status: string;
  follow_up_date: string | null;
  source: string | null;
  estimated_value: number | string | null;
  created_at: string;
  client_id?: string | null;
  stage_changed_at?: string | null;
  last_touch_at?: string | null;
  next_step?: string | null;
  next_step_on?: string | null;
  lost_reason?: string | null;
  kind?: string | null;
};

function moneyOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function toLead(row: LeadRow, pipeline: boolean): DashboardLead {
  return {
    id: row.id,
    businessName: row.business_name ?? "",
    stage: stageOf(row.status),
    source: row.source,
    value: moneyOrNull(row.estimated_value),
    createdAt: row.created_at,
    followUpDate: row.follow_up_date,
    clientId: pipeline ? (row.client_id ?? null) : null,
    stageChangedAt: pipeline ? (row.stage_changed_at ?? null) : null,
    lastTouchAt: pipeline ? (row.last_touch_at ?? null) : null,
    nextStep: pipeline ? (row.next_step ?? null) : null,
    nextStepOn: pipeline ? (row.next_step_on ?? null) : null,
    lostReason: pipeline ? (row.lost_reason ?? null) : null,
    kind: pipeline ? (row.kind ?? null) : null,
  };
}

async function readLeads(db: Db, pipeline: boolean): Promise<LeadsLoad | "fallback"> {
  const columns = pipeline ? `${LEAD_BASE_COLUMNS},${LEAD_PIPELINE_COLUMNS}` : LEAD_BASE_COLUMNS;
  const result = await eachPage<LeadRow>(async (from, to) => {
    const { data, error } = await db.from("leads").select(columns).order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, to);
    return { data: (data as LeadRow[] | null) ?? null, error };
  });
  if (result.error && pipeline && (isPipelineColumnMiss(result.error) || isUndefinedColumnError(result.error))) return "fallback";
  if (result.error && isLeadSchemaMiss(result.error)) return { available: false };
  if (result.error) throw new Error("Could not read leads");
  return { available: true, pipelineAvailable: pipeline, truncated: result.truncated, rows: result.rows.map((row) => toLead(row, pipeline)) };
}

async function loadLeads(db: Db): Promise<LeadsLoad> {
  const extended = await readLeads(db, true);
  if (extended !== "fallback") return extended;
  const basic = await readLeads(db, false);
  if (basic === "fallback") return { available: false };
  return basic;
}

type ClientRow = { id: string; business_name: string; archived_at: string | null; lifetime_value: number | string | null };

async function loadClients(db: Db): Promise<ClientsLoad> {
  const result = await eachPage<ClientRow>(async (from, to) => {
    const { data, error } = await db.from("clients").select(CLIENT_READ_COLUMNS).order("id", { ascending: true }).range(from, to);
    return { data: (data as ClientRow[] | null) ?? null, error };
  });
  if (result.error && isClientSchemaMiss(result.error)) return { available: false };
  if (result.error) throw new Error("Could not read clients");
  const rows: DashboardClient[] = result.rows.map((row) => ({
    id: row.id,
    businessName: row.business_name ?? "",
    archived: row.archived_at !== null,
    lifetimeValue: moneyOrNull(row.lifetime_value) ?? 0,
  }));
  return { available: true, truncated: result.truncated, rows };
}

type PaymentRow = { amount: number | string | null; status: string; paid_at: string | null; client_id: string | null };

async function loadPayments(db: Db): Promise<PaymentsLoad> {
  const result = await eachPage<PaymentRow>(async (from, to) => {
    const { data, error } = await db
      .from("revenue_events")
      .select(PAYMENT_READ_COLUMNS)
      .eq("status", "paid")
      .gt("amount", 0)
      .order("paid_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    return { data: (data as PaymentRow[] | null) ?? null, error };
  });
  if (result.error && isPaymentSchemaMiss(result.error)) return { available: false };
  if (result.error) throw new Error("Could not read payments");
  const rows: DashboardPayment[] = [];
  for (const row of result.rows) {
    const amount = moneyOrNull(row.amount);
    if (amount === null) continue;
    rows.push({ amount, status: row.status, paidAt: row.paid_at, clientId: row.client_id });
  }
  return { available: true, truncated: result.truncated, rows };
}

export interface DashboardLoad {
  leads: LeadsLoad;
  clients: ClientsLoad;
  payments: PaymentsLoad;
}

/** Reads leads, clients and paid revenue. A missing table or column becomes unavailable. Other errors are thrown. */
export async function loadDashboard(db: Db): Promise<DashboardLoad> {
  const [leads, clients, payments] = await Promise.all([loadLeads(db), loadClients(db), loadPayments(db)]);
  return { leads, clients, payments };
}
