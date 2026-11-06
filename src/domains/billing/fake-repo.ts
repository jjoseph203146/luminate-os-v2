// TEST HELPER: an in-memory BillingRepo that behaves like the real tables (unique stripe_customer_id, unique
// stripe_invoice_id, conditional updates, the ledger's compare-and-set). Used by the billing and webhook tests only.
import type { BillingRepo, ClientRow, LedgerRow } from "./repo";

export interface FakeClient extends ClientRow {
  stripe_customer_id: string | null;
  archived_at: string | null;
  subscription_price: number;
  billing_anchor_date: string | null;
}

export interface FakeRevenue {
  id: string;
  stripe_invoice_id: string | null;
  client_id: string | null;
  amount: number;
  status: string;
  event_type: string;
  paid_at: string | null;
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

export function fakeClient(over: Partial<FakeClient> = {}): FakeClient {
  return {
    id: nextId("client"),
    business_name: "Acme Bakery",
    contact_name: "Jane",
    email: "jane@acme.test",
    phone: null,
    status: "active",
    lifetime_value: 0,
    on_hold_since: null,
    account_id: "acct-existing",
    stripe_customer_id: "cus_A",
    archived_at: null,
    subscription_price: 0,
    billing_anchor_date: null,
    ...over,
  };
}

export class FakeBillingRepo implements BillingRepo {
  clients: FakeClient[] = [];
  accounts: { id: string; name: string }[] = [];
  revenue: FakeRevenue[] = [];
  contracts = new Map<string, string>();
  ledger = new Map<string, LedgerRow & { type: string; livemode: boolean; error: string | null }>();

  private clientRow(c: FakeClient): ClientRow {
    const { id, business_name, contact_name, email, phone, status, lifetime_value, on_hold_since, account_id } = c;
    return { id, business_name, contact_name, email, phone, status, lifetime_value, on_hold_since, account_id };
  }

  async findClientByCustomer(customerId: string) {
    const c = this.clients.find((x) => x.stripe_customer_id === customerId);
    return c ? this.clientRow(c) : null;
  }
  async getClient(clientId: string) {
    const c = this.clients.find((x) => x.id === clientId);
    return c ? this.clientRow(c) : null;
  }
  async insertClient(fields: Record<string, unknown>) {
    if (fields.stripe_customer_id && this.clients.some((c) => c.stripe_customer_id === fields.stripe_customer_id)) return "conflict" as const;
    const c = fakeClient({ ...(fields as Partial<FakeClient>), account_id: null, lifetime_value: 0, on_hold_since: null });
    this.clients.push(c);
    return { id: c.id };
  }
  private apply(c: FakeClient, patch: Record<string, unknown>) {
    Object.assign(c, patch);
  }
  async updateClient(clientId: string, patch: Record<string, unknown>, onlyIfStatus?: string) {
    const hits = this.clients.filter((c) => c.id === clientId && (onlyIfStatus === undefined || c.status === onlyIfStatus));
    hits.forEach((c) => this.apply(c, patch));
    return hits.length;
  }
  async updateClientsByCustomer(customerId: string, patch: Record<string, unknown>, opts: { onlyIfStatus?: string; onlyIfNotArchived?: boolean } = {}) {
    const hits = this.clients.filter(
      (c) => c.stripe_customer_id === customerId && (opts.onlyIfStatus === undefined || c.status === opts.onlyIfStatus) && (!opts.onlyIfNotArchived || c.archived_at === null),
    );
    hits.forEach((c) => this.apply(c, patch));
    return hits.length;
  }
  async countClientsByCustomer(customerId: string, status: string) {
    return this.clients.filter((c) => c.stripe_customer_id === customerId && c.status === status).length;
  }
  async insertAccount(name: string) {
    const id = nextId("acct");
    this.accounts.push({ id, name });
    return id;
  }
  async linkAccount(clientId: string, accountId: string) {
    const c = this.clients.find((x) => x.id === clientId && x.account_id === null);
    if (!c) return 0;
    c.account_id = accountId;
    return 1;
  }
  async deleteAccount(accountId: string) {
    this.accounts = this.accounts.filter((a) => a.id !== accountId);
  }
  async findRevenueByInvoice(invoiceId: string) {
    const r = this.revenue.find((x) => x.stripe_invoice_id === invoiceId);
    return r ? { id: r.id, status: r.status } : null;
  }
  async insertRevenue(fields: Record<string, unknown>) {
    if (fields.stripe_invoice_id && this.revenue.some((r) => r.stripe_invoice_id === fields.stripe_invoice_id)) return "conflict" as const;
    const row = { id: nextId("rev"), paid_at: null, client_id: null, stripe_invoice_id: null, event_type: "one_time", status: "pending", amount: 0, ...(fields as Partial<FakeRevenue>) } as FakeRevenue;
    this.revenue.push(row);
    return { id: row.id };
  }
  async updateRevenueIfStatus(id: string, fields: Record<string, unknown>, status: string) {
    const r = this.revenue.find((x) => x.id === id && x.status === status);
    if (!r) return 0;
    Object.assign(r, fields);
    return 1;
  }
  async hasFailedRevenue(clientId: string) {
    return this.revenue.some((r) => r.client_id === clientId && r.status === "failed");
  }
  async projectContractStatus(clientId: string) {
    return this.contracts.get(clientId) ?? null;
  }
  async insertLedger(row: { id: string; type: string; livemode: boolean; status: "processing" | "ignored" }) {
    if (this.ledger.has(row.id)) return "conflict" as const;
    this.ledger.set(row.id, { status: row.status, attempts: 1, claimed_at: new Date().toISOString(), type: row.type, livemode: row.livemode, error: null });
    return "inserted" as const;
  }
  async getLedger(id: string) {
    const row = this.ledger.get(id);
    return row ? { status: row.status, attempts: row.attempts, claimed_at: row.claimed_at } : null;
  }
  async reclaimLedger(id: string, from: { status: string; attempts: number }) {
    const row = this.ledger.get(id);
    if (!row || row.status !== from.status || row.attempts !== from.attempts) return false;
    Object.assign(row, { status: "processing", attempts: row.attempts + 1, claimed_at: new Date().toISOString(), error: null });
    return true;
  }
  async finishLedger(id: string, status: "processed" | "failed" | "ignored", error: string | null) {
    const row = this.ledger.get(id);
    if (row) Object.assign(row, { status, error });
  }
}
