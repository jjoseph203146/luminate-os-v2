"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { createRequestAction, createTaskAction } from "@/app/(internal)/work/actions";
import { idle, type ActionState } from "@/ui/action-state";
import { Icon } from "@/ui/Icon";
import { Sheet } from "@/ui/Sheet";
import { REQUEST_SOURCES, SOURCE_LABELS, type ClientOption } from "@/domains/work/types";

export type QuickAddMode = "request" | "task";

const label = "text-[12px] font-semibold uppercase tracking-[.08em] text-dim";
const input =
  "w-full rounded-xl border border-line2 bg-field text-[16px] text-ink outline-none focus:border-blue focus:shadow-[0_0_0_3px_var(--blue-soft)]";
const PRIORITIES = [
  ["low", "Low"],
  ["normal", "Normal"],
  ["high", "High"],
  ["urgent", "Urgent"],
] as const;

function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** One selectable pill. Selected = filled with the primary colour, like the prototype's filters. */
function Chip({ on, onClick, children, mono }: { on: boolean; onClick: () => void; children: string; mono?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`h-9 rounded-full border px-3 text-[14px] font-medium ${mono ? "font-mono text-[13px] font-normal" : ""} ${on ? "border-primary bg-primary text-on-primary" : "border-line2 bg-surface text-ink"}`}
    >
      {children}
    </button>
  );
}

function ClientPicker({
  clients,
  value,
  onChange,
  optional,
}: {
  clients: ClientOption[];
  value: string;
  onChange: (id: string) => void;
  optional: boolean;
}) {
  const [q, setQ] = useState("");
  const selected = clients.find((c) => c.id === value) ?? null;
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? clients.filter((c) => c.name.toLowerCase().includes(needle) || c.websites.some((w) => w.toLowerCase().includes(needle)))
      : clients;
    return list.slice(0, 6);
  }, [clients, q]);

  return (
    <div className="flex flex-col gap-1.5">
      <span className={label}>{optional ? "Client (optional)" : "Client"}</span>
      {selected ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-line2 bg-field py-2 pl-2.5 pr-1.5">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-[9px] bg-hero text-[12px] font-semibold text-white">{initials(selected.name)}</span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[15px] font-medium">{selected.name}</span>
            <span className="block truncate text-[12px] text-dim">{selected.websites[0] ?? "No website recorded"}</span>
          </span>
          <button type="button" onClick={() => onChange("")} className="h-9 px-2.5 text-[14px] font-medium text-blue">Change</button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line2 bg-field">
          <div className="relative border-b border-line">
            <Icon name="search" size={20} className="pointer-events-none absolute left-3 top-3 text-dim" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search clients"
              aria-label="Search clients"
              className="h-[46px] w-full border-0 bg-transparent pl-10 pr-3 text-[16px] text-ink outline-none"
            />
          </div>
          {results.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
              className={`flex min-h-[50px] w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-hover ${i > 0 ? "border-t border-line" : ""}`}
            >
              <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-lg bg-chip text-[11px] font-semibold">{initials(c.name)}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[14px] font-medium">{c.name}</span>
                <span className="block truncate text-[12px] text-dim">{c.websites[0] ?? "No website recorded"}</span>
              </span>
            </button>
          ))}
          {results.length === 0 && <div className="p-3 text-[13px] text-dim">{clients.length === 0 ? "No clients to choose from." : "No matching clients."}</div>}
        </div>
      )}
      <input type="hidden" name="clientId" value={value} />
    </div>
  );
}

