import { describe, expect, it } from "vitest";
import {
  botTaskSourceReference,
  canonicalJson,
  decideClaim,
  isBotName,
  payloadHash,
  pendingIsStale,
  resolveRefs,
  taskSubmissionKey,
  UnresolvedRef,
} from "./rules";

describe("bot names", () => {
  it("accepts a short lowercase name and rejects anything else", () => {
    expect(isBotName("daily-crm")).toBe(true);
    expect(isBotName("a")).toBe(true);
    expect(isBotName("Daily")).toBe(false);
    expect(isBotName("has space")).toBe(false);
    expect(isBotName("")).toBe(false);
    expect(isBotName("a".repeat(41))).toBe(false);
  });
});

describe("canonical hash", () => {
  it("ignores object key order and changes when the operation changes", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    const left = payloadHash("lead.create", { name: "Ada", source: "Referral" });
    const right = payloadHash("lead.create", { source: "Referral", name: "Ada" });
    expect(left).toBe(right);
    expect(left).toHaveLength(64);
    expect(payloadHash("lead.update", { name: "Ada", source: "Referral" })).not.toBe(left);
  });
});

describe("refs", () => {
  it("replaces a ref object and leaves other values alone", () => {
    const ids = new Map([["day1-req", "11111111-1111-4111-8111-111111111111"]]);
    expect(resolveRefs({ requestId: { $ref: "day1-req" }, body: "Included." }, ids)).toEqual({
      requestId: "11111111-1111-4111-8111-111111111111",
      body: "Included.",
    });
  });
  it("refuses a ref that this batch has not produced", () => {
    expect(() => resolveRefs({ requestId: { $ref: "missing" } }, new Map())).toThrow(UnresolvedRef);
  });
});

describe("idempotency decisions", () => {
  const now = new Date("2026-11-19T12:00:00.000Z");
  const row = { status: "pending", payload_hash: "abc", result: null, created_at: "2026-11-19T11:59:30.000Z" };
  it("inserts when the key is new, replays a completed match, and conflicts on a different body", () => {
    expect(decideClaim(null, "abc", now).kind).toBe("insert");
    expect(decideClaim({ ...row, status: "completed", result: { id: "1" } }, "abc", now)).toEqual({ kind: "replay", result: { id: "1" } });
    expect(decideClaim(row, "other", now).kind).toBe("conflict");
  });
  it("waits on a fresh pending lock and takes over a stale one", () => {
    expect(decideClaim(row, "abc", now).kind).toBe("in_progress");
    expect(pendingIsStale(row.created_at, now)).toBe(false);
    const stale = { ...row, created_at: "2026-11-19T11:57:00.000Z" };
    expect(decideClaim(stale, "abc", now).kind).toBe("takeover");
  });
});

describe("task keys", () => {
  it("builds a stable submission key and a source reference that includes the bot", () => {
    expect(taskSubmissionKey("2026-11-19:task:1")).toMatch(/^[a-f0-9]{32}$/);
    expect(taskSubmissionKey("2026-11-19:task:1")).toBe(taskSubmissionKey("2026-11-19:task:1"));
    expect(botTaskSourceReference("daily-crm", "2026-11-19:task:1")).toBe("bot:daily-crm:2026-11-19:task:1");
  });
});
