// Who is acting. Every service function takes an Actor (docs/architecture/04 s2).

export type ActorType = "owner" | "contractor" | "client" | "system" | "integration" | "ai";

export type Actor =
  | { type: "owner"; userId: string; email: string | null; ip: string | null }
  | { type: "system"; name: string }
  /** An AI assistant reaching the app through the read-only connector (/api/mcp). It never has a session. */
  | { type: "ai"; name: string };

export function actorId(actor: Actor): string | null {
  return actor.type === "owner" ? actor.userId : null;
}

export function actorIp(actor: Actor): string | null {
  return actor.type === "owner" ? actor.ip : null;
}
