export const STAGES = ["new_lead", "in_discussion", "proposal_sent", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];

/** The values the database accepts in `leads.status` (leads_status_check). */
export const LEAD_STATUSES = ["interested", "contacted", "quoted", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

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
