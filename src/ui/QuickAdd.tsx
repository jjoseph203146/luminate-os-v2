"use client";

import { useActionState, useEffect, useState } from "react";
import { createRequestAction, createTaskAction } from "@/app/(internal)/work/actions";
import { idle } from "@/ui/action-state";
import { Sheet } from "@/ui/Sheet";
import type { ClientOption } from "@/domains/work/types";

const field = "min-h-12 w-full rounded-lg border border-line bg-surface px-3 text-base";
const label = "mb-1 block text-sm font-medium";
const submit = "min-h-12 w-full rounded-lg bg-brand px-4 font-semibold text-brand-ink disabled:opacity-60";

function newKey(): string {
  return globalThis.crypto.randomUUID();
}

function RequestForm({ clients, onDone }: { clients: ClientOption[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(createRequestAction, idle);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div>
        <label htmlFor="qa-client" className={label}>Client</label>
        <select id="qa-client" name="clientId" required defaultValue="" className={field}>
          <option value="" disabled>Choose a client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="qa-title" className={label}>What do they need?</label>
        <input id="qa-title" name="title" required minLength={3} maxLength={200} className={field} />
      </div>
      <div>
        <label htmlFor="qa-desc" className={label}>Details (optional)</label>
        <textarea id="qa-desc" name="description" rows={4} maxLength={4000} className={`${field} py-2`} />
      </div>
      <button type="submit" disabled={pending} className={submit}>{pending ? "Saving..." : "Save request"}</button>
      {state.status === "error" && <p role="alert" className="text-sm text-bad">{state.message}</p>}
      {state.status === "ok" && (
        <p role="status" className="text-sm text-ok">
          {state.message}{" "}
          <button type="button" onClick={onDone} className="underline">Close</button>
        </p>
      )}
    </form>
  );
}

function TaskForm({ clients, onDone }: { clients: ClientOption[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(createTaskAction, idle);
  // Made after mount so the server render and the browser agree.
  const [key, setKey] = useState("");
  useEffect(() => setKey(newKey()), []);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="submissionKey" value={key} />
      <div>
        <label htmlFor="qt-title" className={label}>Task</label>
        <input id="qt-title" name="title" required minLength={3} maxLength={200} className={field} />
      </div>
      <div>
        <label htmlFor="qt-client" className={label}>Client (leave empty for a business to-do)</label>
        <select id="qt-client" name="clientId" defaultValue="" className={field}>
          <option value="">No client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="qt-priority" className={label}>Priority</label>
          <select id="qt-priority" name="priority" defaultValue="normal" className={field}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div>
          <label htmlFor="qt-due" className={label}>Due date</label>
          <input id="qt-due" name="dueDate" type="date" className={field} />
        </div>
      </div>
      <div>
        <label htmlFor="qt-desc" className={label}>Notes (optional)</label>
        <textarea id="qt-desc" name="description" rows={3} maxLength={4000} className={`${field} py-2`} />
      </div>
      <button type="submit" disabled={pending || key === ""} className={submit}>{pending ? "Saving..." : "Save task"}</button>
      {state.status === "error" && <p role="alert" className="text-sm text-bad">{state.message}</p>}
      {state.status === "ok" && (
        <p role="status" className="text-sm text-ok">
          {state.message}{" "}
          <button type="button" onClick={onDone} className="underline">Close</button>
        </p>
      )}
    </form>
  );
}

export function QuickAdd({ clients, clientsError }: { clients: ClientOption[]; clientsError: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"request" | "task">("request");
  // Changing this remounts the forms, so each opening starts blank with a fresh task key.
  const [round, setRound] = useState(0);

  const close = () => {
    setOpen(false);
    setRound((n) => n + 1);
  };
  const tabClass = (active: boolean) =>
    `min-h-11 flex-1 rounded-lg text-sm font-medium ${active ? "bg-surface-muted text-brand" : "text-muted"}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Quick add"
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-14 items-center gap-2 rounded-full bg-brand px-5 font-semibold text-brand-ink shadow-lg md:bottom-6 md:right-6"
      >
        <span aria-hidden="true" className="text-xl leading-none">+</span> Add
      </button>
      <Sheet open={open} onClose={close} title="Quick add">
        <div role="tablist" aria-label="What to add" className="mb-4 flex gap-2">
          <button role="tab" type="button" aria-selected={tab === "request"} onClick={() => setTab("request")} className={tabClass(tab === "request")}>New request</button>
          <button role="tab" type="button" aria-selected={tab === "task"} onClick={() => setTab("task")} className={tabClass(tab === "task")}>New task</button>
        </div>
        {clientsError && <p role="alert" className="mb-3 text-sm text-bad">The client list could not be loaded. Reload the page.</p>}
        {tab === "request" ? <RequestForm key={`r${round}`} clients={clients} onDone={close} /> : <TaskForm key={`t${round}`} clients={clients} onDone={close} />}
      </Sheet>
    </>
  );
}
