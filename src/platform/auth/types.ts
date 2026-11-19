// Who is acting. Every service function takes an Actor (docs/architecture/04 s2).

export type ActorType = "owner" | "contractor" | "client" | "system" | "integration" | "ai" | "bot";

export type Actor =
  | { type: "owner"; userId: string; email: string | null; ip: string | null }
  | { type: "system"; name: string }
  /** An AI assistant reaching the app through the read-only connector (/api/mcp). It never has a session. */
  | { type: "ai"; name: string }
  /** An outside system calling in with a verified signature (the Stripe webhook). It never has a session. */
  | { type: "integration"; name: string }
  /**
   * A named assistant bot calling POST /api/bot/writes. It never has a session.
   * `name` is the X-Bot-Name header (which bot), stored on the audit row.
   */
  | { type: "bot"; name: string; ip: string | null };

export function actorId(actor: Actor): string | null {
  return actor.type === "owner" ? actor.userId : null;
}

export function actorIp(actor: Actor): string | null {
  if (actor.type === "owner" || actor.type === "bot") return actor.ip;
  return null;
}
