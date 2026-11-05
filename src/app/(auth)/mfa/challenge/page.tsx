import { redirect } from "next/navigation";
import { ActionForm } from "@/ui/ActionForm";
import { requireSession } from "@/platform/auth/actor";
import { createUserClient } from "@/platform/db/server";
import { safeNextPath } from "@/platform/auth/rules";
import { signOutAction, verifyChallengeAction } from "../../actions";

export const metadata = { title: "Verify your sign-in" };

export default async function MfaChallengePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireSession();
  const { next } = await searchParams;
  const supabase = await createUserClient();
  const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.data?.currentLevel === "aal2") return redirect("/");
  const factors = await supabase.auth.mfa.listFactors();
  const totp = factors.data?.totp ?? [];
  const first = totp[0];
  if (!first) return redirect("/mfa/enroll");

  return (
    <section>
      <h2>Enter your authenticator code</h2>
      <ActionForm action={verifyChallengeAction} submitLabel="Verify">
        <input type="hidden" name="factorId" value={first.id} />
        <input type="hidden" name="next" value={safeNextPath(next)} />
        <p>
          <label>
            6-digit code <input name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} />
          </label>
        </p>
      </ActionForm>
      <form action={signOutAction}>
        <button type="submit">Cancel and sign out</button>
      </form>
    </section>
  );
}
