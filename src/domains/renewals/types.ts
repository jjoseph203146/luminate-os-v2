// SOP billing tasks (docs/architecture/17-billing-tasks.md). Dates are New York calendar dates (YYYY-MM-DD).

export type InvoiceSender = "luminate" | "stripe_invoice" | "stripe_autopay";
export type AgreementStatus = "active" | "paused" | "cancelled";
export type CycleStatus = "open" | "paid" | "paid_manual" | "cancelled";
export type Milestone = "send_invoice" | "verify_payment" | "friendly_reminder" | "grace_review";
export type ActionStatus = "open" | "done" | "resolved" | "cancelled";
/** "stripe": kept in step with the client's Stripe subscription by the billing job. "manual": set by the owner. */
export type ScheduleSource = "stripe" | "manual";

export interface Agreement {
  id: string;
  clientId: string;
  planName: string | null;
  monthlyPriceCents: number;
  anniversaryDay: number;
  startsOn: string;
  status: AgreementStatus;
  invoiceSender: InvoiceSender;
  paymentLinkUrl: string | null;
  tasksFrom: string;
  source: ScheduleSource;
  stripeSubscriptionId: string | null;
}

/** An agreement with what the planner needs to know about its client. */
export interface PlannerAgreement extends Agreement {
  clientArchived: boolean;
  /** clients.status = 'paused' (the Stripe subscription ended): treated like a paused plan. */
  clientPaused: boolean;
}

export interface Cycle {
  id: string;
  agreementId: string;
  clientId: string;
  dueOn: string;
  amountCents: number;
  planName: string | null;
  invoiceSender: InvoiceSender;
  status: CycleStatus;
  paidAt: string | null;
  invoiceSentAt: string | null;
  reminderSentAt: string | null;
}

export interface Action {
  id: string;
  cycleId: string;
  clientId: string;
  milestone: Milestone;
  dueOn: string;
  actionKey: string;
  status: ActionStatus;
  workItemId: string | null;
  /** The linked task was completed (for example ticked off on the Work page). */
  workItemCompleted: boolean;
}

/** A verified payment (revenue_events, status paid: written only by the signed Stripe webhook or Sync from Stripe). */
export interface VerifiedPayment {
  id: string;
  clientId: string;
  amountCents: number;
  paidAt: string;
  eventType: string;
}

/** One billing task as the Today screen and the client Billing tab show it. */
export interface BillingTask {
  actionId: string;
  cycleId: string;
  clientId: string;
  clientName: string;
  milestone: Milestone;
  title: string;
  dueOn: string;
  cycleDueOn: string;
  amountCents: number;
  priority: "normal" | "high" | "urgent";
  overdue: boolean;
  invoiceSender: InvoiceSender;
  invoiceSentAt: string | null;
  reminderSentAt: string | null;
  /** Where "Open invoice / payment link" goes, or null when there is nowhere to go. */
  invoiceHref: string | null;
}

export interface BillingHealth {
  /** "ok", "stale" (no successful run for 3 hours), "failing" (last run failed), "never" (never ran), "not_set_up". */
  state: "ok" | "stale" | "failing" | "never" | "not_set_up";
  lastSuccessAt: string | null;
}

export interface NextPayment {
  clientId: string;
  clientName: string;
  amountCents: number;
  date: string;
  invoiceSender: InvoiceSender;
  /** More renewals on the same day. */
  sameDay: number;
}

export interface BillingToday {
  tasks: BillingTask[];
  /** The next renewal expected (from the billing schedules, which follow Stripe), or null when there is none. */
  nextPayment: NextPayment | null;
  /** Active clients with a plan price but no billing schedule (no Stripe subscription found): no billing tasks for them. */
  missingSchedules: { clientId: string; clientName: string }[];
  health: BillingHealth;
}

export interface ClientBilling {
  agreement: Agreement | null;
  /** Suggested values for a new schedule, from the client record (to confirm, never applied by themselves). */
  suggestion: { planName: string | null; monthlyPriceCents: number; anniversaryDay: number | null; startsOn: string | null };
  cycles: (Cycle & { manualAmountCents: number | null; manualMethod: string | null; manualNote: string | null; invoiceUrl: string | null })[];
  tasks: BillingTask[];
  nextRenewal: string | null;
  hasStripeCustomer: boolean;
  available: boolean;
}
