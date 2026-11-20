// Pure rules for the owner dashboard. No database. Won is never revenue.
import { addCalendarDays, dayOfWeek, toLocalDate } from "@/platform/calendar/business-days";
import { isPayingClient, isLostReason, isOpen, LOST_REASON_LABEL, STAGE_LABEL } from "@/domains/growth/rules";
import { LOST_REASONS, STAGES, type Stage } from "@/domains/growth/types";
import { DASHBOARD_LIST_LIMIT, STALE_AFTER_DAYS, type ClientReview, type DashboardClient, type DashboardFacts, type DashboardLead, type DashboardPayment, type LeadLine, type LeadReview, type NamedCount, type OwnerDashboard, type RevenueReview, type StageCount } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Monday–Sunday calendar week that contains `today` (yyyy-mm-dd). */
export function weekBounds(today: string): { start: string; end: string } {
  const dow = dayOfWeek(today);
  const sinceMonday = dow === 0 ? 6 : dow - 1;
  const start = addCalendarDays(today, -sinceMonday);
  return { start, end: addCalendarDays(start, 6) };
}

/** Calendar day for a date or timestamp, in the business time zone. Null when it cannot be read. */
export function localDay(value: string | null | undefined, timeZone: string): string | null {
  if (!value) return null;
  if (ISO_DATE.test(value)) return value;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  try {
    return toLocalDate(instant, timeZone);
  } catch {
    return null;
  }
}

function inRange(day: string | null, start: string, end: string): boolean {
  return day !== null && day >= start && day <= end;
}

function sumDollars(amounts: number[]): number {
  const cents = amounts.reduce((sum, amount) => sum + Math.round(amount * 100), 0);
  return cents / 100;
}

/** A collected payment: status exactly `paid` and a positive amount. Won is not a payment. */
export function isCollectedPayment(payment: Pick<DashboardPayment, "status" | "amount">): boolean {
  return payment.status === "paid" && Number.isFinite(payment.amount) && payment.amount > 0;
}

function businessLabel(name: string): string {
  const trimmed = name.trim();
  return trimmed || "Unnamed";
}

function leadHref(id: string): string {
  return `/growth?lead=${encodeURIComponent(id)}`;
}

function counts(labels: string[]): NamedCount[] {
  const map = new Map<string, number>();
  for (const label of labels) map.set(label, (map.get(label) ?? 0) + 1);
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count }));
}

function daysBefore(day: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
}

interface DatedLead {
  lead: DashboardLead;
  day: string;
  due: "overdue" | "today";
}

function byDueDate(rows: DatedLead[]): DatedLead[] {
  return rows.sort((a, b) => a.day.localeCompare(b.day) || businessLabel(a.lead.businessName).localeCompare(businessLabel(b.lead.businessName)));
}

