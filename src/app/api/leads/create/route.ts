import { after } from "next/server";
import { formToObject } from "@/platform/action-errors";
import { getLeadFormOrigins } from "@/platform/env";
import { RateLimitError, ValidationError } from "@/platform/errors";
import { createRateLimiter } from "@/platform/security/rate-limit";
import { isHoneypotFilled, leadNotification } from "@/domains/growth/intake";
import { createWebsiteLead } from "@/domains/growth/service";
import { notifyOwner } from "@/domains/notifications/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The website contact form posts here without a session. Same path as the old app, so moving the
// form over is a change of host only. It checks the origin, limits bursts, ignores bot traps,
// validates every field, and stores the lead with the system actor.
const MAX_BODY_BYTES = 20_000;
const limiter = createRateLimiter({ max: 5, windowMs: 10 * 60_000 });
const SYSTEM = { type: "system", name: "website_form" } as const;

function respond(body: Record<string, unknown>, status: number, origin: string | null): Response {
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  // A 204 must have no body.
  if (status === 204) return new Response(null, { status, headers });
  return Response.json(body, { status, headers });
}

function allowedOrigin(request: Request): { origin: string | null; allowed: boolean } {
  const origin = request.headers.get("origin");
  // No Origin header: a server-side or non-browser caller. Allowed, but still validated and limited.
  if (!origin) return { origin: null, allowed: true };
  return { origin, allowed: getLeadFormOrigins().includes(origin) };
}

export async function OPTIONS(request: Request): Promise<Response> {
  const { origin, allowed } = allowedOrigin(request);
  if (!allowed) return new Response(null, { status: 403 });
  return respond({}, 204, origin);
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data")) return formToObject(await request.formData());
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;
    if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const { origin, allowed } = allowedOrigin(request);
  if (!allowed) return Response.json({ ok: false, success: false, error: "Not allowed." }, { status: 403 });

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return respond({ ok: false, success: false, error: "That message is too large." }, 413, origin);

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!limiter.check(ip, Date.now())) {
    return respond({ ok: false, success: false, error: "Too many messages. Please try again in a few minutes." }, 429, origin);
  }

  const raw = await readBody(request);
  if (!raw) return respond({ ok: false, success: false, error: "We could not read that message. Please try again." }, 400, origin);

  // A filled trap field means a bot. Say "ok" so it learns nothing, and store nothing.
  if (isHoneypotFilled(raw)) return respond({ ok: true, success: true }, 200, origin);

  try {
    const result = await createWebsiteLead(SYSTEM, raw);
    if (!result.duplicate && result.id) {
      const payload = leadNotification({ id: result.id, ...result.lead });
      // After the response is sent: the visitor never waits on the push.
      after(async () => {
        await notifyOwner(SYSTEM, payload);
      });
    }
    return respond({ ok: true, success: true }, 200, origin);
  } catch (e) {
    if (e instanceof ValidationError) return respond({ ok: false, success: false, error: e.issues[0] ?? "Please check the form and try again.", issues: e.issues }, 400, origin);
    if (e instanceof RateLimitError) return respond({ ok: false, success: false, error: e.message }, 429, origin);
    console.error("lead intake failed", e);
    return respond({ ok: false, success: false, error: "Something went wrong. Please try again or email us." }, 500, origin);
  }
}
