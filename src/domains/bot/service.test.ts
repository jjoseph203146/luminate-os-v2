import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createLead: vi.fn(),
  patchLead: vi.fn(),
  createClientNote: vi.fn(),
  updateClientNote: vi.fn(),
  createRequest: vi.fn(),
  addRequestComment: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  probeStore: vi.fn(),
  readKey: vi.fn(),
  insertPending: vi.fn(),
  takeOver: vi.fn(),
  completeKey: vi.fn(),
  deletePending: vi.fn(),
}));

vi.mock("@/domains/growth/service", () => ({ createLead: mocks.createLead, patchLead: mocks.patchLead }));
vi.mock("@/domains/clients/service", () => ({ createClientNote: mocks.createClientNote, updateClientNote: mocks.updateClientNote }));
vi.mock("@/domains/work/service", () => ({
  createRequest: mocks.createRequest,
  addRequestComment: mocks.addRequestComment,
  createTask: mocks.createTask,
  updateTask: mocks.updateTask,
}));
vi.mock("./repo", () => ({
  probeStore: mocks.probeStore,
  readKey: mocks.readKey,
  insertPending: mocks.insertPending,
  takeOver: mocks.takeOver,
  completeKey: mocks.completeKey,
  deletePending: mocks.deletePending,
}));
vi.mock("@/platform/db/server", () => ({ createAdminClient: () => ({ tag: "admin" }) }));

import { applyBatch, BotStoreNotReadyError } from "./service";
import { payloadHash } from "./rules";
import { PermissionError, ValidationError } from "@/platform/errors";
import type { Actor } from "@/platform/auth/types";

const bot: Actor = { type: "bot", name: "daily-crm", ip: "203.0.113.9" };
const ai: Actor = { type: "ai", name: "mcp" };
const LEAD = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";

function op(idempotencyKey: string, name: string, input: unknown) {
  return { idempotencyKey, op: name, input };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.probeStore.mockResolvedValue("ready");
  mocks.readKey.mockResolvedValue(null);
  mocks.insertPending.mockResolvedValue("inserted");
  mocks.completeKey.mockResolvedValue(true);
  mocks.deletePending.mockResolvedValue(undefined);
  mocks.createLead.mockResolvedValue({ id: LEAD, duplicate: false });
  mocks.createRequest.mockResolvedValue({ id: REQUEST, displayId: "LUM-20", duplicate: false, coverageStored: true });
  mocks.addRequestComment.mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333" });
  mocks.createTask.mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444", duplicate: false });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("applyBatch", () => {
  it("refuses the read-only ai actor before it touches the store", async () => {
    await expect(applyBatch(ai, { operations: [op("2026-11-19:lead:1", "lead.create", { name: "Ada" })] })).rejects.toBeInstanceOf(PermissionError);
    expect(mocks.probeStore).not.toHaveBeenCalled();
    expect(mocks.createLead).not.toHaveBeenCalled();
  });

  it("refuses to write when migration 0010 is not visible", async () => {
    mocks.probeStore.mockResolvedValue("missing");
    await expect(applyBatch(bot, { operations: [op("2026-11-19:lead:1", "lead.create", { name: "Ada" })] })).rejects.toBeInstanceOf(BotStoreNotReadyError);
    expect(mocks.createLead).not.toHaveBeenCalled();
  });

  it("creates a lead as the bot and stores the idempotency result", async () => {
    const input = { name: "Ada" };
    const { results } = await applyBatch(bot, { operations: [op("2026-11-19:lead:1", "lead.create", input)] });
    expect(results).toEqual([
      { idempotencyKey: "2026-11-19:lead:1", op: "lead.create", replayed: false, idempotencyRecorded: true, ok: true, id: LEAD, duplicate: false },
    ]);
    expect(mocks.createLead).toHaveBeenCalledWith(bot, input, expect.any(Date));
    expect(mocks.insertPending).toHaveBeenCalledWith({ tag: "admin" }, expect.objectContaining({ botName: "daily-crm", key: "2026-11-19:lead:1", hash: payloadHash("lead.create", input) }));
    expect(mocks.completeKey).toHaveBeenCalledWith({ tag: "admin" }, "daily-crm", "2026-11-19:lead:1", expect.objectContaining({ entityId: LEAD }));
  });

  it("replays a completed key and does not write again", async () => {
    const input = { name: "Ada" };
    mocks.readKey.mockResolvedValue({ status: "completed", payload_hash: payloadHash("lead.create", input), result: { ok: true, id: LEAD, duplicate: false }, created_at: "2026-11-19T00:00:00.000Z" });
    const { results } = await applyBatch(bot, { operations: [op("2026-11-19:lead:1", "lead.create", input)] });
    expect(results[0]).toMatchObject({ ok: true, replayed: true, id: LEAD });
    expect(mocks.createLead).not.toHaveBeenCalled();
    expect(mocks.insertPending).not.toHaveBeenCalled();
  });

  it("rejects the same key used for a different body", async () => {
    mocks.readKey.mockResolvedValue({ status: "completed", payload_hash: "f".repeat(64), result: { ok: true, id: LEAD }, created_at: "2026-11-19T00:00:00.000Z" });
    const { results } = await applyBatch(bot, { operations: [op("2026-11-19:lead:1", "lead.create", { name: "Ada" })] });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toMatch(/different operation/);
    expect(mocks.createLead).not.toHaveBeenCalled();
  });

  it("lets a later operation use the id from an earlier one", async () => {
    const { results } = await applyBatch(bot, {
      operations: [
        op("day1-req", "request.create", { clientId: LEAD, title: "Update hours", coverage: "included" }),
        op("day1-note", "request.comment", { requestId: { $ref: "day1-req" }, body: "Included in this month's care." }),
      ],
    });
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(mocks.addRequestComment).toHaveBeenCalledWith(bot, { requestId: REQUEST, body: "Included in this month's care." });
    expect(mocks.createRequest).toHaveBeenCalledWith(bot, expect.objectContaining({ coverage: "included" }));
  });

  it("keeps going after one operation fails, and releases that operation's lock", async () => {
    mocks.createLead.mockRejectedValueOnce(new ValidationError(["Enter the contact's name."]));
    const { results } = await applyBatch(bot, {
      operations: [op("day1-lead", "lead.create", {}), op("day1-task", "task.create", { title: "Call back" })],
    });
    expect(results[0]).toMatchObject({ ok: false, error: "Enter the contact's name." });
    expect(results[1]).toMatchObject({ ok: true, op: "task.create" });
    expect(mocks.deletePending).toHaveBeenCalledWith({ tag: "admin" }, "daily-crm", "day1-lead");
    expect(mocks.createTask).toHaveBeenCalledWith(bot, expect.objectContaining({ title: "Call back", submissionKey: expect.stringMatching(/^[a-f0-9]{32}$/) }), {
      sourceReference: "bot:daily-crm:day1-task",
    });
  });

  it("rejects a batch that repeats an idempotency key", async () => {
    await expect(
      applyBatch(bot, { operations: [op("same", "lead.create", { name: "Ada" }), op("same", "lead.create", { name: "Ada" })] }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.probeStore).not.toHaveBeenCalled();
  });
});
