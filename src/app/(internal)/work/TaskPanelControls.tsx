"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useTransition } from "react";
import { idle } from "@/ui/action-state";
import { Icon } from "@/ui/Icon";
import { useToast } from "@/ui/Toast";
import { statusLabel } from "@/domains/clients/rules";
import { TASK_STATUSES } from "@/domains/work/types";
import { setTaskStatusAction } from "./actions";

/** Status picker for a task inside its panel. Saves as soon as it changes. */
export function TaskStatusSelect({ id, status }: { id: string; status: string }) {
  const [state, action, pending] = useActionState(setTaskStatusAction, idle);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`status-${id}`}>Status</label>
      <select
        id={`status-${id}`}
        name="status"
        defaultValue={status}
        disabled={pending}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-9 rounded-[9px] border border-line2 bg-field px-2 text-[14px] font-medium"
      >
        {TASK_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
      </select>
      {state.status === "error" && <span role="alert" className="text-[12px] text-red">{state.message}</span>}
    </form>
  );
}

/** Footer button of the task panel: marks the task complete, closes the panel and offers Undo. */
export function CompleteTaskButton({ id, closeHref }: { id: string; closeHref: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const send = async (status: "completed" | "ready") => {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("status", status);
    return setTaskStatusAction(idle, fd);
  };
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await send("completed");
          if (result.status === "error") {
            toast({ message: result.message });
            return;
          }
          toast({
            message: "Task completed",
            undo: async () => {
              const back = await send("ready");
              if (back.status === "error") toast({ message: back.message });
            },
          });
          router.push(closeHref, { scroll: false });
        })
      }
      className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-primary bg-primary text-[15px] font-semibold text-on-primary disabled:opacity-60"
    >
      <Icon name="check" size={20} />
      {pending ? "Saving..." : "Mark complete"}
    </button>
  );
}
