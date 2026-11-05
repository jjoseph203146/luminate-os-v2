import { describe, expect, it } from "vitest";
import { runDueJobs, runJobNow, type ClaimResult, type JobRecord, type JobStore } from "./runner";
import { reclaimDecision } from "./rules";

interface Run {
  id: string;
  key: string;
  jobKey: string;
  status: "running" | "succeeded" | "failed";
  attempts: number;
  startedAt: Date;
  finishedAt: Date | null;
  error?: string;
}

function fakeStore(jobs: JobRecord[]) {
  const runs: Run[] = [];
  const store: JobStore = {
    async listJobs() {
      return jobs.map((j) => ({ ...j }));
    },
    async claim({ jobKey, idempotencyKey, now }): Promise<ClaimResult> {
      const existing = runs.find((r) => r.key === idempotencyKey);
      if (!existing) {
        const run: Run = { id: `run-${runs.length + 1}`, key: idempotencyKey, jobKey, status: "running", attempts: 1, startedAt: now, finishedAt: null };
        runs.push(run);
        return { claimed: true, runId: run.id, attempts: 1 };
      }
      const decision = reclaimDecision(existing, now);
      if (decision !== "reclaim") return { claimed: false, reason: decision };
      existing.status = "running";
      existing.attempts += 1;
      existing.startedAt = now;
      existing.finishedAt = null;
      return { claimed: true, runId: existing.id, attempts: existing.attempts };
    },
    async finish({ runId, jobKey, status, finishedAt, error }) {
      const run = runs.find((r) => r.id === runId)!;
      run.status = status;
      run.finishedAt = finishedAt;
      run.error = error;
      if (status === "succeeded") {
        const job = jobs.find((j) => j.key === jobKey)!;
        job.lastRunAt = finishedAt;
      }
    },
  };
  return { store, runs };
}

const heartbeat = (): JobRecord => ({ key: "heartbeat", name: "Heartbeat", intervalMinutes: 5, enabled: true, lastRunAt: null });

describe("runDueJobs", () => {
  it("runs a due job once and not again in the same window", async () => {
    const { store, runs } = fakeStore([heartbeat()]);
    let calls = 0;
    const handlers = { heartbeat: async () => { calls++; return { ok: true }; } };
    let now = new Date("2026-11-04T10:06:00Z");
    const clock = () => now;

    const first = await runDueJobs({ store, handlers, clock });
    expect(first.outcomes).toEqual([{ job: "heartbeat", outcome: "succeeded", runId: "run-1" }]);

    now = new Date("2026-11-04T10:08:00Z");
    const second = await runDueJobs({ store, handlers, clock });
    expect(second.outcomes).toEqual([]);
    expect(calls).toBe(1);

    now = new Date("2026-11-04T10:11:00Z");
    await runDueJobs({ store, handlers, clock });
    expect(calls).toBe(2);
    expect(runs).toHaveLength(2);
  });

  it("does not run twice when two ticks overlap", async () => {
    const { store } = fakeStore([heartbeat()]);
    let calls = 0;
    const handlers = { heartbeat: async () => { calls++; await new Promise((r) => setTimeout(r, 10)); } };
    const clock = () => new Date("2026-11-04T10:06:00Z");
    // The second tick sees no lastRunAt yet, but the claim refuses the duplicate key.
    const [a, b] = await Promise.all([runDueJobs({ store, handlers, clock }), runDueJobs({ store, handlers, clock })]);
    expect(calls).toBe(1);
    const all = [...a.outcomes, ...b.outcomes];
    expect(all.filter((o) => o.outcome === "succeeded")).toHaveLength(1);
    expect(all.filter((o) => o.outcome === "skipped")).toHaveLength(1);
  });

  it("records a failure with a short message, then retries after the backoff", async () => {
    const { store, runs } = fakeStore([heartbeat()]);
    let fail = true;
    const handlers = { heartbeat: async () => { if (fail) throw new Error("boom ".repeat(200)); } };
    let now = new Date("2026-11-04T10:06:00Z");
    const clock = () => now;

    const first = await runDueJobs({ store, handlers, clock });
    expect(first.outcomes[0]).toMatchObject({ outcome: "failed" });
    expect(runs[0]?.error?.length).toBeLessThanOrEqual(500);

    now = new Date("2026-11-04T10:07:00Z"); // inside the 2-minute backoff
    const early = await runDueJobs({ store, handlers, clock });
    expect(early.outcomes[0]).toMatchObject({ outcome: "skipped", reason: "backoff" });

    fail = false;
    now = new Date("2026-11-04T10:08:30Z");
    const retry = await runDueJobs({ store, handlers, clock });
    expect(retry.outcomes[0]).toMatchObject({ outcome: "succeeded" });
    expect(runs[0]?.attempts).toBe(2);
  });

  it("skips disabled jobs and jobs with no handler", async () => {
    const { store } = fakeStore([{ ...heartbeat(), enabled: false }, { ...heartbeat(), key: "orphan" }]);
    const out = await runDueJobs({ store, handlers: {}, clock: () => new Date("2026-11-04T10:06:00Z") });
    expect(out.outcomes).toEqual([{ job: "orphan", outcome: "skipped", reason: "no handler registered" }]);
  });
});

describe("runJobNow", () => {
  it("always creates a new run", async () => {
    const { store, runs } = fakeStore([heartbeat()]);
    let now = new Date("2026-11-04T10:06:00Z");
    const deps = { store, handlers: { heartbeat: async () => ({}) }, clock: () => now };
    await runJobNow(deps, "heartbeat");
    now = new Date("2026-11-04T10:06:01Z");
    await runJobNow(deps, "heartbeat");
    expect(runs).toHaveLength(2);
  });
  it("reports an unknown job", async () => {
    const { store } = fakeStore([heartbeat()]);
    expect(await runJobNow({ store, handlers: {} }, "nope")).toEqual({ job: "nope", outcome: "skipped", reason: "unknown job" });
  });
});
