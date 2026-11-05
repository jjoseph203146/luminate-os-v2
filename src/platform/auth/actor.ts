// Resolves the signed-in user into an Actor and applies the guards.
// Server-only. Pages, layouts and server actions all call requireOwner().
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createUserClient } from "@/platform/db/server";
import { getAppSettings } from "@/platform/env";
import { mfaGate, roleToActorType, type MfaGate } from "./rules";
import type { Actor } from "./types";

export type ActorState =
  | { kind: "anonymous" }
  | { kind: "no_access"; email: string | null }
  | { kind: "mfa_required"; gate: Exclude<MfaGate, "ok"> }
  | { kind: "ok"; actor: Extract<Actor, { type: "owner" }> };

async function requestIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || h.get("x-real-ip") || null)?.slice(0, 64) ?? null;
}

export const getActorState = cache(async (): Promise<ActorState> => {
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { kind: "anonymous" };
  const user = data.user;

  const profile = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  // Phase 2 has one internal role: the owner. Clients get no access to this app yet.
  if (profile.error || roleToActorType(profile.data?.role) !== "owner") {
    return { kind: "no_access", email: user.email ?? null };
  }

  const settings = getAppSettings();
  if (settings.mfaRequired) {
    const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const gate = mfaGate({
      required: true,
      currentLevel: aal.data?.currentLevel ?? null,
      nextLevel: aal.data?.nextLevel ?? null,
    });
    if (gate !== "ok") return { kind: "mfa_required", gate };
  }

  return { kind: "ok", actor: { type: "owner", userId: user.id, email: user.email ?? null, ip: await requestIp() } };
});

/** For pages, layouts and server actions: returns the owner or redirects. */
export async function requireOwner(): Promise<Extract<Actor, { type: "owner" }>> {
  const state = await getActorState();
  switch (state.kind) {
    case "ok":
      return state.actor;
    case "anonymous":
      return redirect("/login");
    case "no_access":
      return redirect("/access-denied");
    case "mfa_required":
      return redirect(state.gate === "enroll" ? "/mfa/enroll" : "/mfa/challenge");
  }
}

/** For the MFA and access-denied pages: needs a session but not a finished MFA step. */
export async function requireSession(): Promise<{ userId: string; email: string | null }> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return redirect("/login");
  return { userId: data.user.id, email: data.user.email ?? null };
}
