"use client";

import { useActionState, type ReactNode } from "react";
import { idle, type ActionState } from "./action-state";

type Action = (previous: ActionState, formData: FormData) => Promise<ActionState>;

/** A plain form that shows the result of its server action. No styling yet. */
export function ActionForm({
  action,
  submitLabel,
  children,
}: {
  action: Action;
  submitLabel: string;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, idle);
  return (
    <form action={formAction}>
      {children}
      <button type="submit" disabled={pending}>
        {pending ? "Working..." : submitLabel}
      </button>
      {state.status === "error" && <p role="alert">{state.message}</p>}
      {state.status === "ok" && <p role="status">{state.message}</p>}
    </form>
  );
}
