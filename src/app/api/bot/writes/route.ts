import { applyBatch, BotStoreNotReadyError } from "@/domains/bot/service";
import { isBotName } from "@/domains/bot/rules";
import type { Actor } from "@/platform/auth/types";
import { getBotWriteKey, getMcpKey } from "@/platform/env";
import { PermissionError, ValidationError } from "@/platform/errors";
import { checkBotWriteKey } from "@/platform/security/bot-auth";
import { createRateLimiter } from "@/platform/security/rate-limit";

// Bot write API. A named bot submits one batch of CRM writes. It is not the read-only assistant
// connector: that stays at POST /api/mcp with MCP_API_KEY and the `ai` actor. This route checks
// BOT_WRITE_API_KEY (Bearer only) and calls domain services as a `bot` actor, so permission checks
// and the audit log apply. src/proxy.ts lets /api/bot/writes through without a session.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 256 * 1024;

const callLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });
const failureLimiter = createRateLimiter({ max: 10, windowMs: 10 * 60_000 });

function json(body: Record<string, unknown>, status: number, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });
}

function clientIp(request: Request): string {
  return (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown").slice(0, 64);
}

function notAllowed(): Response {
  return json({ error: "Method not allowed. POST a JSON batch." }, 405, { Allow: "POST" });
}

export async function GET(): Promise<Response> {
  return notAllowed();
}

export async function DELETE(): Promise<Response> {
  return notAllowed();
}

export async function PUT(): Promise<Response> {
  return notAllowed();
}

export async function POST(request: Request): Promise<Response> {
  const expected = getBotWriteKey();
  const ip = clientIp(request);
  const auth = checkBotWriteKey(request.headers.get("authorization"), expected, getMcpKey());
  if (auth === "unconfigured") return json({ error: "The bot write API is not configured." }, 503);
  if (auth === "denied") {
    if (!failureLimiter.check(ip, Date.now())) return json({ error: "Too many failed attempts. Try again later." }, 429, { "Retry-After": "600" });
    return json({ error: "Unauthorized." }, 401, { "WWW-Authenticate": "Bearer" });
  }
  if (!callLimiter.check(ip, Date.now())) return json({ error: "Too many requests. Try again in a minute." }, 429, { "Retry-After": "60" });

  const botName = request.headers.get("x-bot-name")?.trim() ?? "";
  if (!isBotName(botName)) {
    return json({ error: "Send X-Bot-Name: a lowercase name such as daily-crm (letters, digits and hyphens, up to 40 characters)." }, 400);
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);
  const bodyText = await request.text();
  if (Buffer.byteLength(bodyText) > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }

  const actor: Actor = { type: "bot", name: botName, ip: ip === "unknown" ? null : ip };
  try {
    const { results } = await applyBatch(actor, parsed);
    return json({ results }, 200);
  } catch (e) {
    if (e instanceof BotStoreNotReadyError) return json({ error: e.message }, 503);
    if (e instanceof ValidationError) return json({ error: e.issues.join("; ") }, 400);
    if (e instanceof PermissionError) return json({ error: "Forbidden." }, 403);
    // Never the body or the Authorization header: the body can hold notes, and the header holds the key.
    console.error("bot write request failed:", e instanceof Error ? e.name : "unknown error");
    return json({ error: "Internal error." }, 500);
  }
}
