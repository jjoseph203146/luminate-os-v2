// Renewals domain: SOP billing tasks (docs/architecture/17-billing-tasks.md). The billing job creates and closes tasks;
// the owner sets each client's billing schedule and records what was sent or paid. Nothing here sends an invoice,
// a reminder or an email, and nothing here writes to Stripe.
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { addCalendarDays, toLocalDate } from "@/platform/calendar/business-days";
import { readDb } from "@/platform/db/server";
import { writeAudit } from "@/platform/audit/audit";
import { parseInput } from "@/platform/auth/schemas";
import { RuleError } from "@/platform/errors";
import { getStripeConfig } from "@/platform/env";
import { getStripe } from "@/platform/stripe/client";
import { createStripeMoneyReads, type StripeMoneyReads } from "@/platform/stripe/money-api";
import * as repo from "./repo";
import type { ClientBasics, CycleRecord } from "./repo";
import {
  anniversaryDayOf,
  BILLING_TIME_ZONE,
  billingHealth,
  cyclesToCreate,
  formatCents,
  invoiceHref,
  LOOKBACK_DAYS,
  milestoneDef,
  planCycles,
  renewalOnOrAfter,
  shortDay,
  syncSchedulesFromStripe,
  taskTitle,
} from "./rules";
import { actionSchema, agreementSchema, agreementStatusSchema, clientOnlySchema, cycleSchema, manualPaymentSchema, markSentSchema } from "./schemas";
import type { Action, Agreement, BillingTask, BillingToday, ClientBilling, PlannerAgreement } from "./types";

type Owner = Extract<Actor, { type: "owner" }>;
type Db = Awaited<ReturnType<typeof readDb>>;

const todayIn = (now: Date) => toLocalDate(now, BILLING_TIME_ZONE);
const byOf = (actor: Actor) => (actor.type === "owner" ? `owner:${actor.userId}` : `${actor.type}:${actor.name}`);

/** Audit writes must not undo a change that is already saved (the change is the record; the audit row adds who/when). */
async function audit(actor: Actor, entry: Parameters<typeof writeAudit>[1]): Promise<void> {
  try {
    await writeAudit(actor, entry);
  } catch {
    /* already logged by writeAudit */
  }
}

function toPlanner(agreements: Agreement[], clients: ClientBasics[]): PlannerAgreement[] {
  const byId = new Map(clients.map((c) => [c.id, c]));
  return agreements.map((a) => {
    const c = byId.get(a.clientId);
    // A client that cannot be read is treated as archived: no new billing work for it.
    return { ...a, clientArchived: !c || c.archived, clientPaused: c?.status === "paused" };
  });
}

// --- the billing job ------------------------------------------------------------------------------------------------

export interface BillingRunSummary {
  today: string;
  schedulesCreated: number;
  schedulesUpdated: number;
  schedulesCancelled: number;
  cyclesCreated: number;
  paid: number;
  tasksCreated: number;
  tasksClosed: number;
  cyclesCancelled: number;
  workItemsRepaired: number;
}

/**
 * The scheduled billing pass (hourly; each step is idempotent). Creates the cycles and milestone tasks that are due by
 * today in New York, settles cycles from verified payments, closes tasks that no longer apply, and repairs task links
 * left half-done by an interrupted run. A failing step does not stop the others; the run then fails as a whole, so it
 * is shown in Automations and retried, and nothing is skipped silently.
 */
export interface BillingJobDeps {
  db?: Db;
  /** Stripe reads (read-only key); null when Stripe is not set up. */
  stripe?: StripeMoneyReads | null;
}

function defaultStripe(): StripeMoneyReads | null {
  const config = getStripeConfig();
  return config ? createStripeMoneyReads(getStripe(config.secretKey)) : null;
}

