// Assistant domain: the only entry point for the AI assistant connector (/api/mcp). Read-only.
// Every call checks the actor's permission, validates its arguments, runs one fixed tool, masks anything
// sensitive-looking in the result, caps its size, and leaves a line in the audit log.
import { z } from "zod";
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { writeAudit } from "@/platform/audit/audit";
import { assertNoBannedKeys, sanitize } from "./redact";
import { TOOLS } from "./tools";
import type { ToolInfo, ToolResult } from "./types";

/** Longest answer handed back, in characters of JSON. Longer answers are cut and flagged. */
export const MAX_RESULT_CHARS = 60_000;

export function listTools(actor: Actor): ToolInfo[] {
  assertCan(actor, "assistant.read");
  return TOOLS.map(({ name, title, description, inputShape }) => ({ name, title, description, inputShape }));
}

function clipResult(data: unknown): { data: unknown; truncated: boolean } {
  const json = JSON.stringify(data);
  if (json.length <= MAX_RESULT_CHARS) return { data, truncated: false };
  return {
    data: { truncated: true, note: "The answer was too long and was cut. Ask for a narrower question.", partial: json.slice(0, MAX_RESULT_CHARS) },
    truncated: true,
  };
}

export async function callTool(actor: Actor, name: string, rawArgs: unknown): Promise<ToolResult> {
  assertCan(actor, "assistant.read");
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: "Unknown tool." };

  const parsed = z.object(tool.inputShape).strict().safeParse(rawArgs ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid arguments." };

  let result: ToolResult;
  try {
    const out = sanitize(await tool.run(actor, parsed.data));
    assertNoBannedKeys(out);
    const clipped = clipResult(out);
    result = { ok: true, data: clipped.data, truncated: clipped.truncated };
  } catch (e) {
    // Details stay in the server log; the assistant only learns that the read failed.
    console.error("assistant tool failed", name, e instanceof Error ? e.message : e);
    result = { ok: false, error: "The data could not be read right now." };
  }

  // A line in the audit log for every call. A failed audit write must not take the read down.
  try {
    await writeAudit(actor, { action: "assistant.tool_called", entityType: "assistant_tool", entityId: name, after: { args: sanitize(parsed.data), ok: result.ok } });
  } catch {
    /* already logged by writeAudit */
  }
  return result;
}
