"use client";

import { useState, useTransition } from "react";
import { setTaskStatusAction } from "@/app/(internal)/work/actions";
import { idle } from "@/ui/action-state";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

async function setStatus(id: string, status: "completed" | "ready"): Promise<string | null> {
  const fd = new FormData();
  fd.set("id", id);
  fd.set("status", status);
  const result = await setTaskStatusAction(idle, fd);
  return result.status === "error" ? result.message : null;
}

/** Round check box for a task. Completing shows an Undo for a few seconds. */
export function TaskCheck({ id, done, title }: { id: string; done: boolean; title: string }) {
  const toast = useToast();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [, start] = useTransition();
  const shown = optimistic ?? done;

  const toggle = () => {
    const next = !shown;
    setOptimistic(next);
    start(async () => {
      const error = await setStatus(id, next ? "completed" : "ready");
      if (error) {
        setOptimistic(null);
        toast({ message: error });
        return;
      }
      if (next) {
        toast({
          message: "Task completed",
          undo: async () => {
            const undoError = await setStatus(id, "ready");
            if (undoError) toast({ message: undoError });
          },
        });
      }
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={shown ? `Mark "${title}" not done` : `Mark "${title}" done`}
      aria-pressed={shown}
      className="-mx-[5px] -my-2 grid h-11 w-11 flex-none place-items-center"
    >
      <span
        className={`grid h-[22px] w-[22px] place-items-center rounded-full border-[1.5px] transition-colors ${shown ? "border-green bg-green text-white" : "border-line3 bg-transparent text-transparent"}`}
      >
        <Icon name="check" size={16} />
      </span>
    </button>
  );
}
