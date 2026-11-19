// Key check for the bot write API (POST /api/bot/writes). Pure: no I/O, no logging.
// The key is accepted only as Authorization: Bearer. It is not read from the query string:
// a write key must not end up in access logs, browser history or Referer headers.
import { createHash, timingSafeEqual } from "node:crypto";

export type BotAuthResult = "ok" | "unconfigured" | "denied";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * `expected` is null when BOT_WRITE_API_KEY is unset or shorter than 32 characters.
 * When it is set to the same value as MCP_API_KEY, the API stays off: the read-only
 * connector key must not also be a write key.
 * Both comparisons hash first, so they take the same time whatever the guess looks like.
 */
export function checkBotWriteKey(authorization: string | null, expected: string | null, mcpKey: string | null): BotAuthResult {
  if (!expected) return "unconfigured";
  if (mcpKey && timingSafeEqual(digest(expected), digest(mcpKey))) return "unconfigured";
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (bearer === "") return "denied";
  return timingSafeEqual(digest(bearer), digest(expected)) ? "ok" : "denied";
}