export async function runBillingTasks(actor: Actor, now: Date, deps: BillingJobDeps = {}): Promise<BillingRunSummary> {
  assertCan(actor, "billing.schedule");
  const db = deps.db ?? (await readDb(actor));
  const stripe = "stripe" in deps ? (deps.stripe ?? null) : defaultStripe();
  const today = todayIn(now);
  const at = now.toISOString();
  const by = byOf(actor);
  const failures: string[] = [];
  const step = async (what: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (e) {
      failures.push(what);
      console.warn("billing job: step failed", { what, kind: (e as { name?: string })?.name ?? "error" });
    }
  };
  const summary: BillingRunSummary = { today, schedulesCreated: 0, schedulesUpdated: 0, schedulesCancelled: 0, cyclesCreated: 0, paid: 0, tasksCreated: 0, tasksClosed: 0, cyclesCancelled: 0, workItemsRepaired: 0 };

  // 0. Schedules follow each client's Stripe subscription: price, renewal day, start, sender, paused or ended.
  //    If Stripe cannot be read, the run fails visibly but the existing schedules still get their tasks below.
  if (stripe) {
    await step("read Stripe subscriptions", async () => {
      const subs = await stripe.listSubscriptions();
      const allClients = await repo.listClients(db);
      const planOf = new Map(allClients.map((c) => [c.id, c.planName]));
      const sync = syncSchedulesFromStripe(subs, allClients, await repo.listAgreements(db));
      for (const want of sync.create) {
        await step("create a schedule", async () => {
          const created = await repo.insertAgreement(db, { ...want, planName: planOf.get(want.clientId) ?? null, paymentLinkUrl: null, tasksFrom: today, source: "stripe", updatedBy: null });
          if (created !== "conflict") summary.schedulesCreated++;
        });
      }
      for (const u of sync.update) {
        await step("update a schedule", async () => {
          const p = u.patch;
          const changed = await repo.updateAgreement(db, u.agreementId, {
            ...(p.stripeSubscriptionId !== undefined ? { stripe_subscription_id: p.stripeSubscriptionId } : {}),
            ...(p.monthlyPriceCents !== undefined ? { monthly_price_cents: p.monthlyPriceCents } : {}),
            ...(p.anniversaryDay !== undefined ? { anniversary_day: p.anniversaryDay } : {}),
            ...(p.startsOn !== undefined ? { starts_on: p.startsOn } : {}),
            ...(p.invoiceSender !== undefined ? { invoice_sender: p.invoiceSender } : {}),
            ...(p.status === "paused" ? { status: "paused", paused_at: at } : {}),
            // Resumed in Stripe: tasks restart from today, so renewals missed while paused do not suddenly appear.
            ...(u.resumed ? { status: "active", paused_at: null, tasks_from: today } : {}),
          });
          if (changed > 0) summary.schedulesUpdated++;
        });
      }
      for (const id of sync.cancel) {
        await step("cancel a schedule", async () => {
          if ((await repo.updateAgreement(db, id, { status: "cancelled", cancelled_at: at })) > 0) summary.schedulesCancelled++;
        });
      }
    });
  }

  const agreementRows = await repo.listAgreements(db);
  const clients = await repo.listClients(db, [...new Set(agreementRows.map((a) => a.clientId))]);
  const agreements = toPlanner(agreementRows, clients);
  const sinceDue = addCalendarDays(today, -(LOOKBACK_DAYS + 31));

  // 1. Cycles that are due by today.
  for (const c of cyclesToCreate(today, agreements, await repo.listCyclesForPlanning(db, sinceDue))) {
    await step("create a cycle", async () => {
      if ((await repo.insertCycle(db, c)) !== "conflict") summary.cyclesCreated++;
    });
  }

  // 2. Settle, close and create, from the current state.
  const cycles = await repo.listCyclesForPlanning(db, sinceDue);
  const actions = await repo.listActionsForCycles(db, cycles.map((c) => c.id));
  const oldestOpen = cycles.filter((c) => c.status === "open").reduce((min, c) => (c.dueOn < min ? c.dueOn : min), sinceDue);
  const payments = await repo.listVerifiedPayments(db, [...new Set(cycles.map((c) => c.clientId))], new Date(`${addCalendarDays(oldestOpen, -10)}T00:00:00Z`).toISOString());
  const plan = planCycles(today, agreements, cycles, actions, payments);

  for (const p of plan.pay) {
    await step("settle a cycle", async () => {
      if ((await repo.updateCycle(db, p.cycleId, { status: "paid", paid_at: p.paidAt, payment_ref: p.paymentId }, "open")) > 0) summary.paid++;
    });
  }
  for (const c of plan.cancelCycles) {
    await step("cancel a cycle", async () => {
      if ((await repo.updateCycle(db, c.cycleId, { status: "cancelled", cancelled_reason: c.reason }, "open")) > 0) summary.cyclesCancelled++;
    });
  }
  for (const c of plan.closeActions) {
    await step("close a task", async () => {
      if ((await repo.closeAction(db, c.actionId, c.status, c.outcome, by, at)) > 0) summary.tasksClosed++;
    });
  }
  for (const a of plan.newActions) {
    await step("create a task", async () => {
      if ((await repo.insertAction(db, a)) !== "conflict") summary.tasksCreated++;
    });
  }

  // 3. Every open action has its task on Today and Work; every closed one has its task completed.
  await step("link tasks", async () => {
    const cyclesById = new Map(cycles.map((c) => [c.id, c]));
    const fresh = await repo.listActionsForCycles(db, cycles.map((c) => c.id));
    for (const a of fresh) {
      if (a.status === "open" && !a.workItemId) {
        const cycle = cyclesById.get(a.cycleId);
        if (!cycle) continue;
        await step("create a task", async () => {
          await ensureWorkItem(db, a, cycle);
          summary.workItemsRepaired++;
        });
      } else if (a.status !== "open" && a.workItemId && !a.workItemCompleted) {
        await step("complete a task", async () => {
          await repo.completeWorkItem(db, a.workItemId as string, at);
        });
      }
    }
  });

  if (failures.length > 0) {
    // Counts only: the error is stored on the job run and must not carry client data.
    throw new Error(`Billing job: ${failures.length} step(s) failed (${[...new Set(failures)].join(", ")}). It will retry.`);
  }
  return summary;
}

