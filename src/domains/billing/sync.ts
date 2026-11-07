// "Sync from Stripe": one button that repairs what the webhook may have missed, ported from the old app's two
// buttons (Sync Stripe Customers, then Sync Stripe). The webhook keeps everything current; this is the backfill for
// events that were never delivered (before the webhook existed, or while it was down).
//
// Same behaviour as the old buttons, with these deliberate differences:
// - one button runs both halves (customers first, so the second half sees the clients it just created);
// - an invoice recorded as failed and since paid is flipped to paid (the old sync skipped it, so it stayed failed);
// - a charge the webhook recorded as unassigned (customer was not a client yet) is given to the client;
// - every invoice tagged by its own subscription, as the webhook does (the old sync tagged only the current one);
// - a time budget: on a very slow Stripe it stops and says so, and running it again finishes (nothing is recorded twice);
// - one audit row with the counts (no customer details).
// Read only towards Stripe; writes only the tables the webhook writes, through the owner's own login.
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { readDb } from "@/platform/db/server";
import { writeAudit } from "@/platform/audit/audit";
import { RateLimitError, RuleError } from "@/platform/errors";
import { createRateLimiter } from "@/platform/security/rate-limit";
import { getStripeConfig, getStripeInvoiceKey } from "@/platform/env";
import { getStripe } from "@/platform/stripe/client";
import { createStripeSyncReads, type StripeSyncReads } from "@/platform/stripe/sync-api";
import { createSyncRepo, RepoError, type SyncClientRow, type SyncRepo } from "./repo";
import {
  accountNameFor,
  backfillPatch,
  currentSchedulePhase,
  isLiveSubscription,
  lifetimeValueOf,
  newClientFields,
  paidSinceHold,
  phasePriceRef,
  phaseStartDate,
  pickSyncSubscription,
  shouldRecordCharge,
  subscriptionFields,
  syncedInvoiceRevenue,
  type CustomerLike,
  type SyncSummary,
} from "./rules";

type Owner = Extract<Actor, { type: "owner" }>;

/** Stop starting new clients after this long, so the request finishes inside the page's 60-second limit. */
export const SYNC_BUDGET_MS = 45_000;
/** Clients checked at the same time (Stripe allows far more; this keeps the run short without hammering it). */
const CONCURRENCY = 4;

/** A sync reads every customer: twice a minute is plenty, and a double click must not run two at once. */
const syncLimiter = createRateLimiter({ max: 2, windowMs: 60_000 });

export interface SyncDeps {
  repo: SyncRepo;
  stripe: StripeSyncReads;
  now: () => Date;
  /** Milliseconds clock for the time budget. */
  clock: () => number;
}

function emptySummary(): SyncSummary {
  return { customersRead: 0, clientsCreated: 0, clientsUpdated: 0, accountsLinked: 0, clientsChecked: 0, clientsTotal: 0, paymentsRecorded: 0, statusChanges: 0, problems: 0, stoppedForTime: false };
}

/** Logs a failed step without customer data: the step name and the error's kind only. */
function logProblem(step: string, e: unknown) {
  const kind = e instanceof RepoError ? e.message : (e as { type?: string })?.type ?? (e as { name?: string })?.name ?? "error";
  console.warn("stripe sync: step failed", { step, kind });
}

/** Every client needs an accounts parent (same as the webhook). Returns true when it linked one. */
async function ensureAccount(repo: SyncRepo, clientId: string, name: string): Promise<boolean> {
  const client = await repo.getClient(clientId);
  if (!client || client.account_id) return false;
  const accountId = await repo.insertAccount(name);
  const linked = await repo.linkAccount(clientId, accountId);
  if (linked === 0) {
    await repo.deleteAccount(accountId);
    return false;
  }
  return true;
}

/** Part 1 (the old Sync Stripe Customers): a client for every Stripe customer; fill placeholders, never overwrite. */
async function syncCustomer(d: SyncDeps, customer: CustomerLike, s: SyncSummary): Promise<void> {
  const existing = await d.repo.findClientByCustomer(customer.id);
  if (existing) {
    const patch = backfillPatch(existing, customer);
    if (Object.keys(patch).length > 0) {
      await d.repo.updateClient(existing.id, patch);
      s.clientsUpdated++;
    }
    // Clients created before accounts existed have none; a sync repairs them.
    if (!existing.account_id && (await ensureAccount(d.repo, existing.id, patch.business_name ?? existing.business_name))) s.accountsLinked++;
    return;
  }
  const inserted = await d.repo.insertClient(newClientFields(customer));
  // The webhook created this customer's client a moment ago: nothing left to do.
  if (inserted === "conflict") return;
  s.clientsCreated++;
  if (await ensureAccount(d.repo, inserted.id, accountNameFor(customer))) s.accountsLinked++;
}

