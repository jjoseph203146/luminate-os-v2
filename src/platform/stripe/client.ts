// The Stripe API client. Server-only. Created lazily, once per secret key.
// Same API version as the old app's webhook, so event payloads have the same shape.
import Stripe from "stripe";

export const STRIPE_API_VERSION = "2026-05-27.dahlia" as const;

const cache = new Map<string, Stripe>();

/** One client per key: the webhook's read-only key and the invoice-sending key are used side by side. */
export function getStripe(secretKey: string): Stripe {
  if (typeof window !== "undefined") throw new Error("Stripe client is server-only");
  let client = cache.get(secretKey);
  if (!client) {
    client = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
    cache.set(secretKey, client);
  }
  return client;
}
