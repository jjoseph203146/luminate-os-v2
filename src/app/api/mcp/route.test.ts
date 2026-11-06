import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ listTools: vi.fn(), callTool: vi.fn() }));
vi.mock("@/domains/assistant/service", () => ({ listTools: mocks.listTools, callTool: mocks.callTool }));

import { DELETE, GET, POST } from "./route";
import { PermissionError } from "@/platform/errors";

const KEY = "k".repeat(40);
let ipCounter = 0;
/** A fresh address per test, so the in-memory rate limits never leak between tests. */
const freshIp = () => `10.0.0.${++ipCounter}`;

const tools = [
  { name: "echo", title: "Echo", description: "Returns what it is given.", inputShape: { text: z.string().describe("Some text.") } },
  { name: "no_args", title: "No args", description: "Takes nothing.", inputShape: {} },
];

function rpc(method: string, params?: unknown, id: number | null = 1) {
  return JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, ...(params === undefined ? {} : { params }) });
}

function post(body: string, opts: { query?: string; headers?: Record<string, string>; ip?: string } = {}) {
  return POST(
    new Request(`https://www.luminateos.app/api/mcp${opts.query ?? `?key=${KEY}`}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": opts.ip ?? freshIp(), ...opts.headers },
      body,
    }),
  );
}

async function ok(method: string, params?: unknown) {
  const res = await post(rpc(method, params));
  expect(res.status).toBe(200);
  return (await res.json()) as { result?: Record<string, unknown>; error?: unknown };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MCP_API_KEY", KEY);
  mocks.listTools.mockReturnValue(tools);
  mocks.callTool.mockResolvedValue({ ok: true, data: { hello: "world" }, truncated: false });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("who may call", () => {
  it("is off (503) when no key is configured, even for a request that carries a key", async () => {
    vi.stubEnv("MCP_API_KEY", "");
    const res = await post(rpc("tools/list"));
    expect(res.status).toBe(503);
    expect(mocks.listTools).not.toHaveBeenCalled();
  });
  it("is off when the key is shorter than 32 characters", async () => {
    vi.stubEnv("MCP_API_KEY", "short");
    expect((await post(rpc("tools/list"), { query: "?key=short" })).status).toBe(503);
  });
  it("refuses a missing or wrong key with 401 and WWW-Authenticate, before reading the body", async () => {
    for (const query of ["", "?key=wrong"]) {
      const res = await post("not even json", { query });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
      expect(await res.json()).toEqual({ error: "Unauthorized." });
    }
    expect(mocks.listTools).not.toHaveBeenCalled();
  });
  it("accepts the key as a Bearer header too", async () => {
    const res = await post(rpc("tools/list"), { query: "", headers: { authorization: `Bearer ${KEY}` } });
    expect(res.status).toBe(200);
  });
  it("a wrong Bearer header wins over a right ?key=", async () => {
    expect((await post(rpc("tools/list"), { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
  });
});

describe("methods and headers", () => {
  it("answers GET and DELETE with 405 and Allow: POST, with no key needed", async () => {
    for (const handler of [GET, DELETE]) {
      const res = await handler();
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
  it("sends Cache-Control: no-store on every kind of answer", async () => {
    const responses = [
      await post(rpc("tools/list")),
      await post(rpc("tools/list"), { query: "?key=wrong" }),
      await post("{bad json"),
    ];
    for (const r of responses) expect(r.headers.get("cache-control")).toBe("no-store");
  });
});

describe("size and shape of the request", () => {
  it("refuses a body over 64 KB with 413", async () => {
    const res = await post(JSON.stringify({ pad: "x".repeat(70_000) }));
    expect(res.status).toBe(413);
  });
  it("refuses a declared content-length over 64 KB with 413", async () => {
    const res = await post(rpc("tools/list"), { headers: { "content-length": "70000" } }).catch(() => null);
    // Some runtimes refuse to build such a request at all; when they do build it, it must be a 413.
    if (res) expect(res.status).toBe(413);
  });
  it("answers bad JSON with a JSON-RPC parse error (400)", async () => {
    const res = await post("{bad json");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32700 } });
  });
});

describe("rate limits", () => {
  it("allows 60 calls a minute per address, then 429 with Retry-After", async () => {
    const ip = freshIp();
    for (let i = 0; i < 60; i++) expect((await post(rpc("tools/list"), { ip })).status).toBe(200);
    const res = await post(rpc("tools/list"), { ip });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    // Another address is unaffected.
    expect((await post(rpc("tools/list"))).status).toBe(200);
  });
  it("allows 10 failed key checks per 10 minutes per address, then 429 with Retry-After", async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) expect((await post(rpc("tools/list"), { query: "?key=wrong", ip })).status).toBe(401);
    const res = await post(rpc("tools/list"), { query: "?key=wrong", ip });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("600");
  });
});

describe("the protocol, through the official SDK", () => {
  it("answers initialize with the server name and a short, honest description", async () => {
    const { result } = await ok("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(result).toMatchObject({ serverInfo: { name: "luminate-os" } });
    expect(String(result?.instructions)).toMatch(/read-only/i);
    expect(String(result?.instructions)).toMatch(/never available/i);
  });
  it("lists the tools with their descriptions and argument schemas", async () => {
    const { result } = await ok("tools/list");
    const list = result?.tools as { name: string; description: string; inputSchema: { properties?: Record<string, unknown> } }[];
    expect(list.map((t) => t.name)).toEqual(["echo", "no_args"]);
    expect(list[0]?.description).toBe("Returns what it is given.");
    expect(Object.keys(list[0]?.inputSchema.properties ?? {})).toEqual(["text"]);
  });
  it("calls a tool and returns its data as JSON text", async () => {
    const { result } = await ok("tools/call", { name: "echo", arguments: { text: "hi" } });
    expect(mocks.callTool).toHaveBeenCalledWith({ type: "ai", name: "mcp" }, "echo", { text: "hi" });
    expect(result?.isError).toBeFalsy();
    expect(result?.content).toEqual([{ type: "text", text: JSON.stringify({ hello: "world" }) }]);
  });
  it("calls a tool that takes no arguments", async () => {
    const { result } = await ok("tools/call", { name: "no_args", arguments: {} });
    expect(result?.isError).toBeFalsy();
    expect(mocks.callTool).toHaveBeenCalledTimes(1);
  });
  it("returns a tool failure as an error result the assistant can read", async () => {
    mocks.callTool.mockResolvedValue({ ok: false, error: "The data could not be read right now." });
    const { result } = await ok("tools/call", { name: "echo", arguments: { text: "hi" } });
    expect(result?.isError).toBe(true);
    expect(result?.content).toEqual([{ type: "text", text: "The data could not be read right now." }]);
  });
  it("a permission failure while the tool runs becomes a short 'Not permitted.' error result", async () => {
    mocks.callTool.mockRejectedValue(new PermissionError());
    const { result } = await ok("tools/call", { name: "echo", arguments: { text: "hi" } });
    expect(result?.isError).toBe(true);
    expect(result?.content).toEqual([{ type: "text", text: "Not permitted." }]);
  });
  it("does not run a tool the assistant made up", async () => {
    const res = await post(rpc("tools/call", { name: "delete_everything", arguments: {} }));
    const body = (await res.json()) as { result?: { isError?: boolean }; error?: unknown };
    expect(mocks.callTool).not.toHaveBeenCalled();
    expect(body.error !== undefined || body.result?.isError === true).toBe(true);
  });
});

describe("failures", () => {
  it("maps a PermissionError while setting up to 403", async () => {
    mocks.listTools.mockImplementation(() => {
      throw new PermissionError();
    });
    const res = await post(rpc("tools/list"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden." });
  });
  it("maps an unexpected error to a generic 500 and logs without the request or the key", async () => {
    mocks.listTools.mockImplementation(() => {
      throw new Error("boom");
    });
    const res = await post(rpc("tools/list", { secretish: "marker-in-body" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error." });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("boom");
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain("marker-in-body");
  });
});

describe("the key never comes back", () => {
  it("is absent from every response body and header", async () => {
    const responses = [
      await post(rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } })),
      await post(rpc("tools/list")),
      await post(rpc("tools/call", { name: "echo", arguments: { text: "hi" } })),
      await post("{bad"),
      await post(JSON.stringify({ pad: "x".repeat(70_000) })),
      await post(rpc("tools/list"), { query: `?key=${KEY}x` }),
      await GET(),
    ];
    vi.stubEnv("MCP_API_KEY", "");
    responses.push(await post(rpc("tools/list")));
    for (const r of responses) {
      const text = JSON.stringify([...r.headers.entries()]) + (await r.text());
      expect(text).not.toContain(KEY);
    }
  });
});

describe("batches", () => {
  it("refuses a JSON-RPC batch, so one request cannot run many tool calls past the rate limit", async () => {
    const batch = JSON.stringify([JSON.parse(rpc("tools/list", undefined, 1)), JSON.parse(rpc("tools/list", undefined, 2))]);
    const res = await post(batch);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32600);
    expect(mocks.callTool).not.toHaveBeenCalled();
  });
});
