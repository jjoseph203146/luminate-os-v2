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

export function taskSourceReference(submissionKey: string, origin: "quick-add" | "bot" = "quick-add"): string {
  return `${origin}:${submissionKey}`;
}

export type RequestCoverage = "included" | "addon";

/**
 * Columns that record included-in-care vs add-on. `coverage` is new (migration 0010).
 * The other three columns already exist, so the classification survives when `coverage` is not there yet.
 * An unclassified request (the owner Quick Add) returns an empty object and does not touch those columns.
 */
export function requestBillingColumns(coverage: RequestCoverage | null, price: number | null): {
  coverage?: RequestCoverage;
  billable_flag?: boolean;
  counts_toward_quota?: boolean;
  estimated_charge?: number;
} {
  if (coverage === null) return {};
  if (coverage === "included") return { coverage, billable_flag: false, counts_toward_quota: true, estimated_charge: 0 };
  return { coverage: "addon", billable_flag: true, counts_toward_quota: false, estimated_charge: price ?? 0 };
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
