export const TASK_STATUSES = ["ready", "in_progress", "waiting", "completed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface WorkTask {
  id: string;
  title: string;
  description: string | null;
  clientId: string | null;
  clientName: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  overdue: boolean;
  updatedAt: string;
}

export interface WorkRequest {
  id: string;
  displayId: string;
  title: string;
  clientId: string;
  clientName: string | null;
  status: string;
  priority: string | null;
  source: string | null;
  description: string | null;
  websiteUrl: string | null;
  createdAt: string;
}

export interface WorkProject {
  id: string;
  name: string | null;
  clientId: string | null;
  clientName: string | null;
  contractStatus: string;
  blockerNote: string | null;
  targetDate: string | null;
  launchedAt: string | null;
  framework: string | null;
}

export interface WorkOverview {
  today: string;
  tasks: WorkTask[];
  requests: WorkRequest[];
  projects: WorkProject[];
}

export const REQUEST_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const REQUEST_SOURCES = ["email", "phone_call", "text_message", "in_person", "other"] as const;
/** The values `requests_status_check` accepts. */
export const REQUEST_STATUSES = ["new", "in_review", "in_progress", "waiting_on_client", "completed"] as const;
/** included = in monthly care. addon = quoted separately. */
export const REQUEST_COVERAGE = ["included", "addon"] as const;

export const SOURCE_LABELS: Record<(typeof REQUEST_SOURCES)[number], string> = {
  email: "Email",
  phone_call: "Phone",
  text_message: "Text",
  in_person: "In person",
  other: "Other",
};

export interface ClientOption {
  id: string;
  name: string;
  /** The client's recorded website addresses, for the request's website field. */
  websites: string[];
}

export interface CreatedRequest {
  id: string;
  displayId: string;
  /** True when an identical request was just created, so no second one was made. */
  duplicate: boolean;
  /**
   * Whether `requests.coverage` was stored. Null when the caller did not classify the request.
   * False when the column is not in the database yet (migration 0010); the billable columns were still written.
   */
  coverageStored: boolean | null;
}

export interface CreatedTask {
  id: string;
  duplicate: boolean;
}
