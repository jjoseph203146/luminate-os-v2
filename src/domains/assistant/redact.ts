// The one place that decides what may leave the app through the assistant connector. Two layers:
//  1. every tool builds its output from explicit, named fields (shape.ts), so contact details are never selected;
//  2. `sanitize` is a safety net over the finished result: free text that did get through (a request title)
//     can still contain something a client typed (an email, a phone number, a Stripe id). Those are masked.
// `assertNoBannedKeys` is a guard against future edits, not a filter.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Stripe object ids: cus_, sub_, in_, pi_, ch_, py_, price_, prod_, pm_, card_, evt_, re_ ...
// `in_progress` (a status) has the same shape as an `in_...` invoice id, so it is exempt.
const STRIPE_ID = /\b(?!in_progress\b)(?:cus|sub|in|pi|ch|py|price|prod|pm|card|evt|re|seti|si|src|acct)_[A-Za-z0-9]{8,}\b/g;
// Phone-ish: 10+ digits with optional separators and country code.
const PHONE = /(?<![\w.])\+?\(?\d[\d\s().-]{8,}\d(?![\w])/g;
// URLs carrying credentials: https://user:pass@host, or ?api_key=... / ?key=... / ?token=...
const URL_CREDS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/gi;
const QUERY_SECRET = /([?&](?:api_?key|key|token|secret|password|access_token)=)[^&\s]+/gi;

export function redactText(value: string): string {
  return value
    .replace(URL_CREDS, "[redacted-credentials]@")
    .replace(QUERY_SECRET, "$1[redacted]")
    .replace(EMAIL, "[email]")
    .replace(STRIPE_ID, "[stripe-id]")
    .replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 10 ? "[phone]" : m));
}

/** Recursively masks sensitive-looking substrings in every string in `value`. */
export function sanitize<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => sanitize(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitize(v);
    return out as T;
  }
  return value;
}

/** Keys that must never appear in any tool output, whatever their value. */
export const BANNED_KEYS = new Set([
  "email",
  "phone",
  "contact_name",
  "contactName",
  "stripe_customer_id",
  "stripeCustomerId",
  "stripe_invoice_id",
  "description",
  "notes",
  "comment",
  "comments",
  "file_path",
  "filePath",
  "contract_pdf_path",
  "password",
  "api_key",
  "token",
]);

/** Throws if a banned key shows up anywhere in the output. */
export function assertNoBannedKeys(value: unknown, path = "result"): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoBannedKeys(v, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (BANNED_KEYS.has(k)) throw new Error(`Assistant output would expose banned field "${k}" at ${path}`);
      assertNoBannedKeys(v, `${path}.${k}`);
    }
  }
}
