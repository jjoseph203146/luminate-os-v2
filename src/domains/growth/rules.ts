// Pure rules for the Growth screen. No database, easy to test.
import { STAGES, type GrowthSummary, type Lead, type Stage } from "./types";

/** The old app's lead status mapped to the new stages (open decision D4). */
const STATUS_TO_STAGE: Record<string, Stage> = {
  interested: "new_lead",
  contacted: "in_discussion",
  quoted: "proposal_sent",
  won: "won",
  lost: "lost",
};

export const STAGE_LABEL: Record<Stage, string> = {
  new_lead: "New lead",
  in_discussion: "In discussion",
  proposal_sent: "Proposal sent",
  won: "Won",
  lost: "Lost",
};

/** An unknown status is shown as a new lead rather than hidden. */
export function stageOf(status: string): Stage {
  return STATUS_TO_STAGE[status] ?? "new_lead";
}

export const isOpen = (l: Pick<Lead, "stage">) => l.stage !== "won" && l.stage !== "lost";

/** Whole calendar days from `today` to `date`: negative when the date has passed. */
export function daysUntil(date: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export type FollowUpState = "overdue" | "today" | "upcoming" | "none";

export function followUpState(lead: Pick<Lead, "followUpDate" | "stage">, today: string): FollowUpState {
  if (!isOpen(lead) || !lead.followUpDate) return "none";
  const d = daysUntil(lead.followUpDate, today);
  return d < 0 ? "overdue" : d === 0 ? "today" : "upcoming";
}

/** The short note under a lead's name, e.g. "Follow-up overdue · 1 day". */
export function followUpNote(lead: Pick<Lead, "followUpDate" | "stage" | "source">, today: string): string {
  const state = followUpState(lead, today);
  if (state === "none") return lead.stage === "won" ? "Won" : lead.stage === "lost" ? "Lost" : [lead.source, "No follow-up date"].filter(Boolean).join(" · ");
  const d = daysUntil(lead.followUpDate as string, today);
  if (state === "overdue") return `Follow-up overdue · ${-d} ${-d === 1 ? "day" : "days"}`;
  if (state === "today") return "Follow-up due today";
  return `Follow-up in ${d} ${d === 1 ? "day" : "days"}`;
}

/** Shorter form for list rows, e.g. "1 day overdue". */
export function followUpShort(lead: Pick<Lead, "followUpDate" | "stage" | "source">, today: string): string {
  const state = followUpState(lead, today);
  if (state === "none") return lead.stage === "won" || lead.stage === "lost" ? "" : (lead.source ?? "No follow-up date");
  const d = daysUntil(lead.followUpDate as string, today);
  if (state === "overdue") return `${-d} ${-d === 1 ? "day" : "days"} overdue`;
  if (state === "today") return "Follow up today";
  return `Follow up in ${d} ${d === 1 ? "day" : "days"}`;
}

export function summarize(leads: Lead[], today: string): GrowthSummary {
  const open = leads.filter(isOpen);
  const won = leads.filter((l) => l.stage === "won").length;
  const lost = leads.filter((l) => l.stage === "lost").length;
  const proposals = open.filter((l) => l.stage === "proposal_sent");
  const due = open.filter((l) => l.followUpDate !== null && l.followUpDate <= today);
  return {
    pipelineValue: open.reduce((sum, l) => sum + (l.value ?? 0), 0),
    unvalued: open.filter((l) => l.value === null).length,
    openCount: open.length,
    followUpsDue: due.length,
    followUpsOverdue: due.filter((l) => (l.followUpDate as string) < today).length,
    proposalsOut: proposals.length,
    proposalNames: proposals.map((l) => l.businessName),
    won,
    lost,
    winRate: won + lost === 0 ? null : Math.round((won / (won + lost)) * 100),
    stages: STAGES.filter((s) => s !== "lost").map((stage) => ({ stage, count: leads.filter((l) => l.stage === stage).length })),
  };
}

/** Open leads with a follow-up due today or earlier, most overdue first. */
export function dueNow(leads: Lead[], today: string): Lead[] {
  return leads
    .filter((l) => isOpen(l) && l.followUpDate !== null && l.followUpDate <= today)
    .sort((a, b) => (a.followUpDate as string).localeCompare(b.followUpDate as string));
}

/** Open leads: follow-ups first (soonest), then the rest by newest. */
export function sortOpen(leads: Lead[]): Lead[] {
  return leads
    .filter(isOpen)
    .sort((a, b) => (a.followUpDate ?? "9999-12-31").localeCompare(b.followUpDate ?? "9999-12-31") || b.createdAt.localeCompare(a.createdAt));
}