function recordedValue(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

function dueRows(leads: DashboardLead[], today: string, timeZone: string, dateOf: (lead: DashboardLead) => string | null): DatedLead[] {
  const dated: DatedLead[] = [];
  for (const lead of leads) {
    if (!isOpen(lead)) continue;
    const day = localDay(dateOf(lead), timeZone);
    if (!day || day > today) continue;
    dated.push({ lead, day, due: day === today ? "today" : "overdue" });
  }
  return byDueDate(dated);
}

function followUpLines(leads: DashboardLead[], today: string, timeZone: string): { overdue: number; dueToday: number; lines: LeadLine[]; total: number } {
  const dated = dueRows(leads, today, timeZone, (lead) => lead.followUpDate);
  const lines = dated.slice(0, DASHBOARD_LIST_LIMIT).map(({ lead, day, due }) => {
    const age = daysBefore(day, today);
    const when = due === "today" ? "Follow-up due today" : `Follow-up overdue · ${age} ${age === 1 ? "day" : "days"}`;
    return { id: lead.id, businessName: businessLabel(lead.businessName), stage: lead.stage, detail: `${STAGE_LABEL[lead.stage]} · ${when}`, href: leadHref(lead.id), due };
  });
  return {
    overdue: dated.filter((row) => row.due === "overdue").length,
    dueToday: dated.filter((row) => row.due === "today").length,
    lines,
    total: dated.length,
  };
}

function nextStepLines(leads: DashboardLead[], today: string, timeZone: string): { overdue: number; dueToday: number; lines: LeadLine[]; total: number } {
  const dated = dueRows(leads, today, timeZone, (lead) => lead.nextStepOn);
  const lines = dated.slice(0, DASHBOARD_LIST_LIMIT).map(({ lead, day, due }) => {
    const age = daysBefore(day, today);
    const when = due === "today" ? "due today" : `${age} ${age === 1 ? "day" : "days"} overdue`;
    const step = lead.nextStep?.trim() || "Next step";
    return { id: lead.id, businessName: businessLabel(lead.businessName), stage: lead.stage, detail: `${STAGE_LABEL[lead.stage]} · ${step} · ${when}`, href: leadHref(lead.id), due };
  });
  return {
    overdue: dated.filter((row) => row.due === "overdue").length,
    dueToday: dated.filter((row) => row.due === "today").length,
    lines,
    total: dated.length,
  };
}

/** Engagement day: last touch, or the created day when no touch is recorded. A stage change is not a touch. */
function engagementDay(lead: DashboardLead, timeZone: string): string | null {
  return localDay(lead.lastTouchAt, timeZone) ?? localDay(lead.createdAt, timeZone);
}

function staleLines(leads: DashboardLead[], today: string, timeZone: string): { count: number; lines: LeadLine[] } {
  const cutoff = addCalendarDays(today, -STALE_AFTER_DAYS);
  const stale = leads
    .map((lead) => ({ lead, day: engagementDay(lead, timeZone) }))
    .filter((row): row is { lead: DashboardLead; day: string } => isOpen(row.lead) && row.day !== null && row.day <= cutoff)
    .sort((a, b) => a.day.localeCompare(b.day) || businessLabel(a.lead.businessName).localeCompare(businessLabel(b.lead.businessName)));
  const lines = stale.slice(0, DASHBOARD_LIST_LIMIT).map(({ lead, day }) => {
    const age = daysBefore(day, today);
    const detail = lead.lastTouchAt
      ? `${STAGE_LABEL[lead.stage]} · No touch in ${age} days`
      : `${STAGE_LABEL[lead.stage]} · No touch recorded · opened ${age} days ago`;
    return { id: lead.id, businessName: businessLabel(lead.businessName), stage: lead.stage, detail, href: leadHref(lead.id), due: "stale" as const };
  });
  return { count: stale.length, lines };
}

function lostReasonLabel(reason: string | null): string {
  if (!reason) return "No reason recorded";
  return isLostReason(reason) ? LOST_REASON_LABEL[reason] : "Unrecognized";
}

function buildLeads(facts: DashboardFacts, week: { start: string; end: string }): LeadReview | { available: false } {
  if (!facts.leads.available) return { available: false };
  const { rows, pipelineAvailable, truncated } = facts.leads;
  const { today, timeZone } = facts;
  const open = rows.filter(isOpen);
  const wonRows = rows.filter((lead) => lead.stage === "won");
  const lostRows = rows.filter((lead) => lead.stage === "lost");
  const createdThisWeek = rows.filter((lead) => inRange(localDay(lead.createdAt, timeZone), week.start, week.end));
  const proposals = open.filter((lead) => lead.stage === "proposal_sent");
  const followUps = followUpLines(rows, today, timeZone);

  const stages: StageCount[] = STAGES.map((stage) => {
    const inStage = rows.filter((lead) => lead.stage === stage);
    return {
      stage,
      count: inStage.length,
      changedThisWeek: pipelineAvailable
        ? inStage.filter((lead) => inRange(localDay(lead.stageChangedAt, timeZone), week.start, week.end)).length
        : null,
    };
  });

  const review: LeadReview = {
    available: true,
    pipelineAvailable,
    truncated,
    stages,
    newThisWeek: createdThisWeek.length,
    newBySource: counts(createdThisWeek.map((lead) => lead.source?.trim() || "No source")),
    newByKind: pipelineAvailable
      ? {
          inbound: createdThisWeek.filter((lead) => lead.kind === "inbound").length,
          outbound: createdThisWeek.filter((lead) => lead.kind === "outbound").length,
          unset: createdThisWeek.filter((lead) => lead.kind !== "inbound" && lead.kind !== "outbound").length,
        }
      : null,
    openCount: open.length,
    openValue: sumDollars(open.map((lead) => recordedValue(lead.value) ?? 0)),
    openUnvalued: open.filter((lead) => recordedValue(lead.value) === null).length,
    proposalsOut: proposals.length,
    proposalNames: proposals
      .map((lead) => businessLabel(lead.businessName))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, DASHBOARD_LIST_LIMIT),
    won: wonRows.length,
    lost: lostRows.length,
    wonThisWeek: pipelineAvailable ? wonRows.filter((lead) => inRange(localDay(lead.stageChangedAt, timeZone), week.start, week.end)).length : null,
    wonWithoutStageTime: pipelineAvailable ? wonRows.filter((lead) => localDay(lead.stageChangedAt, timeZone) === null).length : null,
    winRate: wonRows.length + lostRows.length === 0 ? null : Math.round((wonRows.length / (wonRows.length + lostRows.length)) * 100),
    wonValue: sumDollars(wonRows.map((lead) => recordedValue(lead.value) ?? 0)),
    followUpsOverdue: followUps.overdue,
    followUpsDueToday: followUps.dueToday,
    followUps: followUps.lines,
    followUpTotal: followUps.total,
    nextStepsOverdue: null,
    nextStepsDueToday: null,
    nextSteps: null,
    nextStepTotal: null,
    staleCount: null,
    staleLeads: null,
    lostReasons: null,
    linked: null,
    wonLinked: null,
    wonUnlinked: null,
    wonUnlinkedTotal: null,
  };

  if (!pipelineAvailable) return review;

  const steps = nextStepLines(rows, today, timeZone);
  const stale = staleLines(rows, today, timeZone);
  const unlinked = wonRows
    .filter((lead) => !lead.clientId)
    .sort((a, b) => businessLabel(a.businessName).localeCompare(businessLabel(b.businessName)));
  review.nextStepsOverdue = steps.overdue;
  review.nextStepsDueToday = steps.dueToday;
  review.nextSteps = steps.lines;
  review.nextStepTotal = steps.total;
  review.staleCount = stale.count;
  review.staleLeads = stale.lines;
  review.lostReasons = lostRows.length === 0 ? [] : orderLostReasons(lostRows);
  review.linked = rows.filter((lead) => Boolean(lead.clientId)).length;
  review.wonLinked = wonRows.filter((lead) => Boolean(lead.clientId)).length;
  review.wonUnlinkedTotal = unlinked.length;
  review.wonUnlinked = unlinked.slice(0, DASHBOARD_LIST_LIMIT).map((lead) => ({
    id: lead.id,
    businessName: businessLabel(lead.businessName),
    stage: "won" as Stage,
    detail: "Won · no client linked",
    href: leadHref(lead.id),
    due: "won" as const,
  }));
  return review;
}

