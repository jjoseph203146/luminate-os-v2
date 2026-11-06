// Key check for the AI assistant connector (/api/mcp). Pure: no I/O, no logging.
// Claude's and ChatGPT's custom-connector screens often take only a URL, so the key may arrive as `?key=`;
// an `Authorization: Bearer` header is accepted too and wins when both are present.
import { createHash, timingSafeEqual } from "node:crypto";

export type McpAuthResult = "ok" | "unconfigured" | "denied";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Pulls the presented key out of the request: the Bearer header first, else the `key` query value. */
export function presentedKey(authorization: string | null, queryKey: string | null): string {
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;
  return queryKey?.trim() ?? "";
}

/**
 * `expected` is null when MCP_API_KEY is unset or too short: every request is then refused ("unconfigured").
 * The comparison hashes both values first, so it takes the same time whatever the guess looks like.
 */
export function checkMcpKey(authorization: string | null, queryKey: string | null, expected: string | null): McpAuthResult {
  if (!expected) return "unconfigured";
  const given = presentedKey(authorization, queryKey);
  if (given === "") return "denied";
  return timingSafeEqual(digest(given), digest(expected)) ? "ok" : "denied";
}
