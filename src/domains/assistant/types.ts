import type { z } from "zod";
import type { Actor } from "@/platform/auth/types";

/**
 * One read-only tool the AI assistant can call (through /api/mcp).
 * Rules for every tool:
 *  - read only: it never writes anything;
 *  - it reads through the existing domain services (never the database directly), as the `ai` actor;
 *  - it returns an explicit allow-list of fields (see shape.ts). No emails, phone numbers, contact names,
 *    notes, descriptions, comments, file paths or ids from other systems (Stripe etc.).
 */
export interface ToolDef {
  /** snake_case, stable: assistants remember it. */
  name: string;
  /** Short human title. */
  title: string;
  /** Tells the assistant when to use the tool and what it returns. */
  description: string;
  /** zod shape of the arguments ({} when none). Every field needs .describe(). */
  inputShape: z.ZodRawShape;
  run: (actor: Actor, args: Record<string, unknown>) => Promise<unknown>;
}

export type ToolResult = { ok: true; data: unknown; truncated: boolean } | { ok: false; error: string };

/** What the connector shows about a tool (no handler). */
export interface ToolInfo {
  name: string;
  title: string;
  description: string;
  inputShape: z.ZodRawShape;
}