function Segment<T extends string>({ options, value, onChange }: { options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`h-10 rounded-[10px] border text-[14px] font-medium ${value === v ? "border-primary bg-primary text-on-primary" : "border-line2 bg-surface text-ink"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function localIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Due-date choices, worked out in the browser so "Today" is the owner's today. */
function dueChoices(): { key: string; text: string; iso: string }[] {
  const base = new Date();
  const plus = (n: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + n);
    return d;
  };
  const third = plus(2);
  return [
    { key: "today", text: "Today", iso: localIso(plus(0)) },
    { key: "tomorrow", text: "Tomorrow", iso: localIso(plus(1)) },
    { key: "third", text: third.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), iso: localIso(third) },
    { key: "week", text: "Next week", iso: localIso(plus(7)) },
    { key: "none", text: "No date", iso: "" },
  ];
}

function Done({ title, message, onAnother, onClose }: { title: string; message: string; onAnother: () => void; onClose: () => void }) {
  return (
    <div role="status" className="flex flex-col items-center gap-2.5 px-4 py-8 text-center">
      <div className="lx-up grid h-[60px] w-[60px] place-items-center rounded-full bg-green-soft text-green">
        <Icon name="check" size={32} />
      </div>
      <div className="text-[20px] font-semibold">{title}</div>
      <div className="max-w-[380px] text-[14px] leading-normal text-dim">{message}</div>
      <div className="mt-2.5 flex w-full max-w-[380px] gap-2">
        <button type="button" onClick={onAnother} className="h-12 flex-1 rounded-xl border border-line2 bg-surface text-[15px] font-semibold">Add another</button>
        <Link href="/work" onClick={onClose} className="grid h-12 flex-1 place-items-center rounded-xl bg-primary text-[15px] font-semibold text-on-primary">View in Work</Link>
      </div>
    </div>
  );
}

function FormFooter({ hint, hintBad, pending, saveLabel, ready, onBlocked }: { hint: string; hintBad: boolean; pending: boolean; saveLabel: string; ready: boolean; onBlocked: () => void }) {
  return (
    <div className="flex flex-none items-center gap-3 border-t border-line px-4 pb-[max(34px,env(safe-area-inset-bottom))] pt-3 md:px-5 md:py-3.5">
      <span className={`flex-1 text-[12px] leading-snug ${hintBad ? "text-red" : "text-dim"}`}>{hint}</span>
      <button
        type="submit"
        disabled={pending}
        onClick={(e) => {
          if (!ready) {
            e.preventDefault();
            onBlocked();
          }
        }}
        className={`h-12 flex-none rounded-xl px-5 text-[15px] font-semibold ${ready ? "bg-primary text-on-primary" : "bg-chip text-dim"}`}
      >
        {pending ? "Saving..." : saveLabel}
      </button>
    </div>
  );
}

function ErrorLine({ state }: { state: ActionState }) {
  return state.status === "error" ? <p role="alert" className="text-[13px] text-red">{state.message}</p> : null;
}

function RequestForm({ clients, initialClientId, onClose, onAnother }: { clients: ClientOption[]; initialClientId: string; onClose: () => void; onAnother: () => void }) {
  const [state, action, pending] = useActionState(createRequestAction, idle);
  const [clientId, setClientId] = useState(initialClientId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number][0]>("normal");
  const [source, setSource] = useState<string>("");
  const [site, setSite] = useState("");
  const [tried, setTried] = useState(false);
  const websites = clients.find((c) => c.id === clientId)?.websites ?? [];
  const missing = [!clientId && "a client", !title.trim() && "a title"].filter(Boolean) as string[];

  if (state.status === "ok") {
    return <Done title="Request saved" message={state.message} onAnother={onAnother} onClose={onClose} />;
  }
  return (
    <form action={action} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <ClientPicker clients={clients} value={clientId} onChange={(id) => { setClientId(id); setSite(""); }} optional={false} />
        {websites.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className={label}>Website</span>
            <div className="flex flex-wrap gap-2">
              {websites.map((w) => (
                <Chip key={w} mono on={site === w} onClick={() => setSite(site === w ? "" : w)}>{w}</Chip>
              ))}
            </div>
            <input type="hidden" name="websiteUrl" value={site} />
          </div>
        )}
        <label className="flex flex-col gap-1.5">
          <span className={label}>Title</span>
          <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Update holiday hours banner" className={`${input} h-12 px-3.5`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>Details (optional)</span>
          <textarea name="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={4000} placeholder="Anything that helps later" className={`${input} resize-y px-3.5 py-3 leading-[1.45]`} />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={label}>Priority</span>
          <Segment options={PRIORITIES} value={priority} onChange={setPriority} />
          <input type="hidden" name="priority" value={priority} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={label}>Came in by</span>
          <div className="flex flex-wrap gap-2">
            {REQUEST_SOURCES.map((s) => (
              <Chip key={s} on={source === s} onClick={() => setSource(s)}>{SOURCE_LABELS[s]}</Chip>
            ))}
            <Chip on={source === ""} onClick={() => setSource("")}>Not recorded</Chip>
          </div>
          <input type="hidden" name="source" value={source} />
        </div>
        <ErrorLine state={state} />
      </div>
      <FormFooter
        hint={missing.length ? `Add ${missing.join(" and ")} to save.` : "Saves as New · shows on Today and in Work"}
        hintBad={tried && missing.length > 0}
        pending={pending}
        saveLabel="Save request"
        ready={missing.length === 0}
        onBlocked={() => setTried(true)}
      />
    </form>
  );
}

function TaskForm({ clients, initialClientId, onClose, onAnother }: { clients: ClientOption[]; initialClientId: string; onClose: () => void; onAnother: () => void }) {
  const [state, action, pending] = useActionState(createTaskAction, idle);
  const [clientId, setClientId] = useState(initialClientId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number][0]>("normal");
  const [tried, setTried] = useState(false);
  // Made after mount so the server render and the browser agree.
  const [key, setKey] = useState("");
  const [dues, setDues] = useState<ReturnType<typeof dueChoices>>([]);
  const [dueKey, setDueKey] = useState("none");
  useEffect(() => {
    setKey(globalThis.crypto.randomUUID());
    setDues(dueChoices());
  }, []);
  const dueIso = dues.find((d) => d.key === dueKey)?.iso ?? "";
  const missing = [!title.trim() && "a title"].filter(Boolean) as string[];

  if (state.status === "ok") {
    return <Done title="Task saved" message={state.message} onAnother={onAnother} onClose={onClose} />;
  }
  return (
    <form action={action} className="flex min-h-0 flex-1 flex-col">
      <input type="hidden" name="submissionKey" value={key} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <label className="flex flex-col gap-1.5">
          <span className={label}>Task</span>
          <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Reconcile November expenses" className={`${input} h-12 px-3.5`} />
        </label>
        <ClientPicker clients={clients} value={clientId} onChange={setClientId} optional />
        <div className="flex flex-col gap-1.5">
          <span className={label}>Due</span>
          <div className="flex flex-wrap gap-2">
            {dues.map((d) => (
              <Chip key={d.key} on={dueKey === d.key} onClick={() => setDueKey(d.key)}>{d.text}</Chip>
            ))}
          </div>
          <input type="hidden" name="dueDate" value={dueIso} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={label}>Priority</span>
          <Segment options={PRIORITIES} value={priority} onChange={setPriority} />
          <input type="hidden" name="priority" value={priority} />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={label}>Details (optional)</span>
          <textarea name="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={4000} placeholder="Anything that helps later" className={`${input} resize-y px-3.5 py-3 leading-[1.45]`} />
        </label>
        <ErrorLine state={state} />
      </div>
      <FormFooter
        hint={missing.length ? `Add ${missing.join(" and ")} to save.` : "Saves to your task list"}
        hintBad={tried && missing.length > 0}
        pending={pending || key === ""}
        saveLabel="Save task"
        ready={missing.length === 0}
        onBlocked={() => setTried(true)}
      />
    </form>
  );
}

export function QuickAdd({
  open,
  onClose,
  initialMode,
  initialClientId,
  clients,
  clientsError,
}: {
  open: boolean;
  onClose: () => void;
  initialMode: QuickAddMode;
  initialClientId: string;
  clients: ClientOption[];
  clientsError: boolean;
}) {
  const [mode, setMode] = useState<QuickAddMode>(initialMode);
  const [round, setRound] = useState(0);
  // Re-open on the requested tab.
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setRound((n) => n + 1);
    }
  }, [open, initialMode]);

  const modes: [QuickAddMode, string, "inbox" | "task_alt"][] = [
    ["request", "Client request", "inbox"],
    ["task", "Internal task", "task_alt"],
  ];
  const tabs = (
    <div role="tablist" aria-label="What to add" className="grid grid-cols-2 gap-0.5 rounded-[11px] bg-chip p-[3px]">
      {modes.map(([value, text, icon]) => (
        <button
          key={value}
          role="tab"
          type="button"
          aria-selected={mode === value}
          onClick={() => setMode(value)}
          className={`flex h-10 items-center justify-center gap-1.5 rounded-[9px] text-[14px] font-semibold ${mode === value ? "bg-surface text-ink shadow-[0_1px_3px_rgba(13,27,46,.16)]" : "text-dim"}`}
        >
          <Icon name={icon} size={18} />
          {text}
        </button>
      ))}
    </div>
  );
  const again = () => setRound((n) => n + 1);
  return (
    <Sheet open={open} onClose={onClose} title="Quick add" header={tabs}>
      {clientsError && <p role="alert" className="px-4 pt-3 text-[13px] text-red">The client list could not be loaded. Reload the page.</p>}
      {mode === "request" ? (
        <RequestForm key={`r${round}`} clients={clients} initialClientId={initialClientId} onClose={onClose} onAnother={again} />
      ) : (
        <TaskForm key={`t${round}`} clients={clients} initialClientId={initialClientId} onClose={onClose} onAnother={again} />
      )}
    </Sheet>
  );
}
