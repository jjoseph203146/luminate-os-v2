import { requireSession } from "@/platform/auth/actor";
import { signOutAction } from "../actions";

export const metadata = { title: "Access denied" };

export default async function AccessDeniedPage() {
  const user = await requireSession();
  return (
    <section>
      <h2>Access denied</h2>
      <p>
        {user.email ?? "This account"} does not have access to Luminate OS. If this is a mistake, ask the owner to check
        your account.
      </p>
      <form action={signOutAction}>
        <button type="submit">Sign out</button>
      </form>
    </section>
  );
}
