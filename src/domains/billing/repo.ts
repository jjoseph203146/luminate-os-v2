// Database access for the Stripe webhook. Called only from service.ts, with the service-role client.
// Writes the same tables the old app's webhook wrote (clients, accounts, revenue_events) plus the event ledger.
// Errors are generic on purpose: they can end up in the ledger and the server log, and must never carry
// customer data.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Db = SupabaseClient<Database>;

export class RepoError extends Error {
  constructor(what: string) {
    super(`Could not ${what}`);
    this.name = "RepoError";
  }
}

export interface ClientRow {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  status: string;
  lifetime_value: number;
  on_hold_since: string | null;
  account_id: string | null;
}

export type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
export type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];
export type RevenueInsert = Database["public"]["Tables"]["revenue_events"]["Insert"];
export type RevenueUpdate = Database["public"]["Tables"]["revenue_events"]["Update"];

export interface LedgerRow {
  status: string;
  attempts: number;
  claimed_at: string;
}

/** Everything the webhook needs from the database. The service is written against this, so tests use a fake. */
export interface BillingRepo {
  findClientByCustomer(customerId: string): Promise<ClientRow | null>;
  getClient(clientId: string): Promise<ClientRow | null>;
  /** "conflict" when another request already created a client for this customer (unique stripe_customer_id). */
  insertClient(fields: ClientInsert): Promise<{ id: string } | "conflict">;
  /** Returns how many rows changed. `onlyIfStatus` makes it a conditional update (lose a race cleanly). */
  updateClient(clientId: string, patch: ClientUpdate, onlyIfStatus?: string): Promise<number>;
  updateClientsByCustomer(customerId: string, patch: ClientUpdate, opts?: { onlyIfStatus?: string; onlyIfNotArchived?: boolean }): Promise<number>;
  countClientsByCustomer(customerId: string, status: string): Promise<number>;
  insertAccount(name: string): Promise<string>;
  /** Links only while the client has no account (account_id IS NULL). Returns rows changed. */
  linkAccount(clientId: string, accountId: string): Promise<number>;
  deleteAccount(accountId: string): Promise<void>;
  findRevenueByInvoice(invoiceId: string): Promise<{ id: string; status: string } | null>;
  /** "conflict" on the unique stripe_invoice_id: a concurrent request recorded this invoice first. */
  insertRevenue(fields: RevenueInsert): Promise<{ id: string } | "conflict">;
  updateRevenueIfStatus(id: string, fields: RevenueUpdate, status: string): Promise<number>;
  hasFailedRevenue(clientId: string): Promise<boolean>;
  /** The client's project contract status; null when there is none (or more than one, as the old code read it). */
  projectContractStatus(clientId: string): Promise<string | null>;

  insertLedger(row: { id: string; type: string; livemode: boolean; status: "processing" | "ignored" }): Promise<"inserted" | "conflict">;
  getLedger(id: string): Promise<LedgerRow | null>;
  /** Takes over a failed or abandoned event: only if it is still in the state that was read (compare-and-set). */
  reclaimLedger(id: string, from: { status: string; attempts: number }): Promise<boolean>;
  finishLedger(id: string, status: "processed" | "failed" | "ignored", error: string | null): Promise<void>;
}

const CLIENT_COLUMNS = "id,business_name,contact_name,email,phone,status,lifetime_value,on_hold_since,account_id";

function toClient(row: Record<string, unknown>): ClientRow {
  return {
    id: row.id as string,
    business_name: row.business_name as string,
    contact_name: row.contact_name as string,
    email: row.email as string,
    phone: (row.phone as string | null) ?? null,
    status: row.status as string,
    lifetime_value: Number(row.lifetime_value ?? 0),
    on_hold_since: (row.on_hold_since as string | null) ?? null,
    account_id: (row.account_id as string | null) ?? null,
  };
}

const isUnique = (error: { code?: string } | null) => error?.code === "23505";