/** Finds the action's task by its billing key, or creates it, and links it. Safe to repeat. */
async function ensureWorkItem(db: Db, action: Action, cycle: CycleRecord): Promise<void> {
  const def = milestoneDef(action.milestone);
  let workItemId = (await repo.findWorkItemByKey(db, action.actionKey))?.id ?? null;
  if (!workItemId) {
    const inserted = await repo.insertWorkItem(db, {
      key: action.actionKey,
      title: taskTitle(action.milestone, cycle.amountCents, cycle.dueOn),
      description: `Billing task (SOP). Renewal ${shortDay(cycle.dueOn)}, ${formatCents(cycle.amountCents)}. Nothing is sent automatically: send it yourself, then mark it on Today or in the client's Billing tab.`,
      clientId: action.clientId,
      priority: def.priority,
      dueDate: action.dueOn,
    });
    workItemId = inserted === "conflict" ? ((await repo.findWorkItemByKey(db, action.actionKey))?.id ?? null) : inserted;
  }
  if (!workItemId) throw new repo.RepoError("create a billing task");
  await repo.linkWorkItem(db, action.id, workItemId);
}

// --- screens --------------------------------------------------------------------------------------------------------

function toTask(a: Action, cycle: CycleRecord, agreement: Agreement | undefined, client: ClientBasics | undefined, today: string): BillingTask {
  const def = milestoneDef(a.milestone);
  return {
    actionId: a.id,
    cycleId: cycle.id,
    clientId: a.clientId,
    clientName: client?.name ?? "Client",
    milestone: a.milestone,
    title: def.title,
    dueOn: a.dueOn,
    cycleDueOn: cycle.dueOn,
    amountCents: cycle.amountCents,
    priority: def.priority,
    overdue: a.dueOn < today,
    invoiceSender: cycle.invoiceSender,
    invoiceSentAt: cycle.invoiceSentAt,
    reminderSentAt: cycle.reminderSentAt,
    invoiceHref: invoiceHref(cycle.invoiceUrl, agreement?.paymentLinkUrl ?? null, client?.stripeCustomerId ?? null),
  };
}

const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2 } as const;
const sortTasks = (tasks: BillingTask[]) =>
  tasks.sort((p, q) => PRIORITY_ORDER[p.priority] - PRIORITY_ORDER[q.priority] || p.dueOn.localeCompare(q.dueOn) || p.clientName.localeCompare(q.clientName));

async function buildTasks(db: Db, actions: Action[], today: string): Promise<BillingTask[]> {
  const cycles = await repo.listCyclesByIds(db, [...new Set(actions.map((a) => a.cycleId))]);
  const cyclesById = new Map(cycles.map((c) => [c.id, c]));
  const agreements = new Map((await repo.listAgreements(db)).map((a) => [a.id, a]));
  const clients = new Map((await repo.listClients(db, [...new Set(actions.map((a) => a.clientId))])).map((c) => [c.id, c]));
  return sortTasks(
    actions.flatMap((a) => {
      const cycle = cyclesById.get(a.cycleId);
      return cycle ? [toTask(a, cycle, agreements.get(cycle.agreementId), clients.get(a.clientId), today)] : [];
    }),
  );
}

