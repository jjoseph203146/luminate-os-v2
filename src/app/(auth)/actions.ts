"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/platform/auth/actor";
import { emailOnlySchema, loginSchema, mfaCodeSchema, newPasswordSchema, parseInput } from "@/platform/auth/schemas";
import { safeNextPath } from "@/platform/auth/rules";
import { createUserClient } from "@/platform/db/server";
import { getAppSettings } from "@/platform/env";
import { RuleError, ValidationError } from "@/platform/errors";
import { formToObject } from "@/platform/action-errors";
import { runAction } from "@/platform/actions";
import type { ActionState } from "@/ui/action-state";

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = formToObject(formData);
  const result = await runAction(async () => {
    let creds: { email: string; password: string };
    try {
      creds = parseInput(loginSchema, raw);
    } catch (e) {
      if (e instanceof ValidationError) throw new RuleError("Invalid email or password.");
      throw e;
    }
    const supabase = await createUserClient();
    const { error } = await supabase.auth.signInWithPassword(creds);
    // One message for every failure, so the form never reveals which emails exist.
    if (error) throw new RuleError("Invalid email or password.");
  }, "Signed in.");
  if (result.status === "error") return result;
  return redirect(safeNextPath(typeof raw.next === "string" ? raw.next : null));
}

export async function requestPasswordResetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = formToObject(formData);
  const message = "If an account exists for that email, a reset link is on its way.";
  try {
    const { email } = parseInput(emailOnlySchema, raw);
    const { appUrl } = getAppSettings();
    const supabase = await createUserClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: appUrl ? `${appUrl}/auth/confirm?next=/reset-password` : undefined,
    });
    if (error) console.error("password reset request failed", error.status);
  } catch (e) {
    if (!(e instanceof ValidationError)) console.error("password reset request failed", e);
    if (e instanceof ValidationError) return { status: "error", message: "Enter a valid email address." };
  }
  return { status: "ok", message };
}

export async function updatePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const raw = formToObject(formData);
  const result = await runAction(async () => {
    const { password } = parseInput(newPasswordSchema, raw);
    const supabase = await createUserClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new RuleError("The password could not be updated. The link may have expired; request a new one.");
  }, "Password updated.");
  if (result.status === "error") return result;
  return redirect("/");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createUserClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// --- MFA -------------------------------------------------------------------

export type EnrollState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "started"; factorId: string; qrCode: string; secret: string };

export async function startEnrollmentAction(_prev: EnrollState, _formData: FormData): Promise<EnrollState> {
  void _prev;
  void _formData;
  await requireSession();
  try {
    const supabase = await createUserClient();
    const factors = await supabase.auth.mfa.listFactors();
    if (factors.error) throw new Error("listFactors");
    // Clear half-finished attempts so the name never collides.
    for (const f of factors.data.all.filter((f) => f.factor_type === "totp" && f.status === "unverified")) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const label = `Authenticator ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: label });
    if (error || !data) {
      return { status: "error", message: "Could not start enrollment. If you already have an authenticator, verify with it first." };
    }
    return { status: "started", factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  } catch (e) {
    console.error("mfa enroll failed", e);
    return { status: "error", message: "Could not start enrollment." };
  }
}

export async function verifyEnrollmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const raw = formToObject(formData);
  const result = await runAction(async () => {
    const { code } = parseInput(mfaCodeSchema, raw);
    const factorId = typeof raw.factorId === "string" ? raw.factorId : "";
    if (!factorId) throw new RuleError("Start enrollment first.");
    const supabase = await createUserClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw new RuleError("That code was not accepted. Check the time on your phone and try again.");
  }, "Authenticator added.");
  if (result.status === "error") return result;
  return redirect("/mfa/enroll?enrolled=1");
}

export async function verifyChallengeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const raw = formToObject(formData);
  const result = await runAction(async () => {
    const { code } = parseInput(mfaCodeSchema, raw);
    const factorId = typeof raw.factorId === "string" ? raw.factorId : "";
    if (!factorId) throw new RuleError("No authenticator selected.");
    const supabase = await createUserClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw new RuleError("That code was not accepted.");
  }, "Verified.");
  if (result.status === "error") return result;
  return redirect(safeNextPath(typeof raw.next === "string" ? raw.next : null));
}
