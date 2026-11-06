// Pure rules for SOP billing tasks (docs/architecture/17-billing-tasks.md; SOP ladder in 06 s6). No database, no
// clock reads: `today` (a New York calendar date) is passed in, so every case is testable.
import { addCalendarDays, monthDayClamped, toLocalDate } from "@/platform/calendar/business-days";
import type { Action, ActionStatus, BillingHealth, Cycle, InvoiceSender, Milestone, PlannerAgreement, VerifiedPayment } from "./types";

/** Billing dates are New York calendar dates, whatever the server's clock zone. */
export const BILLING_TIME_ZONE = "America/New_York";

/** How far back a missed run still creates cycles (covers a scheduler outage of two months). */
export const LOOKBACK_DAYS = 75;

/** A payment made up to this many days before the renewal date counts for that renewal (the invoice goes out at -5). */
export const EARLY_PAYMENT_DAYS = 7;

/** The billing job counts as stale when it has not succeeded for this long (it runs hourly). */
export const STALE_AFTER_MS = 3 * 60 * 60_000;

export interface MilestoneDef {
  milestone: Milestone;
  offset: number;
  priority: "normal" | "high" | "urgent";
  title: string;
}

/**
 * The SOP schedule, in calendar days from the renewal date. Day +7 is a review milestone only: it never suspends a
 * service or takes a site offline (later ladder steps are not built in this phase).
 */
export const MILESTONES: readonly MilestoneDef[] = [
  { milestone: "send_invoice", offset: -5, priority: "normal", title: "Send renewal invoice/payment link" },
  { milestone: "verify_payment", offset: 0, priority: "high", title: "Verify renewal payment" },
  { milestone: "friendly_reminder", offset: 3, priority: "high", title: "Send friendly payment reminder" },
  { milestone: "grace_review", offset: 7, priority: "urgent", title: "Review expired payment grace period" },
];

export const milestoneDef = (m: Milestone): MilestoneDef => MILESTONES.find((d) => d.milestone === m) as MilestoneDef;

/**
 * The milestones for a renewal. When Stripe sends the invoice or charges autopay, there is no "send invoice" task:
 * one sender only, so the client is never asked to pay twice.
 */
export function milestonesFor(sender: InvoiceSender): MilestoneDef[] {
  return MILESTONES.filter((d) => d.milestone !== "send_invoice" || sender === "luminate");
}

/** The stable id of one billing action. Also the task's source_reference, so a task can only be created once. */
export function actionKey(clientId: string, cycleDueOn: string, milestone: Milestone): string {
  return `billing:${clientId}:${cycleDueOn}:${milestone}`;
}

/** The renewal date in a month (month 1-12, may roll over a year), on the last day of a shorter month. */
export function renewalDate(year: number, month: number, anniversaryDay: number): string {
  return monthDayClamped(year, month, anniversaryDay);
}

/** The renewal after `dueOn`, on the anniversary day (not on the clamped day: Feb 28 is followed by Mar 31). */
export function nextRenewal(dueOn: string, anniversaryDay: number): string {
  return renewalDate(Number(dueOn.slice(0, 4)), Number(dueOn.slice(5, 7)) + 1, anniversaryDay);
}

/** The first renewal on or after `date`. */
export function renewalOnOrAfter(date: string, anniversaryDay: number): string {
  const here = renewalDate(Number(date.slice(0, 4)), Number(date.slice(5, 7)), anniversaryDay);
  return here >= date ? here : nextRenewal(here, anniversaryDay);
}

/** The anniversary day suggested from a date (for example the client's next Stripe billing date). */
export function anniversaryDayOf(date: string | null): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return Number(date.slice(8, 10));
}

export interface NewCycle {
  agreementId: string;
  clientId: string;
  dueOn: string;
  amountCents: number;
  planName: string | null;
  invoiceSender: InvoiceSender;
}

/** Whether a plan creates billing work right now: active, client not archived, Stripe subscription not ended. */
export const isBilling = (a: PlannerAgreement) => a.status === "active" && !a.clientArchived && !a.clientPaused;

/**
 * Step 1: the renewals that need a cycle by `today`. A cycle is created on Day -5 (or later, if runs were missed)
 * for each renewal on or after the plan's start, whose last milestone (+7) is not before the schedule was entered
 * or resumed (`tasksFrom`), within the lookback. Existing cycles (any status) are never created again.
 */
