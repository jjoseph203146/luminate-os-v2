import Link from "next/link";
import { requireOwner } from "@/platform/auth/actor";
import { getWorkOverview } from "@/domains/work/service";
import { priorityRank } from "@/domains/work/rules";
import { ageLabel, statusLabel } from "@/domains/clients/rules";
import { StatusBadge, type Tone } from "@/ui/StatusBadge";
import { TaskStatusControl } from "./TaskStatusControl";

export const metadata = { title: "Work" };

const PRIORITY_TONE: Record<string, Tone> = { urgent: "bad", high: "warn", normal: "neutral", low: "neutral" };

export default async function WorkPage() {
  const actor = await requireOwner();
  const { today, tasks, requests } = await getWorkOverview(actor);
  const now = new Date();
  const sorted = [...tasks].sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      priorityRank(b.priority) - priorityRank(a.priority) ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Work</h1>

      <section aria-labelledby="tasks-h" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 id="tasks-h" className="text-lg font-semibold">Tasks</h2>
          <span className="text-sm text-muted">{sorted.length} open</span>
        </div>
        {sorted.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">No open tasks. Use Add to create one.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((t) => (
              <li key={t.id} id={`task-${t.id}`} className="scroll-mt-20 rounded-xl border border-line bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{t.title}</p>
                    <p className="text-xs text-muted">
                      {t.clientId ? (
                        <Link href={`/clients/${t.clientId}`} className="underline">{t.clientName ?? "Client"}</Link>
                      ) : (
                        "Business to-do"
                      )}
                      {t.dueDate ? ` · due ${t.dueDate}${t.dueDate === today ? " (today)" : ""}` : ""}
                      {t.overdue ? " · overdue" : ""}
                      {` · updated ${ageLabel(t.updatedAt, now)}`}
                    </p>
                    {t.description && <p className="mt-1 whitespace-pre-line text-sm text-muted">{t.description}</p>}
                  </div>
                  <StatusBadge tone={t.overdue ? "bad" : (PRIORITY_TONE[t.priority] ?? "neutral")}>{statusLabel(t.priority)}</StatusBadge>
                </div>
                <div className="mt-2"><TaskStatusControl id={t.id} status={t.status} /></div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="req-h" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 id="req-h" className="text-lg font-semibold">Open requests</h2>
          <span className="text-sm text-muted">{requests.length}</span>
        </div>
        {requests.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">No open requests.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {requests.map((r) => (
              <li key={r.id}>
                <Link href={`/clients/${r.clientId}#care`} className="flex min-h-16 flex-col gap-1 rounded-xl border border-line bg-surface p-3">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted">#{r.displayId}</span>
                    <StatusBadge tone={r.status === "waiting_on_client" ? "warn" : "info"}>{statusLabel(r.status)}</StatusBadge>
                  </span>
                  <span className="font-medium">{r.title}</span>
                  <span className="text-xs text-muted">{r.clientName ?? "Client"} · opened {ageLabel(r.createdAt, now)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">Request status is changed in the existing app for now.</p>
      </section>
    </div>
  );
}
