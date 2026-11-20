export const STAGES = ["new_lead", "in_discussion", "proposal_sent", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];

/** The values the database accepts in `leads.status` (leads_status_check). */
export const LEAD_STATUSES = ["interested", "contacted", "quoted", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Doc 05. Null when the lead was not classified. */
export const LEAD_KINDS = ["inbound", "outbound"] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];

/** Why a lead was lost (doc 05). Null on older lost rows. */
export const LOST_REASONS = ["price", "timing", "competitor", "unresponsive", "not_fit", "other"] as const;
export type LostReason = (typeof LOST_REASONS)[number];

/** lead_activities.kind. `stage` is this step's addition to the doc 05 list (email, call, meeting, note, outreach). */
export const ACTIVITY_KINDS = ["email", "call", "meeting", "note", "outreach", "stage"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_DIRECTIONS = ["inbound", "outbound"] as const;
export type ActivityDirection = (typeof ACTIVITY_DIRECTIONS)[number];

export interface Lead {
  id: string;
  name: string;
  businessName: string;
  email: string | null;
  phone: string | null;
  stage: Stage;
  /** ISO date (yyyy-mm-dd) or null. */
  followUpDate: string | null;
  notes: string | null;
  source: string | null;
  /** Deal value in dollars. Null when none is recorded. */
  value: number | null;
  createdAt: string;
  /** Set once the lead is Won and linked. Missing on callers that only have the older fields. */
  clientId?: string | null;
  stageChangedAt?: string | null;
  lastTouchAt?: string | null;
  nextStep?: string | null;
  /** ISO date (yyyy-mm-dd) or null. */
  nextStepOn?: string | null;
  lostReason?: LostReason | null;
  kind?: LeadKind | null;
  campaign?: string | null;
}

export interface GrowthSummary {
  /** Sum of recorded deal values on open leads. Deal value, never revenue. */
  pipelineValue: number;
  /** Open leads with no value recorded (so the total may be low). */
  unvalued: number;
  openCount: number;
  followUpsDue: number;
  followUpsOverdue: number;
  proposalsOut: number;
  proposalNames: string[];
  won: number;
  lost: number;
  /** Won / (won + lost) as a whole percent, or null when nothing is closed yet. */
  winRate: number | null;
  stages: { stage: Stage; count: number }[];
}

export interface GrowthOverview {
  today: string;
  leads: Lead[];
  summary: GrowthSummary;
  /** Open leads whose follow-up is due today or earlier, most overdue first. */
  dueNow: Lead[];
}

export interface SavedLead {
  id: string;
  /** True when the same lead was just saved (a double tap or retry): nothing new was made. */
  duplicate: boolean;
}
