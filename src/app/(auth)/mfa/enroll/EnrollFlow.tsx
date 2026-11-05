"use client";

import { useActionState } from "react";
import { ActionForm } from "@/ui/ActionForm";
import { startEnrollmentAction, verifyEnrollmentAction, type EnrollState } from "../../actions";

const start: EnrollState = { status: "idle" };

export function EnrollFlow() {
  const [state, begin, pending] = useActionState(startEnrollmentAction, start);

  if (state.status !== "started") {
    return (
      <form action={begin}>
        <button type="submit" disabled={pending}>
          {pending ? "Working..." : "Set up an authenticator app"}
        </button>
        {state.status === "error" && <p role="alert">{state.message}</p>}
      </form>
    );
  }

  return (
    <div>
      <p>Scan this code with an authenticator app (for example Google Authenticator, 1Password or Authy), then enter the 6-digit code it shows.</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URI from Supabase */}
      <img src={state.qrCode} alt="QR code for your authenticator app" width={200} height={200} />
      <p>
        Can&apos;t scan? Enter this key by hand: <code>{state.secret}</code>
      </p>
      <ActionForm action={verifyEnrollmentAction} submitLabel="Verify and add">
        <input type="hidden" name="factorId" value={state.factorId} />
        <p>
          <label>
            6-digit code <input name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} />
          </label>
        </p>
      </ActionForm>
    </div>
  );
}
