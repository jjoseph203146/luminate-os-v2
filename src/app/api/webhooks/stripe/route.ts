// The Stripe webhook. Receives Stripe's events (customers, invoices, charges, subscriptions) and records them in
// the same tables the old app's webhook used (docs/architecture/14-stripe-webhook.md).
// Public to the proxy because Stripe has no session: every request must carry a valid Stripe signature.
// Never logs the body or the signature header.
import { getStripeConfig } from "@/platform/env";
import { createAdminClient } from "@/platform/db/server";
import { createStripeReads } from "@/platform/stripe/api";
import { getStripe } from "@/platform/stripe/client";
import type { Actor } from "@/platform/auth/types";
import { createBillingRepo } from "@/domains/billing/repo";
import { IngestError, ingestStripeEvent, type BillingDeps, type StripeEventLike } from "@/domains/billing/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// Large invoices (many line items) can produce big events; refusing one would lose it on every retry.
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const STRIPE: Actor = { type: "integration", name: "stripe" };

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function notAllowed(): Response {
  return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: { Allow: "POST", "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export const GET = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;

/** Overridable in tests. */
export const routeDeps = {
  billing: (secretKey: string): BillingDeps => ({
    repo: createBillingRepo(createAdminClient()),
    stripe: createStripeReads(getStripe(secretKey)),
    now: () => new Date(),
  }),
};

export async function POST(request: Request): Promise<Response> {
  const config = getStripeConfig();
  const secrets = [config?.webhookSecret, config?.webhookSecretTest].filter((s): s is string => !!s);
  if (!config || secrets.length === 0) return json({ error: "The Stripe webhook is not configured." }, 503);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ error: "Payload too large." }, 413);
  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return json({ error: "Payload too large." }, 413);

  const signature = request.headers.get("stripe-signature");
  if (!signature) return json({ error: "Missing signature." }, 400);

  // Try whichever secret actually verifies this payload, live first. A blind preference order broke production
  // in the old app: when the test secret was set, it ate every real live event's signature check.
  const stripe = getStripe(config.secretKey);
  let event: StripeEventLike | null = null;
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(body, signature, secret) as unknown as StripeEventLike;
      break;
    } catch {
      /* try the next secret */
    }
  }
  if (!event) return json({ error: "Invalid signature." }, 400);

  try {
    const outcome = await ingestStripeEvent(STRIPE, event, routeDeps.billing(config.secretKey), process.env.APP_ENV, process.env.VERCEL_ENV);
    switch (outcome.result) {
      case "processed":
        return json({ received: true }, 200);
      case "ignored":
        return json({ received: true, ignored: outcome.reason }, 200);
      case "duplicate":
        return json({ received: true, duplicate: true }, 200);
      case "in_flight":
        // Still being processed by another delivery: Stripe retries this one later.
        return json({ error: "This event is being processed. Retry later." }, 409);
    }
  } catch (e) {
    // 500 makes Stripe retry with backoff instead of the event being lost. Event type only: no customer data.
    console.error("stripe webhook failed:", event.type, e instanceof IngestError ? e.short : e instanceof Error ? e.name : "unknown");
    return json({ error: "Processing failed." }, 500);
  }
}
