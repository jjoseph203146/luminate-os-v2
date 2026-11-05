export type AttentionKind =
  | "payment_failed"
  | "past_due"
  | "site_down"
  | "site_slow"
  | "site_stale"
  | "request"
  | "task"
  | "blocker";

export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  /** 1 = most urgent. */
  severity: 1 | 2 | 3 | 4;
  title: string;
  detail: string;
  clientName: string | null;
  /** Every item links to a record. */
  href: string;
  /** When the underlying record last changed or was last checked. Shown as its age. */
  asOf: string | null;
}

export interface BusinessTodo {
  id: string;
  title: string;
  priority: string;
  status: string;
  dueDate: string | null;
  overdue: boolean;
}

export interface RevenueSummary {
  /** Sum of plan prices for active and past-due clients. Not collected money. */
  planTotal: number;
  paidThisMonth: number;
  paidThisMonthCount: number;
  latestPaidAt: string | null;
  failedLast30Days: number;
  pendingCount: number;
}

export interface TodayData {
  today: string;
  timeZone: string;
  attention: AttentionItem[];
  attentionTotal: number;
  todos: BusinessTodo[];
  revenue: RevenueSummary;
  generatedAt: string;
}
