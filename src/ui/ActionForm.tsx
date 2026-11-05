"use client";

import { useActionState, type ReactNode } from "react";
import { idle, type ActionState } from "./action-state";

type Action = (previous: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * A form that shows the result of its server action.
 * Without props it is the plain form the sign-in pages style through `.auth`.
 * Settings pages pass `className`, `buttonClassName` and `note` (helper text beside the button).
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  className,
  buttonClassName,
  note,
}: {
  action: Action;
  submitLabel: string;
  children: ReactNode;
  className?: string;
  buttonClassName?: string;
  note?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, idle);
  const button = (
    <button type="submit" disabled={pending} className={buttonClassName}>
      {pending ? "Working..." : submitLabel}
    </button>
  );
  return (
    <form action={formAction} className={className}>
      {children}
      {note ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="min-w-[200px] flex-1 text-[12px] leading-[1.45] text-dim">{note}</span>
          {button}
        </div>
      ) : (
        button
      )}
      {state.status === "error" && (
        <p role="alert" className={buttonClassName ? "rounded-[10px] bg-red-soft px-3 py-2.5 text-[13.5px] text-red" : undefined}>
          {state.message}
        </p>
      )}
      {state.status === "ok" && (
        <p role="status" className={buttonClassName ? "rounded-[10px] bg-green-soft px-3 py-2.5 text-[13.5px] text-green" : undefined}>
          {state.message}
        </p>
      )}
    </form>
  );
}