/** The Billing group on Today: open billing tasks due by today (overdue ones stay until resolved), and the job's health. */
export async function getBillingToday(actor: Actor, now: Date = new Date()): Promise<BillingToday & { available: boolean }> {
  assertCan(actor, "billing.tasks");
  const db = await readDb(actor);
  const today = todayIn(now);
  try {
    const [actions, agreements, clients, job] = await Promise.all([repo.listOpenActions(db, today), repo.listAgreements(db), repo.listClients(db), repo.jobState(db)]);
    const scheduled = new Set(agreements.filter((a) => a.status !== "cancelled").map((a) => a.clientId));
    const missingSchedules = clients
      .filter((c) => !c.archived && c.status !== "paused" && c.subscriptionPrice > 0 && !scheduled.has(c.id))
      .map((c) => ({ clientId: c.id, clientName: c.name }))
      .sort((p, q) => p.clientName.localeCompare(q.clientName));
    return { available: true, tasks: await buildTasks(db, actions, today), missingSchedules, health: billingHealth(job, now) };
  } catch (e) {
    // Most likely migration 0009 is not applied yet. Say so on Today; never pretend there is nothing to do.
    console.warn("billing today: unavailable", { kind: (e as { name?: string })?.name ?? "error" });
    return { available: false, tasks: [], missingSchedules: [], health: { state: "not_set_up", lastSuccessAt: null } };
  }
}

/** The client Billing tab: schedule, renewals and open billing tasks. */
export async function getClientBilling(actor: Actor, clientId: string, now: Date = new Date()): Promise<ClientBilling> {
  assertCan(actor, "billing.tasks");
  const db = await readDb(actor);
  const today = todayIn(now);
  const client = await repo.getClient(db, clientId);
  const suggestion = {
    planName: client?.planName ?? null,
    monthlyPriceCents: Math.round((client?.subscriptionPrice ?? 0) * 100),
    anniversaryDay: anniversaryDayOf(client?.billingAnchorDate ?? null),
    startsOn: client?.clientSince ?? null,
  };
  try {
    const [agreement, cycles, actions] = await Promise.all([repo.getOpenAgreement(db, clientId), repo.listCyclesForClient(db, clientId), repo.listOpenActions(db, addCalendarDays(today, 60), clientId)]);
    return {
      available: true,
      agreement,
      suggestion,
      cycles,
      tasks: await buildTasks(db, actions, today),
      nextRenewal: agreement && agreement.status === "active" ? renewalOnOrAfter(today > agreement.startsOn ? today : agreement.startsOn, agreement.anniversaryDay) : null,
      hasStripeCustomer: Boolean(client?.stripeCustomerId),
    };
  } catch (e) {
    console.warn("client billing: unavailable", { kind: (e as { name?: string })?.name ?? "error" });
    return { available: false, agreement: null, suggestion, cycles: [], tasks: [], nextRenewal: null, hasStripeCustomer: Boolean(client?.stripeCustomerId) };
  }
}

// --- owner actions --------------------------------------------------------------------------------------------------