/** Price and billing date from the live subscription, or from a schedule that has not started yet. */
async function syncSubscription(d: SyncDeps, client: SyncClientRow, s: SyncSummary): Promise<void> {
  const sub = pickSyncSubscription(await d.stripe.listSubscriptions(client.stripe_customer_id));
  if (sub) {
    // Repairs a client left 'paused' by an old subscription being deleted while a newer one was live.
    if (client.status === "paused" && isLiveSubscription(sub)) {
      if ((await d.repo.updateClient(client.id, { status: "active" }, "paused")) > 0) {
        client.status = "active";
        s.statusChanges++;
      }
    }
    const fields = subscriptionFields(sub, d.now());
    if (Object.keys(fields).length > 0) await d.repo.updateClient(client.id, fields);
    return;
  }
  // A subscription with a future start date is only a SubscriptionSchedule until its first phase begins.
  const schedules = await d.stripe.listSchedules(client.stripe_customer_id);
  const phase = schedules.map((sch) => currentSchedulePhase(sch, d.now())).find((p) => p !== null) ?? null;
  if (!phase) return;
  const ref = phasePriceRef(phase);
  let amount: number | null = null;
  if (ref && "amount" in ref) amount = ref.amount;
  else if (ref && "priceId" in ref) amount = await d.stripe.retrievePriceAmount(ref.priceId);
  const fields: { subscription_price?: number; billing_anchor_date?: string } = {};
  if (amount !== null) fields.subscription_price = amount / 100;
  const start = phaseStartDate(phase);
  if (start) fields.billing_anchor_date = start;
  if (Object.keys(fields).length > 0) await d.repo.updateClient(client.id, fields);
}

/** Paid invoices the webhook never recorded. Returns the payment intents that paid them. */
async function syncInvoices(d: SyncDeps, client: SyncClientRow, s: SyncSummary, state: { flippedFailed: boolean }): Promise<Set<string>> {
  const intents = new Set<string>();
  for (const invoice of await d.stripe.listPaidInvoices(client.stripe_customer_id)) {
    invoice.paymentIntentIds.forEach((id) => intents.add(id));
    if ((invoice.amount_paid ?? 0) <= 0) continue;
    const fields = syncedInvoiceRevenue(invoice, client.id);
    const existing = await d.repo.findRevenueByInvoice(invoice.id);
    if (existing?.status === "failed") {
      // Stripe says paid; our row still says failed (the paid event was missed).
      if ((await d.repo.updateRevenueIfStatus(existing.id, fields, "failed")) > 0) {
        s.paymentsRecorded++;
        state.flippedFailed = true;
      }
      continue;
    }
    if (existing) continue;
    // "conflict": the webhook recorded it a moment ago.
    if ((await d.repo.insertRevenue(fields)) !== "conflict") s.paymentsRecorded++;
  }
  return intents;
}

/** Standalone charges (no invoice) the webhook never recorded. */
async function syncCharges(d: SyncDeps, client: SyncClientRow, s: SyncSummary, invoiceIntents: Set<string>): Promise<void> {
  const charges = await d.stripe.listCharges(client.stripe_customer_id);
  const recorded = await d.repo.paidRevenue(client.id);
  for (const charge of charges) {
    const existing = await d.repo.findRevenueOwner(charge.id);
    if (existing) {
      // Recorded by the webhook as unassigned (the customer was not a client yet): it is this client's money.
      if (existing.client_id === null && existing.status === "paid" && (await d.repo.assignRevenue(existing.id, client.id)) > 0) s.paymentsRecorded++;
      continue;
    }
    if (!shouldRecordCharge(charge, invoiceIntents, recorded)) continue;
    const fields = {
      stripe_invoice_id: charge.id,
      client_id: client.id,
      amount: charge.amount / 100,
      status: "paid" as const,
      event_type: "one_time",
      paid_at: new Date(charge.created * 1000).toISOString(),
    };
    if ((await d.repo.insertRevenue(fields)) !== "conflict") {
      s.paymentsRecorded++;
      recorded.push({ amount: fields.amount, paid_at: fields.paid_at });
    }
  }
}

/** Lifetime value from the payments on record, onboarding to active, hold lifted, stale past_due cleared. */
async function syncClientState(d: SyncDeps, client: SyncClientRow, s: SyncSummary, flippedFailed: boolean): Promise<void> {
  const paid = await d.repo.paidRevenue(client.id);
  const current = await d.repo.getClient(client.id);
  if (!current) return;
  const patch: { lifetime_value?: number; on_hold_since?: null } = {};
  const total = lifetimeValueOf(paid);
  if (Math.abs(total - current.lifetime_value) >= 0.005) patch.lifetime_value = total;
  // A payment made after the client was put on hold lifts the hold, as the webhook does live.
  if (paidSinceHold(current.on_hold_since, paid)) patch.on_hold_since = null;
  if (Object.keys(patch).length > 0) await d.repo.updateClient(client.id, patch);
  if (patch.on_hold_since === null) s.statusChanges++;

  // The same onboarding -> active gate as the webhook: contract signed (or exempt) and a payment on file.
  if (current.status === "onboarding" && paid.length > 0) {
    const contract = await d.repo.projectContractStatus(client.id);
    if ((contract === "signed" || contract === "exempt") && (await d.repo.updateClient(client.id, { status: "active" }, "onboarding")) > 0) s.statusChanges++;
  }
  // past_due comes only from a failed payment: when the sync just turned the last failed one into paid, clear it.
  if (flippedFailed && current.status === "past_due" && !(await d.repo.hasFailedRevenue(client.id))) {
    if ((await d.repo.updateClient(client.id, { status: "active" }, "past_due")) > 0) s.statusChanges++;
  }
}

