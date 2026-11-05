import Link from "next/link";
import { ActionForm } from "@/ui/ActionForm";
import { requestPasswordResetAction } from "../actions";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <section>
      <h2>Forgot your password?</h2>
      <p>Enter your email and we will send a reset link if an account exists.</p>
      <ActionForm action={requestPasswordResetAction} submitLabel="Send reset link">
        <p>
          <label>
            Email <input name="email" type="email" autoComplete="username" required />
          </label>
        </p>
      </ActionForm>
      <p>
        <Link href="/login">Back to sign in</Link>
      </p>
    </section>
  );
}
