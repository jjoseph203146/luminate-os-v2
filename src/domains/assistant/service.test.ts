import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ writeAudit: vi.fn(), run: vi.fn() }));

vi.mock("@/platform/audit/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("./tools", () => ({
  TOOLS: [
    {
      name: "echo",
      title: "Echo",
      description: "Test tool.",
      inputShape: { name: z.string().max(20).describe("A name"), days: z.number().int().min(1).max(10).optional().describe("Days") },
      run: mocks.run,
    },
  ],
}));

import { callTool, listTools, MAX_RESULT_CHARS } from "./service";
import { PermissionError } from "@/platform/errors";

const ai = { type: "ai", name: "mcp" } as const;
const owner = { type: "owner", userId: "u", email: null, ip: null } as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.run.mockResolvedValue({ ok: "fine" });
});

describe("listTools", () => {
  it("lists the tools without their handlers", () => {
    const tools = listTools(ai);
    expect(tools.map((t) => t.name)).toEqual(["echo"]);
    expect(Object.keys(tools[0] as object)).not.toContain("run");
  });
  it("is allowed for the ai actor and the owner, not for others", () => {
    expect(() => listTools(owner)).not.toThrow();
    expect(() => listTools({ type: "system", name: "jobs" })).toThrow(PermissionError);
  });
});

describe("callTool", () => {
  it("runs the tool with validated arguments and returns its data", async () => {
    expect(await callTool(ai, "echo", { name: "Acme" })).toEqual({ ok: true, data: { ok: "fine" }, truncated: false });
    expect(mocks.run).toHaveBeenCalledWith(ai, { name: "Acme" });
  });
  it("refuses an unknown tool", async () => {
    expect(await callTool(ai, "drop_everything", {})).toEqual({ ok: false, error: "Unknown tool." });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("refuses invalid arguments, unknown arguments and out-of-range numbers without running the tool", async () => {
    for (const bad of [{}, { name: 5 }, { name: "x".repeat(21) }, { name: "a", days: 99 }, { name: "a", extra: true }]) {
      const r = await callTool(ai, "echo", bad);
      expect(r.ok).toBe(false);
    }
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("masks anything sensitive-looking in the result", async () => {
    mocks.run.mockResolvedValue({ title: "Call jane@acme.com about cus_AbCdEfGh1234" });
    const r = await callTool(ai, "echo", { name: "a" });
    expect(r).toMatchObject({ ok: true, data: { title: "Call [email] about [stripe-id]" } });
  });
  it("refuses to return a banned field even if a tool tries", async () => {
    mocks.run.mockResolvedValue({ client: "Acme", email: "x@y.co" });
    const r = await callTool(ai, "echo", { name: "a" });
    expect(r).toEqual({ ok: false, error: "The data could not be read right now." });
  });
  it("hides internal errors from the assistant", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.run.mockRejectedValue(new Error('relation "secret_table" does not exist'));
    const r = await callTool(ai, "echo", { name: "a" });
    expect(r).toEqual({ ok: false, error: "The data could not be read right now." });
  });
  it("cuts a huge answer and says so", async () => {
    mocks.run.mockResolvedValue({ rows: "x".repeat(MAX_RESULT_CHARS + 10) });
    const r = await callTool(ai, "echo", { name: "a" });
    expect(r).toMatchObject({ ok: true, truncated: true });
  });
  it("writes an audit row for every call, and still answers if the audit write fails", async () => {
    await callTool(ai, "echo", { name: "Acme" });
    expect(mocks.writeAudit).toHaveBeenCalledWith(ai, expect.objectContaining({ action: "assistant.tool_called", entityType: "assistant_tool", entityId: "echo", after: { args: { name: "Acme" }, ok: true } }));
    mocks.writeAudit.mockRejectedValue(new Error("audit down"));
    expect(await callTool(ai, "echo", { name: "Acme" })).toMatchObject({ ok: true });
  });
  it("is not allowed for actors without the permission", async () => {
    await expect(callTool({ type: "system", name: "jobs" }, "echo", {})).rejects.toBeInstanceOf(PermissionError);
    expect(mocks.run).not.toHaveBeenCalled();
  });
});

describe("audit log", () => {
  it("never stores a raw email or phone number from the arguments", async () => {
    await callTool(ai, "echo", { name: "jane@acme.com" });
    expect(mocks.writeAudit).toHaveBeenCalledWith(ai, expect.objectContaining({ after: { args: { name: "[email]" }, ok: true } }));
  });
});