/** How far back payments without a customer are looked for. */
export const CUSTOMERLESS_LOOKBACK_DAYS = 400;

/** Successful charges with no customer and not recorded yet: one unassigned paid row each (never twice). */
async function syncCustomerlessCharges(d: SyncDeps, s: SyncSummary): Promise<void> {
  const since = Math.floor(d.now().getTime() / 1000) - CUSTOMERLESS_LOOKBACK_DAYS * 86_400;
  for (const charge of await d.stripe.listCustomerlessCharges(since)) {
    if (charge.status !== "succeeded" || charge.amount <= 0) continue;
    if (await d.repo.findRevenueOwner(charge.id)) continue;
    const inserted = await d.repo.insertRevenue({
      stripe_invoice_id: charge.id,
      client_id: null,
      amount: charge.amount / 100,
      status: "paid",
      event_type: "one_time",
      paid_at: new Date(charge.created * 1000).toISOString(),
    });
    // "conflict": the webhook recorded it a moment ago.
    if (inserted !== "conflict") s.paymentsRecorded++;
  }
}

/** Part 2 (the old Sync Stripe) for one client. Each step stands alone: one failing does not stop the others. */
async function syncClient(d: SyncDeps, client: SyncClientRow, s: SyncSummary): Promise<void> {
  const step = async (name: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (e) {
      s.problems++;
      logProblem(name, e);
    }
  };
  const state = { flippedFailed: false };
  let intents: Set<string> | null = null;
  await step("subscription", () => syncSubscription(d, client, s));
  await step("invoices", async () => {
    intents = await syncInvoices(d, client, s, state);
  });
  // Without the invoice list, an invoice's charge cannot be told from a standalone one: skip charges this time.
  if (intents) await step("charges", () => syncCharges(d, client, s, intents as Set<string>));
  await step("client", () => syncClientState(d, client, s, state.flippedFailed));
  s.clientsChecked++;
}

function defaultDeps(actor: Owner): Promise<SyncDeps> | null {
  const config = getStripeConfig();
  if (!config) return null;
  return readDb(actor).then((db) => ({
    repo: createSyncRepo(db),
    stripe: createStripeSyncReads(getStripe(config.secretKey)),
    now: () => new Date(),
    clock: Date.now,
  }));
}

/** Yes/no for the Stripe settings page. Never a key's value. */
export function getStripeSetup(actor: Owner): { readKey: boolean; webhookSecret: boolean; invoiceKey: boolean } {
  assertCan(actor, "billing.sync");
  const config = getStripeConfig();
  return { readKey: config !== null, webhookSecret: Boolean(config?.webhookSecret), invoiceKey: getStripeInvoiceKey() !== null };
}

/** "Sync from Stripe". Owner only. Returns the counts; never Stripe's or the database's own error text. */
export async function syncFromStripe(actor: Owner, deps?: SyncDeps): Promise<SyncSummary> {
  assertCan(actor, "billing.sync");
  const clock = deps?.clock ?? Date.now;
  if (!syncLimiter.check(actor.userId, clock())) throw new RateLimitError("A sync just ran. Wait a minute and try again.");
  const d = deps ?? (await defaultDeps(actor));
  if (!d) throw new RuleError("Stripe is not set up yet. Add STRIPE_SECRET_KEY in Vercel and redeploy.");

  const startedAt = d.clock();
  const s = emptySummary();

  let customers: CustomerLike[];
  try {
    customers = await d.stripe.listCustomers();
  } catch (e) {
    logProblem("customers", e);
    throw new RuleError("Stripe did not return the customer list. Check that STRIPE_SECRET_KEY can read customers, then try again.");
  }
  s.customersRead = customers.length;
  for (const customer of customers) {
    try {
      await syncCustomer(d, customer, s);
    } catch (e) {
      s.problems++;
      logProblem("customer", e);
    }
  }

  // Payments with no Stripe customer (Payment Links): recorded as unassigned, as the webhook does, so the money is
  // not missing from Collected. The webhook only started recording these on 2026-11-06.
  try {
    await syncCustomerlessCharges(d, s);
  } catch (e) {
    s.problems++;
    logProblem("unassigned payments", e);
  }

  const clients = await d.repo.listStripeClients();
  s.clientsTotal = clients.length;
  let next = 0;
  const worker = async () => {
    while (next < clients.length) {
      if (d.clock() - startedAt > SYNC_BUDGET_MS) {
        s.stoppedForTime = true;
        return;
      }
      const client = clients[next++] as SyncClientRow;
      await syncClient(d, client, s);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, clients.length) }, worker));

  // The sync has already changed the data: a failed audit write must not report the sync itself as failed.
  try {
    await writeAudit(actor, { action: "stripe.synced", entityType: "integration", entityId: "stripe", after: { ...s } });
  } catch {
    /* already logged by writeAudit */
  }
  return s;
}
