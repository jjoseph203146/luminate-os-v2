// Database access for SOP billing tasks. Called only from service.ts: with the owner's own client (row-level security
// applies) for the screens and owner actions, and with the service-role client for the billing job.
// Error messages are generic: they can reach a job run's error column and must never carry client data.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { NewAction, NewCycle } from "./rules";
import type { Action, Agreement, AgreementStatus, Cycle, CycleStatus, InvoiceSender, Milestone, VerifiedPayment } from "./types";

type Db = SupabaseClient<Database>;

export class RepoError extends Error {
  constructor(what: string) {
    super(`Could not ${what}`);
    this.name = "RepoError";
  }
}

const isUnique = (error: { code?: string } | null) => error?.code === "23505";

const AGREEMENT_COLUMNS = "id,client_id,plan_name,monthly_price_cents,anniversary_day,starts_on,status,invoice_sender,payment_link_url,tasks_from,source,stripe_subscription_id";
const CYCLE_COLUMNS =
  "id,agreement_id,client_id,due_on,amount_cents,plan_name,invoice_sender,status,paid_at,payment_ref,invoice_sent_at,reminder_sent_at,invoice_url,manual_amount_cents,manual_method,manual_note";

type AgreementRow = Database["public"]["Tables"]["care_agreements"]["Row"];
type CycleRow = Database["public"]["Tables"]["billing_cycles"]["Row"];

export function toAgreement(
  r: Pick<AgreementRow, "id" | "client_id" | "plan_name" | "monthly_price_cents" | "anniversary_day" | "starts_on" | "status" | "invoice_sender" | "payment_link_url" | "tasks_from" | "source" | "stripe_subscription_id">,
): Agreement {
  return {
    id: r.id,
    clientId: r.client_id,
    planName: r.plan_name,
    monthlyPriceCents: r.monthly_price_cents,
    anniversaryDay: r.anniversary_day,
    startsOn: r.starts_on,
    status: r.status as AgreementStatus,
    invoiceSender: r.invoice_sender as InvoiceSender,
    paymentLinkUrl: r.payment_link_url,
    tasksFrom: r.tasks_from,
    source: r.source === "manual" ? "manual" : "stripe",
    stripeSubscriptionId: r.stripe_subscription_id,
  };
}

export type CycleRecord = Cycle & { paymentRef: string | null; invoiceUrl: string | null; manualAmountCents: number | null; manualMethod: string | null; manualNote: string | null };

function toCycle(r: Partial<CycleRow> & Pick<CycleRow, "id" | "agreement_id" | "client_id" | "due_on" | "amount_cents" | "invoice_sender" | "status">): CycleRecord {
  return {
    id: r.id,
    agreementId: r.agreement_id,
    clientId: r.client_id,
    dueOn: r.due_on,
    amountCents: r.amount_cents,
    planName: r.plan_name ?? null,
    invoiceSender: r.invoice_sender as InvoiceSender,
    status: r.status as CycleStatus,
    paidAt: r.paid_at ?? null,
    paymentRef: r.payment_ref ?? null,
    invoiceSentAt: r.invoice_sent_at ?? null,
    reminderSentAt: r.reminder_sent_at ?? null,
    invoiceUrl: r.invoice_url ?? null,
    manualAmountCents: r.manual_amount_cents ?? null,
    manualMethod: r.manual_method ?? null,
    manualNote: r.manual_note ?? null,
  };
}

// --- reads ----------------------------------------------------------------------------------------------------------

export interface ClientBasics {
  id: string;
  name: string;
  status: string;
  archived: boolean;
  subscriptionPrice: number;
  planName: string | null;
  billingAnchorDate: string | null;
  clientSince: string | null;
  stripeCustomerId: string | null;
}

const CLIENT_COLUMNS = "id,business_name,status,archived_at,subscription_price,plan_name,billing_anchor_date,client_since,stripe_customer_id";
type ClientPick = Pick<Database["public"]["Tables"]["clients"]["Row"], "id" | "business_name" | "status" | "archived_at" | "subscription_price" | "plan_name" | "billing_anchor_date" | "client_since" | "stripe_customer_id">;
const toClient = (c: ClientPick): ClientBasics => ({
  id: c.id,
  name: c.business_name,
  status: c.status,
  archived: c.archived_at !== null,
  subscriptionPrice: Number(c.subscription_price ?? 0),
  planName: c.plan_name,
  billingAnchorDate: c.billing_anchor_date,
  clientSince: c.client_since,
  stripeCustomerId: c.stripe_customer_id,
});

