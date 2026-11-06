// Pure rules for the Growth screen. No database, easy to test.
import { WEBSITE_SOURCE } from "./intake";
import { STAGES, type GrowthSummary, type Lead, type LeadStatus, type Stage } from "./types";

/** The old app's lead status mapped to the new stages (open decision D4). */
export const STATUS_TO_STAGE: Record<string, Stage> = {
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

/**
 * The value written to `leads.status` for a stage. The database only accepts the old app's five values
 * (leads_status_check), and that check cannot change while the old app shares the database.
 */
export const STAGE_TO_STATUS: Record<Stage, LeadStatus> = {
  new_lead: "interested",
  in_discussion: "contacted",
  proposal_sent: "quoted",
  won: "won",
  lost: "lost",
};

export function statusOf(stage: Stage): LeadStatus {
  return STAGE_TO_STATUS[stage];
}

/** The old app's suggested sources. Source is free text in the database, so any other value still saves. */
export const LEAD_SOURCES = ["Referral", "Website", WEBSITE_SOURCE, "Social Media", "Cold Outreach", "Networking", "Existing Client", "Other"] as const;

/** The editable fields of a lead, as saved. */
export interface LeadFields {
  name: string;
  businessName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  followUpDate: string | null;
  source: string | null;
  value: number | null;
}

export const LEAD_FIELDS = ["name", "businessName", "email", "phone", "notes", "followUpDate", "source", "value"] as const satisfies readonly (keyof LeadFields)[];

/** The NAMES of the fields an edit changes (the audit log records names, never contact details). */
export function changedLeadFields(before: LeadFields, after: LeadFields): (keyof LeadFields)[] {
  return LEAD_FIELDS.filter((k) => (before[k] ?? null) !== (after[k] ?? null));
}

/** The message after a stage change. */
export function stageMessage(r: { stage: Stage; changed: boolean }): string {
  return r.changed ? `Moved to ${STAGE_LABEL[r.stage]}.` : `Already in ${STAGE_LABEL[r.stage]}.`;
}

/** The message after an edit. */
export function leadSavedMessage(changed: readonly string[]): string {
  return changed.length === 0 ? "Nothing changed." : "Lead saved.";
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