/** Sets up or edits the client's billing schedule. Edits apply to renewals not created yet; past ones keep their amounts. */
export async function saveAgreement(actor: Owner, raw: unknown, now: Date = new Date()): Promise<{ message: string }> {
  assertCan(actor, "billing.tasks");
  const input = parseInput(agreementSchema, raw);
  const db = await readDb(actor);
  const client = await repo.getClient(db, input.clientId);
  if (!client) throw new RuleError("That client could not be found.");
  if (client.archived) throw new RuleError("This client is archived. Restore the client before setting up billing.");
  const fields = {
    planName: input.planName,
    monthlyPriceCents: input.monthlyPrice as number,
    anniversaryDay: input.anniversaryDay,
    startsOn: input.startsOn,
    invoiceSender: input.invoiceSender,
    paymentLinkUrl: input.paymentLinkUrl,
  };
  const existing = await repo.getOpenAgreement(db, input.clientId);
  if (!existing) {
    const id = await repo.insertAgreement(db, { clientId: input.clientId, ...fields, status: "active", tasksFrom: todayIn(now), source: "manual", stripeSubscriptionId: null, updatedBy: actor.userId });
    if (id === "conflict") throw new RuleError("A billing schedule was just saved for this client. Reload the page.");
    await audit(actor, { action: "billing_schedule.created", entityType: "care_agreement", entityId: id, clientId: input.clientId, after: { ...fields, source: "manual" } });
    return { message: "Billing schedule saved. Billing tasks start with the next renewal." };
  }
  const before = { planName: existing.planName, monthlyPriceCents: existing.monthlyPriceCents, anniversaryDay: existing.anniversaryDay, startsOn: existing.startsOn, invoiceSender: existing.invoiceSender, paymentLinkUrl: existing.paymentLinkUrl };
  if (JSON.stringify(before) === JSON.stringify(fields) && existing.source === "manual") return { message: "No changes to save." };
  // Saving the form takes the schedule over by hand: from now on the billing job no longer changes it from Stripe.
  await repo.updateAgreement(db, existing.id, {
    source: "manual",
    plan_name: fields.planName,
    monthly_price_cents: fields.monthlyPriceCents,
    anniversary_day: fields.anniversaryDay,
    starts_on: fields.startsOn,
    invoice_sender: fields.invoiceSender,
    payment_link_url: fields.paymentLinkUrl,
    updated_by: actor.userId,
  });
  await audit(actor, { action: "billing_schedule.updated", entityType: "care_agreement", entityId: existing.id, clientId: input.clientId, before: { ...before, source: existing.source }, after: { ...fields, source: "manual" } });
  return { message: existing.source === "stripe" ? "Saved. This schedule is now managed by hand and no longer follows Stripe." : "Billing schedule saved. Renewals already created keep their amount and date." };
}

/** Hands a schedule back to Stripe: the billing job brings it in step with the client's subscription within the hour. */
export async function followStripe(actor: Owner, raw: unknown): Promise<{ message: string }> {
  assertCan(actor, "billing.tasks");
  const input = parseInput(clientOnlySchema, raw);
  const db = await readDb(actor);
  const client = await repo.getClient(db, input.clientId);
  if (!client) throw new RuleError("That client could not be found.");
  if (!client.stripeCustomerId) throw new RuleError("This client has no Stripe customer, so there is no subscription to follow.");
  const existing = await repo.getOpenAgreement(db, input.clientId);
  if (!existing) return { message: "Billing follows Stripe: the schedule is created from the subscription within the hour." };
  if (existing.source === "stripe") return { message: "This schedule already follows Stripe." };
  await repo.updateAgreement(db, existing.id, { source: "stripe", updated_by: actor.userId });
  await audit(actor, { action: "billing_schedule.follows_stripe", entityType: "care_agreement", entityId: existing.id, clientId: input.clientId, before: { source: "manual" } });
  return { message: "This schedule follows Stripe again. It is updated from the subscription within the hour (and cancelled if there is none)." };
}

/** Closes the client's open billing tasks right away (the job would within the hour). */
async function closeClientTasks(db: Db, clientId: string, outcome: string, by: string, at: string): Promise<void> {
  for (const a of await repo.listOpenActions(db, "9999-12-31", clientId)) {
    if ((await repo.closeAction(db, a.id, "cancelled", outcome, by, at)) > 0 && a.workItemId) await repo.completeWorkItem(db, a.workItemId, at);
  }
}