export async function getClient(db: Db, clientId: string): Promise<ClientBasics | null> {
  const { data, error } = await db.from("clients").select(CLIENT_COLUMNS).eq("id", clientId).maybeSingle();
  if (error) throw new RepoError("read the client");
  return data ? toClient(data) : null;
}

export async function listClients(db: Db, ids?: string[]): Promise<ClientBasics[]> {
  let q = db.from("clients").select(CLIENT_COLUMNS);
  if (ids) {
    if (ids.length === 0) return [];
    q = q.in("id", ids);
  }
  const { data, error } = await q.limit(2000);
  if (error) throw new RepoError("read the clients");
  return (data ?? []).map(toClient);
}

export async function listAgreements(db: Db): Promise<Agreement[]> {
  const { data, error } = await db.from("care_agreements").select(AGREEMENT_COLUMNS).limit(2000);
  if (error) throw new RepoError("read the billing schedules");
  return (data ?? []).map(toAgreement);
}

/** The client's schedule that is not cancelled (at most one, by a unique index). */
export async function getOpenAgreement(db: Db, clientId: string): Promise<Agreement | null> {
  const { data, error } = await db.from("care_agreements").select(AGREEMENT_COLUMNS).eq("client_id", clientId).neq("status", "cancelled").maybeSingle();
  if (error) throw new RepoError("read the billing schedule");
  return data ? toAgreement(data) : null;
}

/** Every open cycle (any age: money may still be owed), plus every cycle due on or after `sinceDue`. */
export async function listCyclesForPlanning(db: Db, sinceDue: string): Promise<CycleRecord[]> {
  const { data, error } = await db.from("billing_cycles").select(CYCLE_COLUMNS).or(`status.eq.open,due_on.gte.${sinceDue}`).limit(5000);
  if (error) throw new RepoError("read the billing cycles");
  return (data ?? []).map(toCycle);
}

export async function listCyclesForClient(db: Db, clientId: string, limit = 24): Promise<CycleRecord[]> {
  const { data, error } = await db.from("billing_cycles").select(CYCLE_COLUMNS).eq("client_id", clientId).order("due_on", { ascending: false }).limit(limit);
  if (error) throw new RepoError("read the renewals");
  return (data ?? []).map(toCycle);
}

export async function getCycle(db: Db, cycleId: string): Promise<CycleRecord | null> {
  const { data, error } = await db.from("billing_cycles").select(CYCLE_COLUMNS).eq("id", cycleId).maybeSingle();
  if (error) throw new RepoError("read the renewal");
  return data ? toCycle(data) : null;
}

export async function listCyclesByIds(db: Db, ids: string[]): Promise<CycleRecord[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db.from("billing_cycles").select(CYCLE_COLUMNS).in("id", ids);
  if (error) throw new RepoError("read the renewals");
  return (data ?? []).map(toCycle);
}

const ACTION_COLUMNS = "id,cycle_id,client_id,milestone,due_on,action_key,status,work_item_id";
type ActionPick = Pick<Database["public"]["Tables"]["billing_actions"]["Row"], "id" | "cycle_id" | "client_id" | "milestone" | "due_on" | "action_key" | "status" | "work_item_id">;
const toAction = (a: ActionPick, completedWorkItems: ReadonlySet<string>): Action => ({
  id: a.id,
  cycleId: a.cycle_id,
  clientId: a.client_id,
  milestone: a.milestone as Milestone,
  dueOn: a.due_on,
  actionKey: a.action_key,
  status: a.status as Action["status"],
  workItemId: a.work_item_id,
  workItemCompleted: a.work_item_id !== null && completedWorkItems.has(a.work_item_id),
});

/** Actions, with whether each linked task was completed (for example on the Work page). */
async function withWorkItems(db: Db, rows: ActionPick[]): Promise<Action[]> {
  const ids = [...new Set(rows.map((r) => r.work_item_id).filter((v): v is string => v !== null))];
  const completed = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("internal_work_items").select("id,status").in("id", ids.slice(i, i + 200));
    if (error) throw new RepoError("read the billing tasks");
    for (const w of data ?? []) if (w.status === "completed") completed.add(w.id);
  }
  return rows.map((r) => toAction(r, completed));
}