export function cyclesToCreate(today: string, agreements: PlannerAgreement[], existing: Pick<Cycle, "clientId" | "dueOn">[]): NewCycle[] {
  const have = new Set(existing.map((c) => `${c.clientId}:${c.dueOn}`));
  const out: NewCycle[] = [];
  const oldest = addCalendarDays(today, -LOOKBACK_DAYS);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  for (const a of agreements) {
    if (!isBilling(a)) continue;
    for (let k = -3; k <= 1; k++) {
      const dueOn = renewalDate(y, m + k, a.anniversaryDay);
      if (addCalendarDays(dueOn, -5) > today) continue;
      if (dueOn < a.startsOn || dueOn < oldest) continue;
      if (addCalendarDays(dueOn, 7) < a.tasksFrom) continue;
      const key = `${a.clientId}:${dueOn}`;
      if (have.has(key)) continue;
      have.add(key);
      out.push({ agreementId: a.id, clientId: a.clientId, dueOn, amountCents: a.monthlyPriceCents, planName: a.planName, invoiceSender: a.invoiceSender });
    }
  }
  return out.sort((p, q) => p.dueOn.localeCompare(q.dueOn) || p.clientId.localeCompare(q.clientId));
}

/**
 * The verified payment that settles a renewal: the earliest one not already used by another renewal, paid (New York
 * date) from 7 days before the renewal up to 7 days before the next one, that is a subscription payment or exactly the
 * renewal amount. A sent invoice is never proof of payment; neither is a one-off project payment of another amount.
 */
export function matchPayment(cycle: Pick<Cycle, "clientId" | "dueOn" | "amountCents">, anniversaryDay: number, payments: VerifiedPayment[], used: ReadonlySet<string>): VerifiedPayment | null {
  const from = addCalendarDays(cycle.dueOn, -EARLY_PAYMENT_DAYS);
  const until = addCalendarDays(nextRenewal(cycle.dueOn, anniversaryDay), -EARLY_PAYMENT_DAYS);
  const candidates = payments
    .filter((p) => p.clientId === cycle.clientId && !used.has(p.id) && p.amountCents > 0)
    .filter((p) => p.eventType === "subscription" || p.amountCents === cycle.amountCents)
    .filter((p) => {
      const day = toLocalDate(new Date(p.paidAt), BILLING_TIME_ZONE);
      return day >= from && day < until;
    })
    .sort((p, q) => p.paidAt.localeCompare(q.paidAt) || p.id.localeCompare(q.id));
  return candidates[0] ?? null;
}

export interface NewAction {
  cycleId: string;
  clientId: string;
  milestone: Milestone;
  dueOn: string;
  actionKey: string;
}

export interface CloseAction {
  actionId: string;
  status: Exclude<ActionStatus, "open">;
  outcome: string;
}

export interface CyclePlan {
  pay: { cycleId: string; paymentId: string; paidAt: string }[];
  cancelCycles: { cycleId: string; reason: string }[];
  newActions: NewAction[];
  closeActions: CloseAction[];
}

/**
 * Step 2: for every open renewal, settle it from a verified payment, or create the milestones that are due, or stop
 * them when the plan is paused, cancelled or the client archived. Idempotent: run twice on the same data, the second
 * run plans nothing new.
 */
