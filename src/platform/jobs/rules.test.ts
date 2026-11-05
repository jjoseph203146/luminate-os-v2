import { describe, expect, it } from "vitest";
import {
  freshness,
  isDue,
  manualKey,
  MAX_ATTEMPTS,
  periodStart,
  reclaimDecision,
  retryDelayMinutes,
  scheduledKey,
} from "./rules";

const t = (s: string) => new Date(s);

describe("periodStart and keys", () => {
  it("floors to the interval window", () => {
    expect(periodStart(t("2026-11-04T10:07:30Z"), 5).toISOString()).toBe("2026-11-04T10:05:00.000Z");
    expect(periodStart(t("2026-11-04T10:07:30Z"), 60).toISOString()).toBe("2026-11-04T10:00:00.000Z");
  });
  it("gives the same key within a window and a new key in the next", () => {
    const a = scheduledKey("heartbeat", t("2026-11-04T10:05:01Z"), 5);
    const b = scheduledKey("heartbeat", t("2026-11-04T10:09:59Z"), 5);
    const c = scheduledKey("heartbeat", t("2026-11-04T10:10:00Z"), 5);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it("makes manual keys unique per moment", () => {
    expect(manualKey("heartbeat", t("2026-11-04T10:00:00Z"))).not.toBe(manualKey("heartbeat", t("2026-11-04T10:00:01Z")));
  });
});

describe("isDue", () => {
  const base = { key: "heartbeat", intervalMinutes: 5, enabled: true };
  it("is due when never run", () => {
    expect(isDue({ ...base, lastRunAt: null }, t("2026-11-04T10:07:00Z"))).toBe(true);
  });
  it("is not due when already run in this window", () => {
    expect(isDue({ ...base, lastRunAt: t("2026-11-04T10:05:02Z") }, t("2026-11-04T10:07:00Z"))).toBe(false);
  });
  it("is due once a new window starts", () => {
    expect(isDue({ ...base, lastRunAt: t("2026-11-04T10:05:02Z") }, t("2026-11-04T10:10:01Z"))).toBe(true);
  });
  it("is never due when disabled", () => {
    expect(isDue({ ...base, enabled: false, lastRunAt: null }, t("2026-11-04T10:07:00Z"))).toBe(false);
  });
});

describe("retries", () => {
  it("backs off exponentially, capped at an hour", () => {
    expect(retryDelayMinutes(1)).toBe(2);
    expect(retryDelayMinutes(2)).toBe(4);
    expect(retryDelayMinutes(3)).toBe(8);
    expect(retryDelayMinutes(10)).toBe(60);
  });
  const now = t("2026-11-04T10:30:00Z");
  it("never re-runs a succeeded run", () => {
    expect(reclaimDecision({ status: "succeeded", attempts: 1, startedAt: t("2026-11-04T10:00:00Z"), finishedAt: t("2026-11-04T10:00:01Z") }, now)).toBe("exists");
  });
  it("waits out the backoff after a failure, then retries", () => {
    const failed = { status: "failed", attempts: 1, startedAt: t("2026-11-04T10:29:00Z"), finishedAt: t("2026-11-04T10:29:30Z") };
    expect(reclaimDecision(failed, now)).toBe("backoff");
    expect(reclaimDecision({ ...failed, finishedAt: t("2026-11-04T10:20:00Z") }, now)).toBe("reclaim");
  });
  it("stops after the maximum attempts", () => {
    expect(reclaimDecision({ status: "failed", attempts: MAX_ATTEMPTS, startedAt: t("2026-11-04T09:00:00Z"), finishedAt: t("2026-11-04T09:00:01Z") }, now)).toBe("exhausted");
  });
  it("leaves a fresh running run alone but takes over an expired lease", () => {
    expect(reclaimDecision({ status: "running", attempts: 1, startedAt: t("2026-11-04T10:25:00Z"), finishedAt: null }, now)).toBe("exists");
    expect(reclaimDecision({ status: "running", attempts: 1, startedAt: t("2026-11-04T10:00:00Z"), finishedAt: null }, now)).toBe("reclaim");
  });
});

describe("freshness", () => {
  const now = t("2026-11-04T10:30:00Z");
  it("reports never, ok and stale", () => {
    expect(freshness(null, 5, now)).toBe("never");
    expect(freshness(t("2026-11-04T10:20:00Z"), 5, now)).toBe("ok");
    expect(freshness(t("2026-11-04T10:00:00Z"), 5, now)).toBe("stale");
  });
});