export async function listActionsForCycles(db: Db, cycleIds: string[]): Promise<Action[]> {
  const rows: ActionPick[] = [];
  for (let i = 0; i < cycleIds.length; i += 200) {
    const { data, error } = await db.from("billing_actions").select(ACTION_COLUMNS).in("cycle_id", cycleIds.slice(i, i + 200));
    if (error) throw new RepoError("read the billing tasks");
    rows.push(...(data ?? []));
  }
  return withWorkItems(db, rows);
}

/** Open billing actions due on or before `until` (Today shows these until they are resolved). */
export async function listOpenActions(db: Db, until: string, clientId?: string): Promise<Action[]> {
  let q = db.from("billing_actions").select(ACTION_COLUMNS).eq("status", "open").lte("due_on", until);
  if (clientId) q = q.eq("client_id", clientId);
  const { data, error } = await q.order("due_on").limit(500);
  if (error) throw new RepoError("read the billing tasks");
  return withWorkItems(db, data ?? []);
}

export async function getAction(db: Db, actionId: string): Promise<Action | null> {
  const { data, error } = await db.from("billing_actions").select(ACTION_COLUMNS).eq("id", actionId).maybeSingle();
  if (error) throw new RepoError("read the billing task");
  return data ? (await withWorkItems(db, [data]))[0]! : null;
}

/** Verified payments (status paid) for these clients since `sinceIso`. */
export async function listVerifiedPayments(db: Db, clientIds: string[], sinceIso: string): Promise<VerifiedPayment[]> {
  const out: VerifiedPayment[] = [];
  for (let i = 0; i < clientIds.length; i += 200) {
    const { data, error } = await db
      .from("revenue_events")
      .select("id,client_id,amount,paid_at,event_type")
      .eq("status", "paid")
      .in("client_id", clientIds.slice(i, i + 200))
      .gte("paid_at", sinceIso)
      .limit(5000);
    if (error) throw new RepoError("read the payments");
    for (const p of data ?? []) {
      if (!p.client_id || !p.paid_at) continue;
      out.push({ id: p.id, clientId: p.client_id, amountCents: Math.round(Number(p.amount) * 100), paidAt: p.paid_at, eventType: p.event_type });
    }
  }
  return out;
}

export async function jobState(db: Db): Promise<{ exists: boolean; enabled: boolean; lastSuccessAt: string | null; lastRunFailed: boolean }> {
  const { data: job, error } = await db.from("jobs").select("enabled,last_run_at").eq("key", "billing_tasks").maybeSingle();
  if (error) throw new RepoError("read the billing job");
  if (!job) return { exists: false, enabled: false, lastSuccessAt: null, lastRunFailed: false };
  const { data: runs, error: e2 } = await db.from("job_runs").select("status,started_at").eq("job_key", "billing_tasks").neq("status", "running").order("started_at", { ascending: false }).limit(1);
  if (e2) throw new RepoError("read the billing job");
  return { exists: true, enabled: job.enabled, lastSuccessAt: job.last_run_at, lastRunFailed: runs?.[0]?.status === "failed" };
}

// --- writes ---------------------------------------------------------------------------------------------------------

export async function insertAgreement(db: Db, a: Omit<Agreement, "id"> & { updatedBy: string | null }): Promise<string | "conflict"> {
  const { data, error } = await db
    .from("care_agreements")
    .insert({
      client_id: a.clientId,
      plan_name: a.planName,
      monthly_price_cents: a.monthlyPriceCents,
      anniversary_day: a.anniversaryDay,
      starts_on: a.startsOn,
      invoice_sender: a.invoiceSender,
      payment_link_url: a.paymentLinkUrl,
      tasks_from: a.tasksFrom,
      status: a.status,
      source: a.source,
      stripe_subscription_id: a.stripeSubscriptionId,
      ...(a.status === "paused" ? { paused_at: new Date().toISOString() } : {}),
      updated_by: a.updatedBy,
    })
    .select("id")
    .single();
  if (isUnique(error)) return "conflict";
  if (error || !data) throw new RepoError("save the billing schedule");
  return data.id;
}

