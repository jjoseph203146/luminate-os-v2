// Job runner. Idempotent: a run is claimed by its key before any work happens.
import { isDue, manualKey, scheduledKey, type JobDef } from "./rules";

export interface JobRecord extends JobDef {
  name: string;
}

export type ClaimResult =
  | { claimed: true; runId: string; attempts: number }
  | { claimed: false; reason: "exists" | "backoff" | "exhausted" };

export interface JobStore {
  listJobs(): Promise<JobRecord[]>;
  claim(args: { jobKey: string; idempotencyKey: string; source: "schedule" | "manual"; now: Date }): Promise<ClaimResult>;
  finish(args: {
    runId: string;
    jobKey: string;
    status: "succeeded" | "failed";
    finishedAt: Date;
    error?: string;
    result?: Record<string, unknown>;
  }): Promise<void>;
}

export interface JobContext {
  now: Date;
  runId: string;
  attempt: number;
  /**
   * When the whole tick must be finished by (the function's time limit, minus a margin). Jobs run one after
   * another in one tick, so a slow job should check this before starting slow work and leave it for its next run.
   */
  deadline: Date;
}

/** All jobs of one tick share this budget; the route's maxDuration is 60 s. */
export const TICK_BUDGET_MS = 50_000;

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown> | void>;

export interface RunnerDeps {
  store: JobStore;
  handlers: Record<string, JobHandler>;
  clock?: () => Date;
}

export type JobOutcome =
  | { job: string; outcome: "succeeded" | "failed"; runId: string }
  | { job: string; outcome: "skipped"; reason: string };

export interface TickSummary {
  at: string;
  outcomes: JobOutcome[];
}

function safeMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.slice(0, 500);
}

async function execute(
  deps: RunnerDeps,
  job: JobRecord,
  idempotencyKey: string,
  source: "schedule" | "manual",
  now: Date,
): Promise<JobOutcome> {
  const clock = deps.clock ?? (() => new Date());
  const handler = deps.handlers[job.key];
  if (!handler) return { job: job.key, outcome: "skipped", reason: "no handler registered" };

  const claim = await deps.store.claim({ jobKey: job.key, idempotencyKey, source, now });
  if (!claim.claimed) return { job: job.key, outcome: "skipped", reason: claim.reason };

  try {
    const result = await handler({ now, runId: claim.runId, attempt: claim.attempts, deadline: new Date(now.getTime() + TICK_BUDGET_MS) });
    await deps.store.finish({
      runId: claim.runId,
      jobKey: job.key,
      status: "succeeded",
      finishedAt: clock(),
      result: result ?? {},
    });
    return { job: job.key, outcome: "succeeded", runId: claim.runId };
  } catch (err) {
    await deps.store.finish({
      runId: claim.runId,
      jobKey: job.key,
      status: "failed",
      finishedAt: clock(),
      error: safeMessage(err),
    });
    return { job: job.key, outcome: "failed", runId: claim.runId };
  }
}

/** Runs every enabled job that is due. Called by POST /api/jobs/tick. */
export async function runDueJobs(deps: RunnerDeps): Promise<TickSummary> {
  const now = (deps.clock ?? (() => new Date()))();
  const jobs = await deps.store.listJobs();
  const outcomes: JobOutcome[] = [];
  for (const job of jobs) {
    if (!isDue(job, now)) continue;
    outcomes.push(await execute(deps, job, scheduledKey(job.key, now, job.intervalMinutes), "schedule", now));
  }
  return { at: now.toISOString(), outcomes };
}

/** Owner-triggered re-run. Always a new run; never counts against the schedule. */
export async function runJobNow(deps: RunnerDeps, jobKey: string): Promise<JobOutcome> {
  const now = (deps.clock ?? (() => new Date()))();
  const job = (await deps.store.listJobs()).find((j) => j.key === jobKey);
  if (!job) return { job: jobKey, outcome: "skipped", reason: "unknown job" };
  return execute(deps, job, manualKey(job.key, now), "manual", now);
}