/** Pause, resume or cancel the schedule. Pausing or cancelling stops billing tasks; nothing is ever deleted. */
export async function changeAgreementStatus(actor: Owner, raw: unknown, now: Date = new Date()): Promise<{ message: string }> {
  assertCan(actor, "billing.tasks");
  const input = parseInput(agreementStatusSchema, raw);
  const db = await readDb(actor);
  const agreement = await repo.getOpenAgreement(db, input.clientId);
  if (!agreement) throw new RuleError("This client has no billing schedule.");
  if (agreement.source === "stripe") {
    throw new RuleError("This schedule follows the Stripe subscription. Pause or cancel the subscription in Stripe (the tasks follow within the hour), or manage the schedule by hand first.");
  }
  const at = now.toISOString();
  const by = byOf(actor);
  if (input.change === "pause") {
    if (agreement.status === "paused") return { message: "Billing is already paused." };
    if ((await repo.updateAgreement(db, agreement.id, { status: "paused", paused_at: at, updated_by: actor.userId }, "active")) === 0) throw new RuleError("The schedule changed meanwhile. Reload the page.");
    await closeClientTasks(db, input.clientId, "plan_paused", by, at);
  } else if (input.change === "resume") {
    if (agreement.status === "active") return { message: "Billing is already active." };
    // Tasks restart from today: renewals missed while paused do not suddenly appear.
    if ((await repo.updateAgreement(db, agreement.id, { status: "active", paused_at: null, tasks_from: todayIn(now), updated_by: actor.userId }, "paused")) === 0) throw new RuleError("The schedule changed meanwhile. Reload the page.");
  } else {
    if (input.confirm !== "yes" && input.confirm !== "on") throw new RuleError("Tick the box to confirm you want to cancel billing for this client.");
    if ((await repo.updateAgreement(db, agreement.id, { status: "cancelled", cancelled_at: at, updated_by: actor.userId })) === 0) throw new RuleError("The schedule changed meanwhile. Reload the page.");
    await closeClientTasks(db, input.clientId, "plan_cancelled", by, at);
  }
  await audit(actor, { action: `billing_schedule.${input.change === "pause" ? "paused" : input.change === "resume" ? "resumed" : "cancelled"}`, entityType: "care_agreement", entityId: agreement.id, clientId: input.clientId, before: { status: agreement.status } });
  return { message: input.change === "pause" ? "Billing paused. Open billing tasks were cancelled." : input.change === "resume" ? "Billing resumed from today." : "Billing cancelled. The history is kept." };
}

async function openCycle(db: Db, cycleId: string): Promise<CycleRecord> {
  const cycle = await repo.getCycle(db, cycleId);
  if (!cycle) throw new RuleError("That renewal could not be found.");
  if (cycle.status === "paid" || cycle.status === "paid_manual") throw new RuleError("This renewal is already paid.");
  if (cycle.status === "cancelled") throw new RuleError("This renewal was cancelled.");
  return cycle;
}

/** Closes one milestone's open task for a cycle (and its task on Today/Work). */
async function closeMilestone(db: Db, cycle: CycleRecord, milestone: Action["milestone"], status: "done" | "resolved", outcome: string, by: string, at: string): Promise<void> {
  for (const a of await repo.listActionsForCycles(db, [cycle.id])) {
    if (a.milestone !== milestone || a.status !== "open") continue;
    await repo.closeAction(db, a.id, status, outcome, by, at);
    if (a.workItemId) await repo.completeWorkItem(db, a.workItemId, at);
  }
}

/**
 * "Mark sent": the owner sent the renewal invoice or payment link themselves. Recorded once per renewal, so the same
 * renewal is never marked (or sent) twice. Sending is not payment: the renewal stays unpaid until a payment arrives.
 */
export async function markInvoiceSent(actor: Owner, raw: unknown, now: Date = new Date()): Promise<{ message: string }> {
  assertCan(actor, "billing.tasks");
  const input = parseInput(markSentSchema, raw);
  const db = await readDb(actor);
  const cycle = await openCycle(db, input.cycleId);
  if (cycle.invoiceSender !== "luminate") throw new RuleError("Stripe sends this client's renewal invoice, so there is nothing to send from here.");
  if (cycle.invoiceSentAt) throw new RuleError(`Already marked sent on ${shortDay(toLocalDate(new Date(cycle.invoiceSentAt), BILLING_TIME_ZONE))}. Do not send it again.`);
  const at = now.toISOString();
  if ((await repo.stampCycleOnce(db, cycle.id, "invoice_sent_at", { invoice_sent_at: at, invoice_sent_by: actor.userId, ...(input.invoiceUrl ? { invoice_url: input.invoiceUrl } : {}) })) === 0) {
    throw new RuleError("This renewal was just marked sent. Do not send it again.");
  }
  await closeMilestone(db, cycle, "send_invoice", "done", "sent", byOf(actor), at);
  await audit(actor, { action: "billing.invoice_marked_sent", entityType: "billing_cycle", entityId: cycle.id, clientId: cycle.clientId, after: { dueOn: cycle.dueOn, amountCents: cycle.amountCents, link: input.invoiceUrl !== null } });
  return { message: "Marked sent. It stays unpaid until the payment arrives." };
}

