// Marks an audit payload with which bot made the change. Kept out of audit.ts so tests
// that mock the audit writer still run the real stamp.
import type { Actor } from "@/platform/auth/types";

/** Owner and other actors are unchanged. A bot actor gains `bot: <name>` on the after payload. */
export function stampActor(actor: Actor, after: Record<string, unknown>): Record<string, unknown> {
  if (actor.type !== "bot") return after;
  return { ...after, bot: actor.name };
}
