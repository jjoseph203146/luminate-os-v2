import { describe, expect, it } from "vitest";
import { completionFields, duplicateWindowStart, isValidDisplayId, priorityRank, taskSourceReference } from "./rules";
import { createRequestSchema, createTaskSchema, taskStatusSchema } from "./schemas";

const uuid = "123e4567-e89b-42d3-a456-426614174000";

describe("isValidDisplayId", () => {
  it("accepts LUM-number only", () => {
    expect(isValidDisplayId("LUM-1051")).toBe(true);
    expect(isValidDisplayId("LUM-1780000000000")).toBe(true);
    expect(isValidDisplayId("LUM-")).toBe(false);
    expect(isValidDisplayId("1051")).toBe(false);
    expect(isValidDisplayId("LUM-1; drop")).toBe(false);
    expect(isValidDisplayId(null)).toBe(false);
  });
});

describe("rules", () => {
  it("sets completed_at only for completed", () => {
    const now = new Date("2026-11-05T00:00:00Z");
    expect(completionFields("completed", now).completed_at).toBe("2026-11-05T00:00:00.000Z");
    expect(completionFields("ready", now).completed_at).toBeNull();
  });
  it("computes the duplicate window and source reference", () => {
    expect(duplicateWindowStart(new Date("2026-11-05T00:02:00Z"))).toBe("2026-11-05T00:00:00.000Z");
    expect(taskSourceReference("abc12345")).toBe("quick-add:abc12345");
  });
  it("ranks urgent above low", () => {
    expect(priorityRank("urgent")).toBeGreaterThan(priorityRank("low"));
  });
});

describe("createRequestSchema", () => {
  it("accepts a valid request and blanks an empty description", () => {
    const r = createRequestSchema.parse({ clientId: uuid, title: "  Update hours  ", description: "  " });
    expect(r.title).toBe("Update hours");
    expect(r.description).toBeNull();
  });
  it("accepts priority, source and website, and blanks them when empty", () => {
    const r = createRequestSchema.parse({ clientId: uuid, title: "Fix form", priority: "urgent", source: "text_message", websiteUrl: "a.com" });
    expect(r.priority).toBe("urgent");
    expect(r.source).toBe("text_message");
    expect(r.websiteUrl).toBe("a.com");
    const blank = createRequestSchema.parse({ clientId: uuid, title: "Fix form", priority: "", source: "", websiteUrl: "" });
    expect(blank.priority).toBeNull();
    expect(blank.source).toBeNull();
    expect(blank.websiteUrl).toBeNull();
  });
  it("rejects unknown priority and source", () => {
    expect(createRequestSchema.safeParse({ clientId: uuid, title: "Fix form", priority: "asap" }).success).toBe(false);
    expect(createRequestSchema.safeParse({ clientId: uuid, title: "Fix form", source: "carrier pigeon" }).success).toBe(false);
  });
  it("rejects a missing client, short title and long text", () => {
    expect(createRequestSchema.safeParse({ clientId: "", title: "Update" }).success).toBe(false);
    expect(createRequestSchema.safeParse({ clientId: uuid, title: "ab" }).success).toBe(false);
    expect(createRequestSchema.safeParse({ clientId: uuid, title: "ok title", description: "x".repeat(4001) }).success).toBe(false);
  });
});

describe("createTaskSchema", () => {
  const base = { title: "Renew domain", submissionKey: "abcd-1234-efgh" };
  it("defaults priority and allows no client and no date", () => {
    const t = createTaskSchema.parse({ ...base, clientId: "", dueDate: "" });
    expect(t.priority).toBe("normal");
    expect(t.clientId).toBeNull();
    expect(t.dueDate).toBeNull();
  });
  it("rejects bad dates, priorities and keys", () => {
    expect(createTaskSchema.safeParse({ ...base, dueDate: "2026-02-31" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...base, priority: "asap" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...base, submissionKey: "x y" }).success).toBe(false);
  });
});

describe("taskStatusSchema", () => {
  it("accepts known statuses only", () => {
    expect(taskStatusSchema.safeParse({ id: uuid, status: "completed" }).success).toBe(true);
    expect(taskStatusSchema.safeParse({ id: uuid, status: "done" }).success).toBe(false);
  });
});