/** "Mark reminder sent": the owner sent the friendly payment reminder themselves. Recorded once per renewal. */
export async function markReminderSent(actor: Owner, raw: unknown, now: Date = new Date()): Promise<{ message: string }> {
  assertCan(actor, "billing.tasks");
  const input = parseInput(cycleSchema, raw);
  const db = await readDb(actor);
  const cycle = await openCycle(db, input.cycleId);
  if (cycle.reminderSentAt) throw new RuleError(`Reminder already marked sent on ${shortDay(toLocalDate(new Date(cycle.reminderSentAt), BILLING_TIME_ZONE))}.`);
  const at = now.toISOString();
  if ((await repo.stampCycleOnce(db, cycle.id, "reminder_sent_at", { reminder_sent_at: at, reminder_sent_by: actor.userId })) === 0) throw new RuleError("The reminder was just marked sent.");
  await closeMilestone(db, cycle, "friendly_reminder", "done", "reminder_sent", byOf(actor), at);
  await audit(actor, { action: "billing.reminder_marked_sent", entityType: "billing_cycle", entityId: cycle.id, clientId: cycle.clientId, after: { dueOn: cycle.dueOn } });
  return { message: "Reminder marked sent." };
}

/** "Mark done" for the Day 0 check and the Day +7 review. Does not mark anything paid. */
export async function markReviewed(actor: Owner, raw: unknown, now: Date = new Date()): Promise<{ message: string }> {
  assertCan(actor, "billing.tasks");
  const input = parseInput(actionSchema, raw);
  const db = await readDb(actor);
  const action = await repo.getAction(db, input.actionId);
  if (!action) throw new RuleError("That billing task could not be found.");
  if (action.milestone !== "verify_payment" && action.milestone !== "grace_review") throw new RuleError("Use Mark sent or Mark reminder sent for this task.");
  if (action.status !== "open") return { message: "This task is already closed." };
  const at = now.toISOString();
  await repo.closeAction(db, action.id, "done", "reviewed", byOf(actor), at);
  if (action.workItemId) await repo.completeWorkItem(db, action.workItemId, at);
  await audit(actor, { action: "billing.task_reviewed", entityType: "billing_action", entityId: action.id, clientId: action.clientId, after: { milestone: action.milestone } });
  return { message: "Marked done. The renewal stays unpaid until a payment is recorded." };
}

/**
 * Records a payment received outside Stripe (cash, cheque, bank transfer), or a Stripe payment the app could not match.
 * Settles the renewal and closes its reminders. Kept on the renewal with who and when; not added to the Stripe
 * payment records (Stripe-derived data stays Stripe's).
 */
export async function recordManualPayment(actor: Owner, raw: unknown, now: Date = new Date()): Promise<{ message: string }> {
  assertCan(actor, "billing.tasks");
  const input = parseInput(manualPaymentSchema, raw);
  if (input.paidOn > todayIn(now)) throw new RuleError("The payment date cannot be in the future.");
  const db = await readDb(actor);
  const cycle = await openCycle(db, input.cycleId);
  const at = now.toISOString();
  const changed = await repo.updateCycle(
    db,
    cycle.id,
    {
      status: "paid_manual",
      paid_at: new Date(`${input.paidOn}T17:00:00Z`).toISOString(),
      manual_amount_cents: input.amount as number,
      manual_method: input.method,
      manual_note: input.note,
      manual_recorded_at: at,
      manual_recorded_by: actor.userId,
    },
    "open",
  );
  if (changed === 0) throw new RuleError("This renewal was just settled. Reload the page.");
  for (const a of await repo.listActionsForCycles(db, [cycle.id])) {
    if (a.status !== "open") continue;
    await repo.closeAction(db, a.id, "resolved", "payment_recorded", byOf(actor), at);
    if (a.workItemId) await repo.completeWorkItem(db, a.workItemId, at);
  }
  await audit(actor, {
    action: "billing.payment_recorded",
    entityType: "billing_cycle",
    entityId: cycle.id,
    clientId: cycle.clientId,
    after: { dueOn: cycle.dueOn, amountCents: input.amount, paidOn: input.paidOn, method: input.method, hasNote: input.note !== null },
  });
  const short = (input.amount as number) < cycle.amountCents ? ` That is less than the ${formatCents(cycle.amountCents)} due.` : "";
  return { message: `Payment recorded.${short}` };
}
