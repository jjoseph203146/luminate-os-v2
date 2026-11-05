// Automation domain: job history, manual re-run, and the scheduler tick.
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { writeAudit } from "@/platform/audit/audit";
import { createUserClient } from "@/platform/db/server";
import { RuleError } from "@/platform/errors";
import { handlers } from "@/platform/jobs/registry";
import { runDueJobs, runJobNow, type TickSummary } from "@/platform/jobs/runner";
import { freshness, type Freshness } from "@/platform/jobs/rules";
import { createJobStore } from "@/platform/jobs/store";
import { getCalendar } from "@/domains/admin/service";

type Owner = Extract<Actor, { type: "owner" }>;

export interface JobView {
  key: string;
  name: string;
  description: string | null;
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt: string | null;
  freshness: Freshness;
}

export interface JobRunView {
  id: string;
  jobKey: string;
  status: string;
  attempts: number;
  startedAt: string;
  finishedAt: string | null;
  triggerSource: string;
  error: string | null;
}

export async function listJobs(actor: Actor): Promise<JobView[]> {
  assertCan(actor, "jobs.read");
  const db = await createUserClient();
  const { data, error } = await db.from("jobs").select("key, name, description, interval_minutes, enabled, last_run_at").order("key");
  if (error) throw new Error("Could not read jobs");
  const now = new Date();
  return data.map((j) => ({
    key: j.key,
    name: j.name,
    description: j.description,
    intervalMinutes: j.interval_minutes,
    enabled: j.enabled,
    lastRunAt: j.last_run_at,
    freshness: freshness(j.last_run_at ? new Date(j.last_run_at) : null, j.interval_minutes, now),
  }));
}

export async function listRuns(actor: Actor, opts: { jobKey?: string | null; limit?: number } = {}): Promise<{ runs: JobRunView[]; timeZone: string }> {
  assertCan(actor, "jobs.read");
  const db = await createUserClient();
  let q = db
    .from("job_runs")
    .select("id, job_key, status, attempts, started_at, finished_at, trigger_source, error")
    .order("started_at", { ascending: false })
    .limit(Math.min(opts.limit ?? 50, 200));
  if (opts.jobKey) q = q.eq("job_key", opts.jobKey);
  const [runs, cal] = await Promise.all([q, getCalendar(actor)]);
  if (runs.error) throw new Error("Could not read job runs");
  return {
    timeZone: cal.timeZone,
    runs: runs.data.map((r) => ({
      id: r.id,
      jobKey: r.job_key,
      status: r.status,
      attempts: r.attempts,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      triggerSource: r.trigger_source,
      error: r.error,
    })),
  };
}

/** Owner re-run of one job, outside the schedule. */
export async function runNow(actor: Owner, jobKey: string): Promise<{ outcome: string }> {
  assertCan(actor, "jobs.run");
  const outcome = await runJobNow({ store: createJobStore(), handlers }, jobKey);
  if (outcome.outcome === "skipped") throw new RuleError(`The job was not run: ${outcome.reason}.`);
  await writeAudit(actor, {
    action: "job.run_manual",
    entityType: "job",
    entityId: jobKey,
    after: { outcome: outcome.outcome },
  });
  return { outcome: outcome.outcome };
}

/** Called by the scheduler through POST /api/jobs/tick as the system actor. */
export async function tick(actor: Actor): Promise<TickSummary> {
  assertCan(actor, "jobs.run");
  return runDueJobs({ store: createJobStore(), handlers });
}
