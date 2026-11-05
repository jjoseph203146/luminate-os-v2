import { ActionForm } from "@/ui/ActionForm";
import { requireSession } from "@/platform/auth/actor";
import { updatePasswordAction } from "../actions";

export const metadata = { title: "Set a new password" };

export default async function ResetPasswordPage() {
  await requireSession();
  return (
    <section>
      <h2>Set a new password</h2>
      <p>Use 12 to 72 characters.</p>
      <ActionForm action={updatePasswordAction} submitLabel="Save password">
        <p>
          <label>
            New password <input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={72} />
          </label>
        </p>
        <p>
          <label>
            Confirm password <input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={72} />
          </label>
        </p>
      </ActionForm>
    </section>
  );
}
