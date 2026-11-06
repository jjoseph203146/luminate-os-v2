// Pure rules for the Money page (docs/architecture/06 §6 and §7). No database, no Stripe: easy to test.
import { addCalendarDays, toLocalDate } from "@/platform/calendar/business-days";
import type { MoneyInvoice, MoneySubscription } from "@/platform/stripe/money-api";
import type { AttentionItem, MoneyClient, MoneyOverview, StripeState, UpcomingPayment } from "./types";

/** The owner's monthly revenue goal ($10K, from the Money page design). */
export const MONTHLY_GOAL_CENTS = 1_000_000;
/** Days 0–7 after the due date are the grace period; day 8 on is past due (06 §6, the late-payment ladder). */
export const GRACE_DAYS = 7;
/** How far ahead "Upcoming payments" looks. */
export const UPCOMING_DAYS = 14;

const DAY_MS = 86_400_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Monthly cents for a recurring price: yearly / 12, weekly × 52 / 12, daily × 365 / 12, per interval_count. */
export function monthlyCentsOf(unitCents: number, recurring: { interval: string; interval_count?: number | null } | null | undefined): number {
  if (!recurring) return 0;
  const every = Math.max(1, recurring.interval_count ?? 1);
  const perMonth = ({ month: 1, year: 1 / 12, week: 52 / 12, day: 365 / 12 } as Record<string, number>)[recurring.interval] ?? 0;
  return Math.round((unitCents * perMonth) / every);
}

/** Whole calendar days from the due date to today (business time zone); negative when it is not due yet. */
export function daysPastDue(dueAtSec: number, now: Date, timeZone: string): number {
  const due = toLocalDate(new Date(dueAtSec * 1000), timeZone);
  const today = toLocalDate(now, timeZone);
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / DAY_MS);
}

export type InvoiceBucket = "upcoming" | "grace" | "past_due";

/** Not due yet, in the grace period (days 0–7, a failed autopay counts as unpaid), or past due (day 8 on). */
export function invoiceBucket(days: number): InvoiceBucket {
  if (days < 0) return "upcoming";
  return days <= GRACE_DAYS ? "grace" : "past_due";
}

/** "Fri, Nov 6" for a local date. */
export function shortDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Nov 6" for a local date. */
function monthDay(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "January" for when a pause ends. */
function monthName(isoDate: string): string {
  return MONTHS[Number(isoDate.slice(5, 7)) - 1] ?? isoDate;
}

/** "$1,284" (whole dollars) or "$99.00" (with cents). */
export function money(cents: number, withCents = false): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: withCents ? 2 : 0, maximumFractionDigits: withCents ? 2 : 0 });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const accountsLabel = (n: number) => plural(n, "account");

export interface MoneyInput {
  now: Date;
  timeZone: string;
  /** Paid payments since at least the start of last month (amount in dollars, as stored). */
  payments: { amount: number; paid_at: string | null }[];
  clients: MoneyClient[];
  stripeState: StripeState;
  subscriptions: MoneySubscription[];
  invoices: MoneyInvoice[];
  lastEventAt: string | null;
}