function orderLostReasons(lostRows: DashboardLead[]): NamedCount[] {
  const tally = counts(lostRows.map((lead) => lostReasonLabel(lead.lostReason)));
  const known = LOST_REASONS.map((reason) => LOST_REASON_LABEL[reason]);
  const rank = (label: string) => {
    const index = known.indexOf(label as (typeof known)[number]);
    if (index >= 0) return index;
    if (label === "No reason recorded") return known.length;
    return known.length + 1;
  };
  return tally.sort((a, b) => rank(a.label) - rank(b.label) || b.count - a.count);
}

function buildClients(facts: DashboardFacts, payments: DashboardPayment[] | null): ClientReview | { available: false } {
  if (!facts.clients.available) return { available: false };
  const rows = facts.clients.rows;
  const activeRows = rows.filter((client) => !client.archived);
  let paying: number | null = null;
  if (payments) {
    const paidIds = new Set(payments.filter((payment) => payment.clientId && isCollectedPayment(payment)).map((payment) => payment.clientId as string));
    paying = rows.filter((client) => isPayingClient({ archived: client.archived, lifetimeValue: client.lifetimeValue, paidRevenue: paidIds.has(client.id) })).length;
  }
  return {
    available: true,
    truncated: facts.clients.truncated,
    active: activeRows.length,
    archived: rows.length - activeRows.length,
    paying,
    activeNotPaying: paying === null ? null : activeRows.length - paying,
  };
}

function buildRevenue(facts: DashboardFacts, week: { start: string; end: string }): RevenueReview | { available: false } {
  if (!facts.payments.available) return { available: false };
  const paid = facts.payments.rows.filter(isCollectedPayment);
  const month = facts.today.slice(0, 7);
  const dated = paid.map((payment) => ({ payment, day: localDay(payment.paidAt, facts.timeZone) }));
  return {
    available: true,
    truncated: facts.payments.truncated,
    collectedAllTime: sumDollars(paid.map((payment) => payment.amount)),
    collectedThisMonth: sumDollars(dated.filter((row) => row.day?.slice(0, 7) === month).map((row) => row.payment.amount)),
    collectedThisWeek: sumDollars(dated.filter((row) => inRange(row.day, week.start, week.end)).map((row) => row.payment.amount)),
    paidCount: paid.length,
    undated: dated.filter((row) => row.day === null).length,
  };
}

/**
 * Weekly review plus clients and paid revenue.
 * Deal value and Won stay out of the revenue totals. Missing tables stay unavailable rather than zero.
 */
export function buildOwnerDashboard(facts: DashboardFacts): OwnerDashboard {
  const week = weekBounds(facts.today);
  const payments = facts.payments.available ? facts.payments.rows : null;
  return {
    today: facts.today,
    weekStart: week.start,
    weekEnd: week.end,
    timeZone: facts.timeZone,
    generatedAt: facts.generatedAt,
    leads: buildLeads(facts, week),
    clients: buildClients(facts, payments),
    revenue: buildRevenue(facts, week),
  };
}

/** The client rows the paying-client rule looks at. Exported for tests that want the same filter. */
export function payingClientIds(clients: readonly DashboardClient[], payments: readonly DashboardPayment[]): string[] {
  const paidIds = new Set(payments.filter((payment) => payment.clientId && isCollectedPayment(payment)).map((payment) => payment.clientId as string));
  return clients
    .filter((client) => isPayingClient({ archived: client.archived, lifetimeValue: client.lifetimeValue, paidRevenue: paidIds.has(client.id) }))
    .map((client) => client.id)
    .sort();
}
