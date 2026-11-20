// Read-only owner dashboard (SOP2 §8 weekly review, plus clients and paid revenue).
import type { Stage } from "@/domains/growth/types";

/** How many attention rows the page lists before "and N more". */
export const DASHBOARD_LIST_LIMIT = 8;
/** Open leads with no engagement for this many calendar days are stale. Never auto-closed. */
export const STALE_AFTER_DAYS = 30;

export interface DashboardLead {
  id: string;
  businessName: string;
  stage: Stage;
  source: string | null;
  /** Recorded deal value in dollars. Not revenue. */
  value: number | null;
  createdAt: string;
  followUpDate: string | null;
  clientId: string | null;
  stageChangedAt: string | null;
  lastTouchAt: string | null;
  nextStep: string | null;
  nextStepOn: string | null;
  /** Raw `lost_reason`. Null when unset or when the column was not read. */
  lostReason: string | null;
  kind: string | null;
}

export interface DashboardClient {
  id: string;
  businessName: string;
  archived: boolean;
  lifetimeValue: number;
}

export interface DashboardPayment {
  amount: number;
  status: string;
  paidAt: string | null;
  clientId: string | null;
}

export type LeadsLoad =
  | { available: false }
  | { available: true; pipelineAvailable: boolean; truncated: boolean; rows: DashboardLead[] };

export type ClientsLoad = { available: false } | { available: true; truncated: boolean; rows: DashboardClient[] };

export type PaymentsLoad = { available: false } | { available: true; truncated: boolean; rows: DashboardPayment[] };

export interface DashboardFacts {
  today: string;
  timeZone: string;
  generatedAt: string;
  leads: LeadsLoad;
  clients: ClientsLoad;
  payments: PaymentsLoad;
}

export interface NamedCount {
  label: string;
  count: number;
}

export interface StageCount {
  stage: Stage;
  count: number;
  /** Leads currently in this stage whose stage last changed this week. Null when pipeline columns were not read. */
  changedThisWeek: number | null;
}

export interface LeadLine {
  id: string;
  businessName: string;
  stage: Stage;
  detail: string;
  href: string;
  due: "overdue" | "today" | "stale" | "won";
}

export interface LeadReview {
  available: true;
  /** False when migration 0011 columns could not be read. Stage counts still use `leads.status`. */
  pipelineAvailable: boolean;
  truncated: boolean;
  stages: StageCount[];
  newThisWeek: number;
  newBySource: NamedCount[];
  /** Null when kind was not read. Counts cover leads created this week. */
  newByKind: { inbound: number; outbound: number; unset: number } | null;
  openCount: number;
  /** Sum of recorded deal values on open leads. Never revenue. */
  openValue: number;
  openUnvalued: number;
  proposalsOut: number;
  proposalNames: string[];
  won: number;
  lost: number;
  /** Null when stage_changed_at was not read. */
  wonThisWeek: number | null;
  /** Won leads with no stage_changed_at. Null when that column was not read. */
  wonWithoutStageTime: number | null;
  /** Won / (won + lost), as a whole percent. Null when nothing is closed. */
  winRate: number | null;
  /** Sum of recorded deal values on Won leads. Not revenue. */
  wonValue: number;
  followUpsOverdue: number;
  followUpsDueToday: number;
  followUps: LeadLine[];
  followUpTotal: number;
  nextStepsOverdue: number | null;
  nextStepsDueToday: number | null;
  nextSteps: LeadLine[] | null;
  nextStepTotal: number | null;
  staleCount: number | null;
  staleLeads: LeadLine[] | null;
  lostReasons: NamedCount[] | null;
  linked: number | null;
  wonLinked: number | null;
  wonUnlinked: LeadLine[] | null;
  wonUnlinkedTotal: number | null;
}

export interface ClientReview {
  available: true;
  truncated: boolean;
  /** Not archived. Includes past due, paused and onboarding. */
  active: number;
  archived: number;
  /** Null when paid payments could not be read, so the paying-client rule cannot be applied. */
  paying: number | null;
  activeNotPaying: number | null;
}

export interface RevenueReview {
  available: true;
  truncated: boolean;
  /** Paid payments with amount > 0. Pending, failed, zero and Won are not included. */
  collectedAllTime: number;
  collectedThisMonth: number;
  collectedThisWeek: number;
  paidCount: number;
  /** Paid and amount > 0, but no paid_at. Counted in the all-time total only. */
  undated: number;
}

export interface OwnerDashboard {
  today: string;
  /** Monday of the calendar week that contains `today`, business time zone. */
  weekStart: string;
  /** Sunday of that week. */
  weekEnd: string;
  timeZone: string;
  generatedAt: string;
  leads: { available: false } | LeadReview;
  clients: { available: false } | ClientReview;
  revenue: { available: false } | RevenueReview;
}