export function planCycles(
  today: string,
  agreements: PlannerAgreement[],
  cycles: (Cycle & { paymentRef: string | null })[],
  actions: Action[],
  payments: VerifiedPayment[],
): CyclePlan {
  const plan: CyclePlan = { pay: [], cancelCycles: [], newActions: [], closeActions: [] };
  const byId = new Map(agreements.map((a) => [a.id, a]));
  const used = new Set(cycles.map((c) => c.paymentRef).filter((v): v is string => v !== null));
  const closed = new Set<string>();
  const close = (a: Action, status: CloseAction["status"], outcome: string) => {
    if (a.status !== "open" || closed.has(a.id)) return;
    closed.add(a.id);
    plan.closeActions.push({ actionId: a.id, status, outcome });
  };
  const actionsOf = new Map<string, Action[]>();
  for (const a of actions) actionsOf.set(a.cycleId, [...(actionsOf.get(a.cycleId) ?? []), a]);

  // A task ticked off elsewhere (the Work page) counts as done.
  for (const a of actions) if (a.status === "open" && a.workItemCompleted) close(a, "done", "completed_in_work");

  for (const cycle of [...cycles].sort((p, q) => p.dueOn.localeCompare(q.dueOn) || p.id.localeCompare(q.id))) {
    const own = actionsOf.get(cycle.id) ?? [];
    if (cycle.status !== "open") {
      // Settled or cancelled earlier: nothing may stay open.
      for (const a of own) close(a, cycle.status === "cancelled" ? "cancelled" : "resolved", cycle.status === "cancelled" ? "cycle_cancelled" : "payment_confirmed");
      continue;
    }
    const agreement = byId.get(cycle.agreementId);
    const day = agreement?.anniversaryDay ?? Number(cycle.dueOn.slice(8, 10));

    const payment = matchPayment(cycle, day, payments, used);
    if (payment) {
      used.add(payment.id);
      plan.pay.push({ cycleId: cycle.id, paymentId: payment.id, paidAt: payment.paidAt });
      for (const a of own) close(a, "resolved", "payment_confirmed");
      continue;
    }

    if (!agreement || agreement.status === "cancelled") {
      for (const a of own) close(a, "cancelled", "plan_cancelled");
      // A renewal not reached yet is no longer owed. One already due stays open: that money may still be owed.
      if (cycle.dueOn > today) plan.cancelCycles.push({ cycleId: cycle.id, reason: "plan cancelled" });
      continue;
    }
    if (!isBilling(agreement)) {
      const outcome = agreement.clientArchived ? "client_archived" : "plan_paused";
      for (const a of own) close(a, "cancelled", outcome);
      continue;
    }

    const have = new Set(own.map((a) => a.milestone));
    for (const def of milestonesFor(cycle.invoiceSender)) {
      const dueOn = addCalendarDays(cycle.dueOn, def.offset);
      if (dueOn > today || have.has(def.milestone)) continue;
      if (def.milestone === "send_invoice" && cycle.invoiceSentAt) continue;
      if (def.milestone === "friendly_reminder" && cycle.reminderSentAt) continue;
      plan.newActions.push({ cycleId: cycle.id, clientId: cycle.clientId, milestone: def.milestone, dueOn, actionKey: actionKey(cycle.clientId, cycle.dueOn, def.milestone) });
    }
  }
  return plan;
}

/** The task title on the Work page: the action, the amount and the renewal date. */
export function taskTitle(milestone: Milestone, amountCents: number, cycleDueOn: string): string {
  return `${milestoneDef(milestone).title} (${formatCents(amountCents)}, renews ${shortDay(cycleDueOn)})`;
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

/** "Nov 12" for a date. */
export function shortDay(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Where "Open invoice / payment link" goes: the link recorded when sent, else the plan's payment link, else Stripe. */
export function invoiceHref(cycleUrl: string | null, paymentLinkUrl: string | null, stripeCustomerId: string | null): string | null {
  if (cycleUrl) return cycleUrl;
  if (paymentLinkUrl) return paymentLinkUrl;
  if (stripeCustomerId && /^cus_[A-Za-z0-9]+$/.test(stripeCustomerId)) return `https://dashboard.stripe.com/customers/${stripeCustomerId}`;
  return null;
}

/** Whether the billing job is keeping up. A failing or stale job is shown on Today, never hidden. */
export function billingHealth(job: { exists: boolean; enabled: boolean; lastSuccessAt: string | null; lastRunFailed: boolean } , now: Date): BillingHealth {
  if (!job.exists || !job.enabled) return { state: "not_set_up", lastSuccessAt: job.lastSuccessAt };
  if (job.lastRunFailed) return { state: "failing", lastSuccessAt: job.lastSuccessAt };
  if (!job.lastSuccessAt) return { state: "never", lastSuccessAt: null };
  if (now.getTime() - Date.parse(job.lastSuccessAt) > STALE_AFTER_MS) return { state: "stale", lastSuccessAt: job.lastSuccessAt };
  return { state: "ok", lastSuccessAt: job.lastSuccessAt };
}
