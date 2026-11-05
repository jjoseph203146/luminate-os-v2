import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/platform/auth/actor";
import { createUserClient } from "@/platform/db/server";
import { getAppSettings } from "@/platform/env";
import { EnrollFlow } from "./EnrollFlow";

export const metadata = { title: "Set up two-step verification" };

export default async function MfaEnrollPage({ searchParams }: { searchParams: Promise<{ enrolled?: string }> }) {
  await requireSession();
  const { enrolled } = await searchParams;
  const supabase = await createUserClient();
  const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  // With an authenticator already set up, adding another needs a verified code first.
  if (aal.data?.currentLevel === "aal1" && aal.data.nextLevel === "aal2") return redirect("/mfa/challenge");
  const factors = await supabase.auth.mfa.listFactors();
  const count = factors.data?.totp.length ?? 0;
  const { mfaRequired } = getAppSettings();

  return (
    <section>
      <h2>Two-step verification</h2>
      {!mfaRequired && <p>Two-step verification is currently switched off. You can still add an authenticator now; it is used only if the switch is turned on.</p>}
      <p>
        Authenticators on this account: <strong>{count}</strong>
        {count < 2 && " (add a second one on another device so you can still sign in if you lose a phone)"}
      </p>
      {enrolled && count > 0 && <p role="status">Authenticator added.</p>}
      <EnrollFlow />
      {count > 0 && (
        <p>
          <Link href="/">Continue to Luminate OS</Link>
        </p>
      )}
    </section>
  );
}
