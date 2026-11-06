import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { callTool, listTools } from "@/domains/assistant/service";
import type { Actor } from "@/platform/auth/types";
import { getMcpKey } from "@/platform/env";
import { PermissionError } from "@/platform/errors";
import { checkMcpKey } from "@/platform/security/mcp-auth";
import { createRateLimiter } from "@/platform/security/rate-limit";

// The AI assistant connector: a read-only MCP (Model Context Protocol) endpoint, so Claude or ChatGPT can ask
// Luminate OS what needs attention. Stateless: every POST is a self-contained JSON-RPC request answered with a
// JSON body, which is what a serverless route needs. It has its own key (MCP_API_KEY, in the URL as ?key= or in
// an Authorization: Bearer header), checked here because src/proxy.ts lets /api/mcp through without a session.
// Everything it can do lives in src/domains/assistant: read-only tools, allow-listed fields, audit rows.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 64 * 1024;
const AI: Actor = { type: "ai", name: "mcp" };

const INSTRUCTIONS =
  "Read-only view of Luminate OS, the operating system of Luminate Web Design & Development. " +
  "Nothing here can change anything. Money is in US dollars. Data can be a few minutes old. " +
  "Contact details (emails, phone numbers) and notes are never available. If a tool says it could not read the data, say so rather than guessing.";

// Authorised calls: 60 a minute per address. Failed key checks: 10 per 10 minutes per address, then 429.
const callLimiter = createRateLimiter({ max: 60, windowMs: 60_000 });
const failureLimiter = createRateLimiter({ max: 10, windowMs: 10 * 60_000 });

function json(body: Record<string, unknown>, status: number, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });
}

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function notAllowed(): Response {
  return json({ error: "Method not allowed. This MCP endpoint is stateless: POST JSON-RPC requests only." }, 405, { Allow: "POST" });
}

export async function GET(): Promise<Response> {
  return notAllowed();
}

export async function DELETE(): Promise<Response> {
  return notAllowed();
}

/** One MCP server per request, with the read-only tools registered. Throws PermissionError if the actor may not read. */
function buildServer(): McpServer {
  const server = new McpServer({ name: "luminate-os", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  for (const tool of listTools(AI)) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.inputShape }, async (args: unknown) => {
      try {
        const result = await callTool(AI, tool.name, args);
        if (result.ok) return { content: [{ type: "text" as const, text: JSON.stringify(result.data) }] };
        return { content: [{ type: "text" as const, text: result.error }], isError: true };
      } catch (e) {
        if (e instanceof PermissionError) return { content: [{ type: "text" as const, text: "Not permitted." }], isError: true };
        throw e;
      }
    });
  }
  return server;
}

export async function POST(request: Request): Promise<Response> {
  const expected = getMcpKey();
  const url = new URL(request.url);
  const ip = clientIp(request);

  const auth = checkMcpKey(request.headers.get("authorization"), url.searchParams.get("key"), expected);
  if (auth === "unconfigured") return json({ error: "The assistant connector is not configured." }, 503);
  if (auth === "denied") {
    // Count the failure; past the limit the caller is told to slow down instead.
    if (!failureLimiter.check(ip, Date.now())) return json({ error: "Too many failed attempts. Try again later." }, 429, { "Retry-After": "600" });
    return json({ error: "Unauthorized." }, 401, { "WWW-Authenticate": "Bearer" });
  }
  if (!callLimiter.check(ip, Date.now())) return json({ error: "Too many requests. Try again in a minute." }, 429, { "Retry-After": "60" });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);
  const bodyText = await request.text();
  if (Buffer.byteLength(bodyText) > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, 400);
  }

  // The current MCP spec has no batching, and a batch would let one request run up to 100 tool calls
  // past the per-request rate limit.
  if (Array.isArray(parsed)) return json({ jsonrpc: "2.0", error: { code: -32600, message: "Batch requests are not supported" }, id: null }, 400);

  // The spec asks clients to send Accept: application/json, text/event-stream. Be lenient with ones that
  // do not: this endpoint only ever answers with JSON.
  const headers = new Headers(request.headers);
  headers.set("accept", "application/json, text/event-stream");
  headers.set("content-type", "application/json");
  const normalized = new Request(`${url.origin}${url.pathname}`, { method: "POST", headers, body: bodyText });

  let server: McpServer | null = null;
  try {
    server = buildServer();
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(normalized, { parsedBody: parsed });
    const out = new Response(response.body, response);
    out.headers.set("Cache-Control", "no-store");
    return out;
  } catch (e) {
    if (e instanceof PermissionError) return json({ error: "Forbidden." }, 403);
    // Never the request body or the URL: they can carry the key.
    console.error("mcp request failed:", e instanceof Error ? `${e.name}: ${e.message}` : "unknown error");
    return json({ error: "Internal error." }, 500);
  } finally {
    await server?.close().catch(() => {});
  }
}
