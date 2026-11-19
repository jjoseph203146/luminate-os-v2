import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ applyBatch: vi.fn() }));
vi.mock("@/domains/bot/service", () => ({ applyBatch: mocks.applyBatch, BotStoreNotReadyError: class BotStoreNotReadyError extends Error { constructor() { super("The bot write store is not ready. Apply migration 0010 before using this API."); this.name = "BotStoreNotReadyError"; } } }));

import { DELETE, GET, POST, PUT } from "./route";
import { PermissionError, ValidationError } from "@/platform/errors";

const KEY = "b".repeat(40);
const MCP = "m".repeat(40);
let ipCounter = 0;
const freshIp = () => `10.2.0.${++ipCounter}`;

function post(body: string, opts: { headers?: Record<string, string>; ip?: string; query?: string } = {}) {
  return POST(
    new Request(`https://www.luminateos.app/api/bot/writes${opts.query ?? ""}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${KEY}`,
        "x-bot-name": "daily-crm",
        "x-forwarded-for": opts.ip ?? freshIp(),
        ...opts.headers,
      },
      body,
    }),
  );
}

const batch = JSON.stringify({ operations: [{ idempotencyKey: "2026-11-19:lead:1", op: "lead.create", input: { name: "Ada" } }] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BOT_WRITE_API_KEY", KEY);
  vi.stubEnv("MCP_API_KEY", MCP);
  mocks.applyBatch.mockResolvedValue({ results: [{ idempotencyKey: "2026-11-19:lead:1", op: "lead.create", ok: true, replayed: false, id: "1" }] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("who may call", () => {
  it("is off when no write key is configured", async () => {
    vi.stubEnv("BOT_WRITE_API_KEY", "");
    const res = await post(batch);
    expect(res.status).toBe(503);
    expect(mocks.applyBatch).not.toHaveBeenCalled();
  });
  it("is off when the write key is shorter than 32 characters", async () => {
    vi.stubEnv("BOT_WRITE_API_KEY", "short");
    expect((await post(batch, { headers: { authorization: "Bearer short" } })).status).toBe(503);
  });
  it("is off when the write key is the same as the read-only connector key", async () => {
    vi.stubEnv("BOT_WRITE_API_KEY", KEY);
    vi.stubEnv("MCP_API_KEY", KEY);
    const res = await post(batch);
    expect(res.status).toBe(503);
    expect(mocks.applyBatch).not.toHaveBeenCalled();
  });
  it("refuses a missing or wrong key with 401, and ignores a key in the query string", async () => {
    for (const headers of [{ authorization: "" }, { authorization: "Bearer wrong" }, { authorization: "Bearer " + "x".repeat(50) }]) {
      const res = await post("not json", { headers });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
    }
    const fromQuery = await post(batch, { query: `?key=${KEY}`, headers: { authorization: "" } });
    expect(fromQuery.status).toBe(401);
    expect(mocks.applyBatch).not.toHaveBeenCalled();
  });
  it("does not accept the read-only connector key", async () => {
    const res = await post(batch, { headers: { authorization: `Bearer ${MCP}` } });
    expect(res.status).toBe(401);
    expect(mocks.applyBatch).not.toHaveBeenCalled();
  });
});

describe("the bot name and the batch", () => {
  it("requires a lowercase X-Bot-Name and passes that name to the service as the bot actor", async () => {
    expect((await post(batch, { headers: { "x-bot-name": "" } })).status).toBe(400);
    expect((await post(batch, { headers: { "x-bot-name": "Daily CRM" } })).status).toBe(400);
    const res = await post(batch, { ip: "203.0.113.9" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.applyBatch).toHaveBeenCalledWith({ type: "bot", name: "daily-crm", ip: "203.0.113.9" }, expect.objectContaining({ operations: [expect.objectContaining({ op: "lead.create" })] }));
  });
  it("answers other methods with 405", async () => {
    for (const handler of [GET, DELETE, PUT]) {
      const res = await handler();
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });
  it("refuses a body that is not JSON or is too large", async () => {
    expect((await post("{bad")).status).toBe(400);
    expect((await post(JSON.stringify({ pad: "x".repeat(300_000) }))).status).toBe(413);
  });
  it("returns 503 when migration 0010 is not visible, and 400 when the batch itself is invalid", async () => {
    const { BotStoreNotReadyError } = await import("@/domains/bot/service");
    mocks.applyBatch.mockRejectedValueOnce(new BotStoreNotReadyError());
    expect((await post(batch)).status).toBe(503);
    mocks.applyBatch.mockRejectedValueOnce(new ValidationError(["Send at least one operation."]));
    expect((await post(batch)).status).toBe(400);
    mocks.applyBatch.mockRejectedValueOnce(new PermissionError());
    expect((await post(batch)).status).toBe(403);
  });
});

describe("rate limits", () => {
  it("allows 30 calls a minute per address, then 429", async () => {
    const ip = freshIp();
    for (let i = 0; i < 30; i++) expect((await post(batch, { ip })).status).toBe(200);
    const res = await post(batch, { ip });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });
  it("allows 10 failed key checks per 10 minutes per address, then 429", async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) expect((await post(batch, { ip, headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    const res = await post(batch, { ip, headers: { authorization: "Bearer wrong" } });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("600");
  });
});
