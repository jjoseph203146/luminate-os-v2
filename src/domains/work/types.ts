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
  createdAt: string;
}

export interface WorkOverview {
  today: string;
  tasks: WorkTask[];
  requests: WorkRequest[];
}

export interface ClientOption {
  id: string;
  name: string;
}

export interface CreatedRequest {
  id: string;
  displayId: string;
  /** True when an identical request was just created, so no second one was made. */
  duplicate: boolean;
}

export interface CreatedTask {
  id: string;
  duplicate: boolean;
}