export async function updateAgreement(db: Db, id: string, patch: Database["public"]["Tables"]["care_agreements"]["Update"], onlyIfStatus?: AgreementStatus): Promise<number> {
  let q = db.from("care_agreements").update(patch).eq("id", id);
  if (onlyIfStatus) q = q.eq("status", onlyIfStatus);
  const { data, error } = await q.select("id");
  if (error) throw new RepoError("save the billing schedule");
  return data?.length ?? 0;
}

export async function insertCycle(db: Db, c: NewCycle): Promise<string | "conflict"> {
  const { data, error } = await db
    .from("billing_cycles")
    .insert({ agreement_id: c.agreementId, client_id: c.clientId, due_on: c.dueOn, amount_cents: c.amountCents, plan_name: c.planName, invoice_sender: c.invoiceSender })
    .select("id")
    .single();
  if (isUnique(error)) return "conflict";
  if (error || !data) throw new RepoError("create a billing cycle");
  return data.id;
}

/** Changes a cycle only while it is still in `onlyIfStatus` (so two writers never both win). Returns rows changed. */
export async function updateCycle(db: Db, id: string, patch: Database["public"]["Tables"]["billing_cycles"]["Update"], onlyIfStatus?: CycleStatus): Promise<number> {
  let q = db.from("billing_cycles").update(patch).eq("id", id);
  if (onlyIfStatus) q = q.eq("status", onlyIfStatus);
  const { data, error } = await q.select("id");
  if (error) throw new RepoError("update the billing cycle");
  return data?.length ?? 0;
}

/** Sets a sent/reminder timestamp only if it is not set yet (a double click records it once). */
export async function stampCycleOnce(db: Db, id: string, column: "invoice_sent_at" | "reminder_sent_at", patch: Database["public"]["Tables"]["billing_cycles"]["Update"]): Promise<number> {
  const { data, error } = await db.from("billing_cycles").update(patch).eq("id", id).is(column, null).select("id");
  if (error) throw new RepoError("update the billing cycle");
  return data?.length ?? 0;
}

export async function insertAction(db: Db, a: NewAction): Promise<string | "conflict"> {
  const { data, error } = await db
    .from("billing_actions")
    .insert({ cycle_id: a.cycleId, client_id: a.clientId, milestone: a.milestone, due_on: a.dueOn, action_key: a.actionKey })
    .select("id")
    .single();
  if (isUnique(error)) return "conflict";
  if (error || !data) throw new RepoError("create a billing task");
  return data.id;
}

export async function closeAction(db: Db, id: string, status: "done" | "resolved" | "cancelled", outcome: string, by: string, at: string): Promise<number> {
  const { data, error } = await db.from("billing_actions").update({ status, outcome, completed_by: by, completed_at: at }).eq("id", id).eq("status", "open").select("id");
  if (error) throw new RepoError("close a billing task");
  return data?.length ?? 0;
}

export async function linkWorkItem(db: Db, actionId: string, workItemId: string): Promise<void> {
  const { error } = await db.from("billing_actions").update({ work_item_id: workItemId }).eq("id", actionId).is("work_item_id", null);
  if (error) throw new RepoError("link a billing task");
}

export async function findWorkItemByKey(db: Db, key: string): Promise<{ id: string; status: string } | null> {
  const { data, error } = await db.from("internal_work_items").select("id,status").eq("source", "internal").eq("source_reference", key).limit(1).maybeSingle();
  if (error) throw new RepoError("read a billing task");
  return data ?? null;
}

export async function insertWorkItem(db: Db, w: { key: string; title: string; description: string; clientId: string; priority: string; dueDate: string }): Promise<string | "conflict"> {
  const { data, error } = await db
    .from("internal_work_items")
    .insert({ title: w.title, description: w.description, client_id: w.clientId, priority: w.priority, due_date: w.dueDate, source: "internal", source_reference: w.key })
    .select("id")
    .single();
  if (isUnique(error)) return "conflict";
  if (error || !data) throw new RepoError("create a billing task");
  return data.id;
}

export async function completeWorkItem(db: Db, id: string, at: string): Promise<void> {
  const { error } = await db.from("internal_work_items").update({ status: "completed", completed_at: at }).eq("id", id).neq("status", "completed");
  if (error) throw new RepoError("complete a billing task");
}
