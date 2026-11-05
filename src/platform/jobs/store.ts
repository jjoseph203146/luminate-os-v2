// Supabase-backed job store. Uses the service-role client (system actor only).
import type { Json } from "@/types/database";
import { createAdminClient } from "@/platform/db/server";
import type { ClaimResult, JobRecord, JobStore } from "./runner";
import { reclaimDecision } from "./rules";

export function createJobStore(): JobStore {
  const db = createAdminClient();

  return {
    async listJobs(): Promise<JobRecord[]> {
      const { data, error } = await db.from("jobs").select("key, name, interval_minutes, enabled, last_run_at").order("key");
      if (error) throw new Error("Could not read jobs");
      return (data ?? []).map((j) => ({
        key: j.key,
        name: j.name,
        intervalMinutes: j.interval_minutes,
        enabled: j.enabled,
        lastRunAt: j.last_run_at ? new Date(j.last_run_at) : null,
      }));
    },

    async claim({ jobKey, idempotencyKey, source, now }): Promise<ClaimResult> {
      const inserted = await db
        .from("job_runs")
        .insert({ job_key: jobKey, idempotency_key: idempotencyKey, trigger_source: source, started_at: now.toISOString() })
        .select("id, attempts")
        .single();
      if (!inserted.error) return { claimed: true, runId: inserted.data.id, attempts: inserted.data.attempts };
      if (inserted.error.code !== "23505") throw new Error("Could not start job run");

      const existing = await db
        .from("job_runs")
        .select("id, status, attempts, started_at, finished_at")
        .eq("idempotency_key", idempotencyKey)
        .single();
      if (existing.error) throw new Error("Could not read job run");
      const run = existing.data;
      const decision = reclaimDecision(
        {
          status: run.status,
          attempts: run.attempts,
          startedAt: new Date(run.started_at),
          finishedAt: run.finished_at ? new Date(run.finished_at) : null,
        },
        now,
      );
      if (decision !== "reclaim") return { claimed: false, reason: decision };

      // Conditional update: only one caller can win the takeover.
      const taken = await db
        .from("job_runs")
        .update({ status: "running", attempts: run.attempts + 1, started_at: now.toISOString(), finished_at: null, error: null })
        .eq("id", run.id)
        .eq("status", run.status)
        .eq("attempts", run.attempts)
        .select("id, attempts")
        .maybeSingle();
      if (taken.error) throw new Error("Could not restart job run");
      if (!taken.data) return { claimed: false, reason: "exists" };
      return { claimed: true, runId: taken.data.id, attempts: taken.data.attempts };
    },

    async finish({ runId, jobKey, status, finishedAt, error, result }) {
      const update = await db
        .from("job_runs")
        .update({
          status,
          finished_at: finishedAt.toISOString(),
          error: error ?? null,
          result: (result ?? null) as Json | null,
        })
        .eq("id", runId);
      if (update.error) throw new Error("Could not record job result");
      if (status === "succeeded") {
        const job = await db.from("jobs").update({ last_run_at: finishedAt.toISOString() }).eq("key", jobKey);
        if (job.error) throw new Error("Could not update job");
      }
    },
  };
}
