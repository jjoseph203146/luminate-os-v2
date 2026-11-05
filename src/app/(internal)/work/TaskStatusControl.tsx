"use client";

import { useActionState, useRef } from "react";
import { idle } from "@/ui/action-state";
import { statusLabel } from "@/domains/clients/rules";
import { TASK_STATUSES } from "@/domains/work/types";
import { setTaskStatusAction } from "./actions";

export function TaskStatusControl({ id, status }: { id: string; status: string }) {
  const [state, action, pending] = useActionState(setTaskStatusAction, idle);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`status-${id}`}>Status</label>
      <select
        id={`status-${id}`}
        name="status"
        defaultValue={status}
        disabled={pending}
        onChange={() => formRef.current?.requestSubmit()}
        className="min-h-11 rounded-lg border border-line bg-surface px-2 text-sm"
      >
        {TASK_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
      </select>
      {state.status === "error" && <span role="alert" className="text-xs text-bad">{state.message}</span>}
    </form>
  );
}
