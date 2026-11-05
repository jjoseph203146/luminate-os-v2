// Pure rules for the work domain.
import { TASK_PRIORITIES } from "./types";

export const DISPLAY_ID_PATTERN = /^LUM-\d+$/;

/** The request number comes from the database sequence. Anything that does not look like one is rejected. */
export function isValidDisplayId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && DISPLAY_ID_PATTERN.test(value);
}

/** A repeat of the same request for the same client inside this window is treated as a double-tap. */
export const DUPLICATE_WINDOW_SECONDS = 120;

export function duplicateWindowStart(now: Date): string {
  return new Date(now.getTime() - DUPLICATE_WINDOW_SECONDS * 1000).toISOString();
}

export function taskSourceReference(submissionKey: string): string {
  return `quick-add:${submissionKey}`;
}

/** completed_at follows the status. */
export function completionFields(status: string, now: Date): { completed_at: string | null } {
  return { completed_at: status === "completed" ? now.toISOString() : null };
}

/** Higher number = more urgent. */
export function priorityRank(priority: string): number {
  const i = (TASK_PRIORITIES as readonly string[]).indexOf(priority);
  return i === -1 ? 0 : i;
}