/** Every figure on the Money page from the stored payments and Stripe's live subscriptions and open invoices. */
export function buildMoneyOverview(input: MoneyInput): MoneyOverview {
  const { now, timeZone } = input;
  const today = toLocalDate(now, timeZone);
  const thisMonth = today.slice(0, 7);
  const lastMonthKey = addCalendarDays(`${thisMonth}-01`, -1).slice(0, 7);

  // Collected: paid payments by the month they were paid in (business time zone). Unassigned payments count: they
  // are real money. Refunds are not recorded yet, so they are not subtracted (the page says so).
  let collectedCents = 0;
  let lastMonthCents = 0;
  for (const p of input.payments) {
    if (!p.paid_at) continue;
    const key = toLocalDate(new Date(p.paid_at), timeZone).slice(0, 7);
    const cents = Math.round(Number(p.amount) * 100);
    if (key === thisMonth) collectedCents += cents;
    else if (key === lastMonthKey) lastMonthCents += cents;
  }
  const monthIdx = Number(thisMonth.slice(5, 7)) - 1;
  const monthShort = (MONTHS[monthIdx] ?? "").slice(0, 3);
  const collected = { cents: collectedCents, monthShort, range: `${monthShort} 1–${Number(today.slice(8, 10))}` };
  const lastMonth = { cents: lastMonthCents, monthName: MONTHS[Number(lastMonthKey.slice(5, 7)) - 1] ?? "" };
  const goalPercent = Math.round((collectedCents / MONTHLY_GOAL_CENTS) * 100);

  if (input.stripeState !== "live") {
    return {
      stripe: input.stripeState,
      lastEventAt: input.lastEventAt,
      collected,
      lastMonth,
      goal: { cents: MONTHLY_GOAL_CENTS, percent: goalPercent, mrrPercent: null },
      mrr: null,
      pastDue: null,
      grace: null,
      paused: null,
      upcoming: null,
      attention: null,
    };
  }

  // Stripe customers are named after their client (an active one first), else by Stripe's own name.
  const byCustomer = new Map<string, MoneyClient>();
  for (const c of input.clients) {
    if (!c.stripeCustomerId) continue;
    const seen = byCustomer.get(c.stripeCustomerId);
    if (!seen || (seen.archived && !c.archived)) byCustomer.set(c.stripeCustomerId, c);
  }
  const who = (customerId: string, stripeName: string | null) => {
    const client = byCustomer.get(customerId);
    return { name: client?.name ?? stripeName ?? "Stripe customer (no client)", clientId: client?.id ?? null };
  };

  // Active MRR [DECIDED]: monthly fees of live subscriptions whose current-period invoice is paid. Paused ones never count.
  const live = input.subscriptions.filter((s) => !s.paused);
  const paying = live.filter((s) => s.currentPeriodPaid && ["active", "past_due", "unpaid", "trialing"].includes(s.status));
  const mrr = { cents: paying.reduce((sum, s) => sum + s.monthlyCents, 0), subscriptions: paying.length };

  const upcoming: UpcomingPayment[] = [];
  const attention: AttentionItem[] = [];
  const horizon = addCalendarDays(today, UPCOMING_DAYS);

  for (const s of live) {
    if (s.cancelAtPeriodEnd || s.nextBillingAt === null || !["active", "trialing", "past_due"].includes(s.status)) continue;
    const date = toLocalDate(new Date(s.nextBillingAt * 1000), timeZone);
    if (date < today || date > horizon || s.periodCents <= 0) continue;
    upcoming.push({ key: s.id, ...who(s.customerId, s.customerName), date, kind: s.collectionMethod === "send_invoice" ? "invoice" : "autopay", cents: s.periodCents });
  }

  const graceAccounts = new Map<string, number>();
  const pastDueAccounts = new Set<string>();
  let graceCents = 0;
  let pastDueCents = 0;
  for (const inv of input.invoices) {
    if (inv.amountRemainingCents <= 0) continue;
    const days = daysPastDue(inv.dueAt, now, timeZone);
    const bucket = invoiceBucket(days);
    const dueDate = toLocalDate(new Date(inv.dueAt * 1000), timeZone);
    const name = who(inv.customerId, inv.customerName);
    if (bucket === "upcoming") {
      if (dueDate <= horizon) upcoming.push({ key: inv.id, ...name, date: dueDate, kind: "invoice", cents: inv.amountRemainingCents });
      continue;
    }
    const failedAutopay = inv.collectionMethod === "charge_automatically" && inv.attemptCount > 0;
    if (bucket === "grace") {
      graceCents += inv.amountRemainingCents;
      graceAccounts.set(inv.customerId, Math.max(graceAccounts.get(inv.customerId) ?? 0, days));
      const when = days === 0 ? "due today" : `day ${days} of ${GRACE_DAYS}`;
      const what = failedAutopay ? `Autopay failed ${monthDay(dueDate)}` : `Invoice due ${monthDay(dueDate)}`;
      attention.push({ key: inv.id, ...name, kind: "grace", cents: inv.amountRemainingCents, detail: `${what} · counts as unpaid · ${when}` });
    } else {
      pastDueCents += inv.amountRemainingCents;
      pastDueAccounts.add(inv.customerId);
      const what = failedAutopay ? "autopay failed" : `invoice ${inv.number ?? "unpaid"}`;
      attention.push({ key: inv.id, ...name, kind: "past_due", cents: inv.amountRemainingCents, detail: `Unpaid ${plural(days, "day")} · ${what}` });
    }
  }

  // Paused: subscriptions paused in Stripe, and clients the webhook marked paused (their subscription ended) that have
  // no live subscription left. Never part of MRR or collected revenue.
  const pausedAccounts = new Set<string>();
  let pausedCents = 0;
  for (const s of input.subscriptions.filter((x) => x.paused)) {
    pausedAccounts.add(s.customerId);
    pausedCents += s.monthlyCents;
    const until = s.pauseResumesAt ? ` until ${monthName(toLocalDate(new Date(s.pauseResumesAt * 1000), timeZone))}` : "";
    attention.push({ key: s.id, ...who(s.customerId, s.customerName), kind: "paused", cents: s.monthlyCents, detail: `Subscription paused${until}` });
  }
  const liveCustomers = new Set(input.subscriptions.map((s) => s.customerId));
  for (const c of input.clients) {
    if (c.archived || c.status !== "paused" || !c.stripeCustomerId || liveCustomers.has(c.stripeCustomerId) || pausedAccounts.has(c.stripeCustomerId)) continue;
    pausedAccounts.add(c.stripeCustomerId);
    const cents = Math.round(c.subscriptionPrice * 100);
    pausedCents += cents;
    attention.push({ key: `client-${c.id}`, name: c.name, clientId: c.id, kind: "paused", cents, detail: "Subscription ended in Stripe · billing paused" });
  }

  upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const order = { past_due: 0, grace: 1, paused: 2 } as const;
  attention.sort((a, b) => order[a.kind] - order[b.kind] || b.cents - a.cents || a.name.localeCompare(b.name));

  const graceDays = [...graceAccounts.values()];
  return {
    stripe: "live",
    lastEventAt: input.lastEventAt,
    collected,
    lastMonth,
    goal: { cents: MONTHLY_GOAL_CENTS, percent: goalPercent, mrrPercent: Math.round((mrr.cents / MONTHLY_GOAL_CENTS) * 100) },
    mrr,
    pastDue: { cents: pastDueCents, accounts: pastDueAccounts.size },
    grace: { cents: graceCents, accounts: graceAccounts.size, day: graceDays.length === 1 ? (graceDays[0] as number) : null },
    paused: { cents: pausedCents, accounts: pausedAccounts.size },
    upcoming,
    attention,
  };
}
