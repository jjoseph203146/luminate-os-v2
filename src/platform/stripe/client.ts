// The Stripe API client. Server-only. Created lazily, once per secret key.
// Same API version as the old app's webhook, so event payloads have the same shape.
import Stripe from "stripe";

export const STRIPE_API_VERSION = "2026-05-27.dahlia" as const;

let cached: { key: string; client: Stripe } | null = null;

export function getStripe(secretKey: string): Stripe {
  if (typeof window !== "undefined") throw new Error("Stripe client is server-only");
  if (!cached || cached.key !== secretKey) {
    cached = { key: secretKey, client: new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION }) };
  }
  return cached.client;
}
