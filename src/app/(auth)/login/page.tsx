import Link from "next/link";
import { ActionForm } from "@/ui/ActionForm";
import { safeNextPath } from "@/platform/auth/rules";
import { signInAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <section>
      <h2>Sign in</h2>
      {error === "link" && <p role="alert">That link is invalid or has expired. Request a new one.</p>}
      <ActionForm action={signInAction} submitLabel="Sign in">
        <input type="hidden" name="next" value={safeNextPath(next)} />
        <p>
          <label>
            Email <input name="email" type="email" autoComplete="username" required />
          </label>
        </p>
        <p>
          <label>
            Password <input name="password" type="password" autoComplete="current-password" required />
          </label>
        </p>
      </ActionForm>
      <p>
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
    </section>
  );
}