export function createBillingRepo(db: Db): BillingRepo {
  // integration_events is not in the generated types yet (migration 0007); use an untyped handle for it only.
  const ledger = () => (db as unknown as SupabaseClient).from("integration_events");

  return {
    async findClientByCustomer(customerId) {
      const { data, error } = await db.from("clients").select(CLIENT_COLUMNS).eq("stripe_customer_id", customerId).maybeSingle();
      if (error) throw new RepoError("look up the client");
      return data ? toClient(data) : null;
    },
    async getClient(clientId) {
      const { data, error } = await db.from("clients").select(CLIENT_COLUMNS).eq("id", clientId).maybeSingle();
      if (error) throw new RepoError("read the client");
      return data ? toClient(data) : null;
    },
    async insertClient(fields) {
      const { data, error } = await db.from("clients").insert(fields).select("id").single();
      if (isUnique(error)) return "conflict";
      if (error || !data) throw new RepoError("create the client");
      return { id: data.id };
    },
    async updateClient(clientId, patch, onlyIfStatus) {
      let q = db.from("clients").update(patch).eq("id", clientId);
      if (onlyIfStatus !== undefined) q = q.eq("status", onlyIfStatus);
      const { data, error } = await q.select("id");
      if (error) throw new RepoError("update the client");
      return data?.length ?? 0;
    },
    async updateClientsByCustomer(customerId, patch, opts = {}) {
      let q = db.from("clients").update(patch).eq("stripe_customer_id", customerId);
      if (opts.onlyIfStatus !== undefined) q = q.eq("status", opts.onlyIfStatus);
      if (opts.onlyIfNotArchived) q = q.is("archived_at", null);
      const { data, error } = await q.select("id");
      if (error) throw new RepoError("update the client");
      return data?.length ?? 0;
    },
    async countClientsByCustomer(customerId, status) {
      const { data, error } = await db.from("clients").select("id").eq("stripe_customer_id", customerId).eq("status", status);
      if (error) throw new RepoError("look up the client");
      return data?.length ?? 0;
    },
    async insertAccount(name) {
      const { data, error } = await db.from("accounts").insert({ name }).select("id").single();
      if (error || !data) throw new RepoError("create the account");
      return data.id;
    },
    async linkAccount(clientId, accountId) {
      const { data, error } = await db.from("clients").update({ account_id: accountId }).eq("id", clientId).is("account_id", null).select("id");
      if (error) throw new RepoError("link the account");
      return data?.length ?? 0;
    },
    async deleteAccount(accountId) {
      // Best effort, as in the old app: an orphan account is harmless.
      await db.from("accounts").delete().eq("id", accountId);
    },
    async findRevenueByInvoice(invoiceId) {
      const { data, error } = await db.from("revenue_events").select("id,status").eq("stripe_invoice_id", invoiceId).limit(1);
      if (error) throw new RepoError("read the payment");
      const row = data?.[0];
      return row ? { id: row.id, status: row.status } : null;
    },
    async insertRevenue(fields) {
      const { data, error } = await db.from("revenue_events").insert(fields).select("id");
      if (isUnique(error)) return "conflict";
      const row = data?.[0];
      if (error || !row) throw new RepoError("record the payment");
      return { id: row.id };
    },
    async updateRevenueIfStatus(id, fields, status) {
      const { data, error } = await db.from("revenue_events").update(fields).eq("id", id).eq("status", status).select("id");
      if (error) throw new RepoError("update the payment");
      return data?.length ?? 0;
    },
    async hasFailedRevenue(clientId) {
      const { data, error } = await db.from("revenue_events").select("id").eq("client_id", clientId).eq("status", "failed").limit(1);
      if (error) throw new RepoError("read the payments");
      return (data?.length ?? 0) > 0;
    },
    async projectContractStatus(clientId) {
      // maybeSingle errors when a client has several projects; the old code then read nothing, so this does too.
      const { data } = await db.from("projects").select("contract_status").eq("client_id", clientId).maybeSingle();
      return data?.contract_status ?? null;
    },

    async insertLedger(row) {
      const { error } = await ledger().insert({ id: row.id, type: row.type, livemode: row.livemode, status: row.status, ...(row.status === "ignored" ? { processed_at: new Date().toISOString() } : {}) });
      if (isUnique(error)) return "conflict";
      if (error) throw new RepoError("record the event");
      return "inserted";
    },
    async getLedger(id) {
      const { data, error } = await ledger().select("status,attempts,claimed_at").eq("id", id).maybeSingle();
      if (error) throw new RepoError("read the event");
      return (data as LedgerRow | null) ?? null;
    },
    async reclaimLedger(id, from) {
      const { data, error } = await ledger()
        .update({ status: "processing", attempts: from.attempts + 1, claimed_at: new Date().toISOString(), error: null })
        .eq("id", id)
        .eq("status", from.status)
        .eq("attempts", from.attempts)
        .select("id");
      if (error) throw new RepoError("claim the event");
      return (data?.length ?? 0) > 0;
    },
    async finishLedger(id, status, errorText) {
      const { error } = await ledger()
        .update({ status, error: errorText ? errorText.slice(0, 300) : null, processed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new RepoError("finish the event");
    },
  };
}

/** The client's Stripe customer id, when this invoice is recorded for this client; null when it is not theirs. */
export async function findClientInvoice(db: Db, clientId: string, invoiceId: string): Promise<{ stripeCustomerId: string | null } | null> {
  const { data: rev, error } = await db.from("revenue_events").select("id").eq("client_id", clientId).eq("stripe_invoice_id", invoiceId).limit(1);
  if (error) throw new RepoError("read the invoice");
  if (!rev || rev.length === 0) return null;
  const { data: client, error: e2 } = await db.from("clients").select("stripe_customer_id").eq("id", clientId).maybeSingle();
  if (e2) throw new RepoError("read the client");
  if (!client) return null;
  return { stripeCustomerId: client.stripe_customer_id };
}

// --- "Sync from Stripe" -----------------------------------------------------------------------------------------

export interface SyncClientRow {
  id: string;
  stripe_customer_id: string;
  status: string;
  on_hold_since: string | null;
}

/** The webhook's repo plus the few reads a full sync needs. Runs with the owner's own (admin-only RLS) client. */
export interface SyncRepo extends BillingRepo {
  /** Every client linked to a Stripe customer, archived ones included (their payments are still real money). */
  listStripeClients(): Promise<SyncClientRow[]>;
  /** The client's paid payments (amount and time). */
  paidRevenue(clientId: string): Promise<{ amount: number; paid_at: string | null }[]>;
  /** The payment row for a Stripe id, with its client (null client = recorded as unassigned). */
  findRevenueOwner(stripeId: string): Promise<{ id: string; status: string; client_id: string | null } | null>;
  /** Gives an unassigned payment to a client; only while it is still unassigned. Returns rows changed. */
  assignRevenue(id: string, clientId: string): Promise<number>;
}

export function createSyncRepo(db: Db): SyncRepo {
  return {
    ...createBillingRepo(db),
    async listStripeClients() {
      const { data, error } = await db.from("clients").select("id,stripe_customer_id,status,on_hold_since").not("stripe_customer_id", "is", null).order("created_at");
      if (error) throw new RepoError("read the clients");
      return (data ?? []).map((r) => ({ id: r.id, stripe_customer_id: r.stripe_customer_id as string, status: r.status, on_hold_since: r.on_hold_since ?? null }));
    },
    async paidRevenue(clientId) {
      const { data, error } = await db.from("revenue_events").select("amount,paid_at").eq("client_id", clientId).eq("status", "paid");
      if (error) throw new RepoError("read the payments");
      return (data ?? []).map((r) => ({ amount: Number(r.amount), paid_at: r.paid_at ?? null }));
    },
    async findRevenueOwner(stripeId) {
      const { data, error } = await db.from("revenue_events").select("id,status,client_id").eq("stripe_invoice_id", stripeId).limit(1);
      if (error) throw new RepoError("read the payment");
      const row = data?.[0];
      return row ? { id: row.id, status: row.status, client_id: row.client_id ?? null } : null;
    },
    async assignRevenue(id, clientId) {
      const { data, error } = await db.from("revenue_events").update({ client_id: clientId }).eq("id", id).is("client_id", null).select("id");
      if (error) throw new RepoError("update the payment");
      return data?.length ?? 0;
    },
  };
}
