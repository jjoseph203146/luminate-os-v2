import { describe, expect, it } from "vitest";
import { buildAuditRow, minimizeForAudit } from "./audit";
import type { Actor } from "@/platform/auth/types";

const owner: Actor = { type: "owner", userId: "11111111-1111-4111-8111-111111111111", email: "o@example.com", ip: "203.0.113.5" };

describe("minimizeForAudit", () => {
  it("redacts secret-looking keys at any depth", () => {
    const out = minimizeForAudit({ name: "x", password: "p", nested: { apiKey: "k", ok: 1 } });
    expect(out).toEqual({ name: "x", password: "[redacted]", nested: { apiKey: "[redacted]", ok: 1 } });
  });
  it("truncates long strings and long arrays", () => {
    const out = minimizeForAudit({ text: "a".repeat(600), list: Array.from({ length: 80 }, (_, i) => i) }) as {
      text: string;
      list: unknown[];
    };
    expect(out.text.length).toBe(503);
    expect(out.list).toHaveLength(50);
  });
  it("returns null for null and undefined", () => {
    expect(minimizeForAudit(null)).toBeNull();
    expect(minimizeForAudit(undefined)).toBeNull();
  });
  it("stops at a depth limit", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(JSON.stringify(minimizeForAudit(deep))).toContain("[truncated]");
  });
});

describe("buildAuditRow", () => {
  it("records the owner and request address", () => {
    const row = buildAuditRow(owner, { action: "x.updated", entityType: "x", entityId: "1", before: { a: 1 }, after: { a: 2 } });
    expect(row).toMatchObject({ actor_type: "owner", actor_id: owner.type === "owner" ? owner.userId : null, request_ip: "203.0.113.5", entity_id: "1" });
  });
  it("records system actors without an id", () => {
    const row = buildAuditRow({ type: "system", name: "jobs" }, { action: "job.run", entityType: "job" });
    expect(row).toMatchObject({ actor_type: "system", actor_id: null, request_ip: null, entity_id: null });
  });
});
