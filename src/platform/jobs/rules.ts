// Pure scheduling rules for the job runner.

export const MAX_ATTEMPTS = 3;
export const LEASE_MINUTES = 10;

export interface JobDef {
  key: string;
  intervalMinutes: number;
  enabled: boolean;
  /** Finish time of the last successful run. */
  lastRunAt: Date | null;
}

const MINUTE = 60_000;

/** Start of the interval window that contains `now`. */
export function periodStart(now: Date, intervalMinutes: number): Date {
  const size = intervalMinutes * MINUTE;
  return new Date(Math.floor(now.getTime() / size) * size);
}

/** One run per job per window: the same key is the same run. */
export function scheduledKey(jobKey: string, now: Date, intervalMinutes: number): string {
  return `${jobKey}:${periodStart(now, intervalMinutes).toISOString()}`;
}

export function manualKey(jobKey: string, now: Date): string {
  return `${jobKey}:manual:${now.toISOString()}`;
}

export function isDue(job: JobDef, now: Date): boolean {
  if (!job.enabled) return false;
  if (!job.lastRunAt) return true;
  return job.lastRunAt.getTime() < periodStart(now, job.intervalMinutes).getTime();
}

/** Minutes to wait before retrying after `attempts` failures: 2, 4, 8 ... capped at 60. */
export function retryDelayMinutes(attempts: number): number {
  return Math.min(2 ** attempts, 60);
}

export interface ExistingRun {
  status: string;
  attempts: number;
  startedAt: Date;
  finishedAt: Date | null;
}

export type ReclaimDecision = "reclaim" | "exists" | "backoff" | "exhausted";

/** What to do when a run with the same idempotency key already exists. */
export function reclaimDecision(run: ExistingRun, now: Date): ReclaimDecision {
  if (run.status === "succeeded") return "exists";
  if (run.attempts >= MAX_ATTEMPTS) return "exhausted";
  if (run.status === "failed") {
    const finished = run.finishedAt ?? run.startedAt;
    const readyAt = finished.getTime() + retryDelayMinutes(run.attempts) * MINUTE;
    return now.getTime() >= readyAt ? "reclaim" : "backoff";
  }
  // Still marked running: only take over once the lease has clearly expired.
  return now.getTime() - run.startedAt.getTime() >= LEASE_MINUTES * MINUTE ? "reclaim" : "exists";
}

export type Freshness = "never" | "ok" | "stale";

/** Is a recurring job still running on schedule? Stale after three missed intervals. */
export function freshness(lastRunAt: Date | null, intervalMinutes: number, now: Date): Freshness {
  if (!lastRunAt) return "never";
  return now.getTime() - lastRunAt.getTime() > 3 * intervalMinutes * MINUTE ? "stale" : "ok";
}
