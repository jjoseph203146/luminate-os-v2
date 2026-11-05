// Pure auth rules: no I/O, unit-tested.

import type { ActorType } from "./types";

/** profiles.role -> actor type. The existing value 'admin' is the owner. */
export function roleToActorType(role: string | null | undefined): ActorType | null {
  if (role === "admin") return "owner";
  if (role === "client") return "client";
  return null;
}

export type MfaGate = "ok" | "enroll" | "challenge";

/**
 * Decides whether a signed-in owner may use the app yet.
 * - MFA not required: always ok.
 * - Session already at aal2: ok.
 * - A verified authenticator exists (next level aal2): must verify a code.
 * - Otherwise: must enroll one first.
 */
export function mfaGate(input: {
  required: boolean;
  currentLevel: string | null | undefined; // "aal1" | "aal2" from Supabase
  nextLevel: string | null | undefined;
}): MfaGate {
  if (!input.required) return "ok";
  if (input.currentLevel === "aal2") return "ok";
  if (input.nextLevel === "aal2") return "challenge";
  return "enroll";
}

/**
 * MFA is controlled only by the AUTH_REQUIRE_MFA switch, in every environment.
 * OWNER DECISION 2026-11-05: two-step verification is switched off for now, including in
 * production. This departs from SOP 8 s4.1 (owners must use MFA). To turn it back on, set
 * AUTH_REQUIRE_MFA=true and redeploy; the enrol and challenge pages are still in place.
 */
export function isMfaRequired(_appEnv: "local" | "staging" | "production", switchOn: boolean): boolean {
  return switchOn;
}

/** Only same-site paths are allowed as a post-login destination. */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "/";
  if (raw === "/login" || raw.startsWith("/login?")) return "/";
  return raw;
}

const PUBLIC_EXACT = new Set([
  "/login",
  "/forgot-password",
  "/session-expired",
  // Needed by the browser before sign-in: the install files and the logo shown on the sign-in page.
  "/manifest.webmanifest",
  "/sw.js",
  "/logo.png",
]);

/** Paths reachable without a session. Everything else needs one. */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname === "/auth/confirm") return true;
  // The job tick checks its own bearer secret.
  if (pathname === "/api/jobs/tick") return true;
  // Install icons.
  if (pathname.startsWith("/icons/")) return true;
  // The website contact form posts here without a session (it validates and rate-limits itself).
  if (pathname === "/api/leads/create") return true;
  return false;
}
