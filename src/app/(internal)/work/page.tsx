import Link from "next/link";
import { requireOwner } from "@/platform/auth/actor";
import { getWorkOverview } from "@/domains/work/service";
import { priorityRank } from "@/domains/work/rules";
import { SOURCE_LABELS, type REQUEST_SOURCES, type WorkProject, type WorkRequest, type WorkTask } from "@/domains/work/types";
import { ageLabel, safeUrl, statusLabel } from "@/domains/clients/rules";
import { Icon } from "@/ui/Icon";
import { EmptyNote, Group, ListRow, Pill, type KitTone } from "@/ui/kit";
import { Panel } from "@/ui/Panel";
import { Kv, KvCard, ChipLink, PanelLabel, TextCard } from "@/ui/records";
import { PageTitle } from "@/ui/shell/PageTitle";
import { CompleteTaskButton, TaskStatusSelect } from "./TaskPanelControls";

export const metadata = { title: "Work" };

const VIEWS = ["attention", "requests", "projects", "tasks"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = { attention: "Needs attention", requests: "Requests", projects: "Projects", tasks: "Tasks" };

const PRIORITY_TONE: Record<string, KitTone> = { urgent: "red", high: "amber", normal: "blue", low: "gray" };
const REQUEST_STATUS_TONE: Record<string, KitTone> = { new: "blue", in_review: "blue", in_progress: "amber", waiting_on_client: "gray", completed: "green" };

type SearchParams = Promise<{ view?: string | string[]; request?: string | string[]; task?: string | string[] }>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function dueLabel(iso: string | null): string {
  if (!iso) return "No date";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isHigh = (p: string | null) => p === "urgent" || p === "high";

function requestRow(r: WorkRequest, view: View, now: Date) {
  const isNew = r.status === "new";
  const pillTone: KitTone = isNew ? (isHigh(r.priority) ? (PRIORITY_TONE[r.priority!] ?? "blue") : "blue") : (REQUEST_STATUS_TONE[r.status] ?? "gray");
  return (
    <ListRow
      key={`r-${r.id}`}
      href={`/work?view=${view}&request=${r.id}`}
      icon={r.status === "waiting_on_client" ? "hourglass_top" : "inbox"}
      tone={isNew ? (isHigh(r.priority) ? (PRIORITY_TONE[r.priority!] ?? "blue") : "blue") : "gray"}
      title={r.title}
      code={r.displayId}
      sub={r.clientName ?? "Client"}
      pill={isNew ? (isHigh(r.priority) ? cap(r.priority!) : "New") : statusLabel(r.status)}
      pillTone={pillTone}
      meta={ageLabel(r.createdAt, now)}
    />
  );
}

function taskRow(t: WorkTask, view: View) {
  const hi = isHigh(t.priority);
  const status = t.status === "ready" ? "" : statusLabel(t.status);
  return (
    <ListRow
      key={`t-${t.id}`}
      href={`/work?view=${view}&task=${t.id}`}
      check={{ id: t.id, done: false, title: t.title }}
      title={t.title}
      sub={t.clientName ?? "Business to-do"}
      pill={hi ? cap(t.priority) : status || undefined}
      pillTone={hi ? (PRIORITY_TONE[t.priority] ?? "gray") : "gray"}
      meta={t.overdue ? `Overdue · ${dueLabel(t.dueDate)}` : dueLabel(t.dueDate)}
      metaBad={t.overdue}
    />
  );
}

function ProjectCard({ p }: { p: WorkProject }) {
  const launched = p.launchedAt !== null;
  const statusText = launched ? "Launched" : statusLabel(p.contractStatus);
  const tone: KitTone = launched ? "green" : p.blockerNote ? "amber" : "blue";
  const body = (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">{p.name ?? "Unnamed project"}</div>
          <div className="mt-0.5 text-[13px] text-dim">{p.clientName ?? "No client"}</div>
        </div>
        {p.framework && <span className="rounded-full bg-chip px-2 py-1 text-[12px] font-medium text-dim">{p.framework}</span>}
        <Pill tone={tone}>{statusText}</Pill>
      </div>
      {p.targetDate && !launched && <div className="text-[13px] text-dim">Target · <span className="font-medium text-ink">{dueLabel(p.targetDate)}</span></div>}
      {p.blockerNote && (
        <div className="flex flex-col-reverse gap-px text-[13px] leading-[1.45] text-red md:flex-row md:gap-1.5">
          <span className="flex-1">{p.blockerNote}</span>
          <Icon name="error" size={16} />
        </div>
      )}
    </>
  );
  const cls = "flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface px-4 py-3.5 hover:border-line3";
  return p.clientId ? (
    <Link href={`/clients/${p.clientId}?tab=projects`} className={cls}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export default async function WorkPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireOwner();
  const params = await searchParams;
  const rawView = first(params.view);
  const view: View = (VIEWS as readonly string[]).includes(rawView ?? "") ? (rawView as View) : "attention";
  const { today, tasks, requests, projects } = await getWorkOverview(actor);
  const now = new Date();

  const sortedTasks = [...tasks].sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      priorityRank(b.priority) - priorityRank(a.priority) ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
  );
  const newRequests = requests
    .filter((r) => r.status === "new")
    .sort((a, b) => priorityRank(b.priority ?? "normal") - priorityRank(a.priority ?? "normal") || b.createdAt.localeCompare(a.createdAt));
  const attentionTasks = sortedTasks.filter((t) => t.overdue || t.dueDate === today || isHigh(t.priority));
  const activeProjects = projects.filter((p) => p.launchedAt === null);
  const counts: Record<View, number> = {
    attention: newRequests.length + attentionTasks.length,
    requests: requests.length,
    projects: activeProjects.length,
    tasks: sortedTasks.length,
  };

  const requestId = first(params.request);
  const taskId = first(params.task);
  const openRequest = requestId ? requests.find((r) => r.id === requestId) : undefined;
  const openTask = taskId ? tasks.find((t) => t.id === taskId) : undefined;
  const closeHref = `/work?view=${view}`;

  return (
    <>
      <PageTitle title="Work" sub="Requests, projects and tasks" />
      <div className="flex flex-col gap-3">
        <nav aria-label="Work views" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          {VIEWS.map((v) => (
            <ChipLink key={v} href={`/work?view=${v}`} on={view === v} count={counts[v]}>{VIEW_LABEL[v]}</ChipLink>
          ))}
        </nav>

        {view === "projects" ? (
          activeProjects.length === 0 ? (
            <Group><EmptyNote>No open projects. Launched projects stay on each client’s Projects tab.</EmptyNote></Group>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
              {activeProjects.map((p) => <ProjectCard key={p.id} p={p} />)}
            </div>
          )
        ) : (
          <Group>
            {view === "attention" &&
              (counts.attention === 0 ? (
                <EmptyNote>Nothing here. Use Quick add to capture a request or task.</EmptyNote>
              ) : (
                <>
                  {newRequests.map((r) => requestRow(r, view, now))}
                  {attentionTasks.map((t) => taskRow(t, view))}
                </>
              ))}
            {view === "requests" &&
              (requests.length === 0 ? <EmptyNote>No open requests.</EmptyNote> : requests.map((r) => requestRow(r, view, now)))}
            {view === "tasks" &&
              (sortedTasks.length === 0 ? <EmptyNote>No open tasks. Use Quick add to create one.</EmptyNote> : sortedTasks.map((t) => taskRow(t, view)))}
          </Group>
        )}
      </div>

      {openRequest && (
        <Panel label="Request" closeHref={closeHref}>
          <div className="flex flex-col gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate font-mono text-[12px] text-dim">{openRequest.displayId}</span>
              {openRequest.priority && <Pill tone={PRIORITY_TONE[openRequest.priority] ?? "gray"}>{cap(openRequest.priority)}</Pill>}
            </div>
            <div className="text-[21px] font-semibold leading-tight tracking-[-.01em]">{openRequest.title}</div>
            <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-3">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[14px] text-dim">Status</span>
                <span className={`rounded-full px-[9px] py-1 text-[12px] font-semibold ${{ blue: "bg-blue-soft text-blue", amber: "bg-amber-soft text-amber", gray: "bg-chip text-dim", green: "bg-green-soft text-green", red: "bg-red-soft text-red" }[REQUEST_STATUS_TONE[openRequest.status] ?? "gray"]}`}>
                  {statusLabel(openRequest.status)}
                </span>
              </div>
              <div className="flex gap-1.5 text-[12px] leading-[1.45] text-dim">
                <Icon name="lock" size={15} />
                Changing a request's status is not available in this app yet.
              </div>
            </div>
          </div>
          <KvCard>
            <Kv label="Client" href={`/clients/${openRequest.clientId}?tab=requests`}>{openRequest.clientName ?? "Client"}</Kv>
            <Kv label="Came in by">{openRequest.source ? (SOURCE_LABELS[openRequest.source as (typeof REQUEST_SOURCES)[number]] ?? openRequest.source) : "Not recorded"}</Kv>
            <Kv label="Opened">{ageLabel(openRequest.createdAt, now)}</Kv>
            <Kv label="Website" mono>
              {openRequest.websiteUrl ? (safeUrl(openRequest.websiteUrl) ? <a href={safeUrl(openRequest.websiteUrl)!} target="_blank" rel="noopener noreferrer" className="text-blue">{openRequest.websiteUrl}</a> : openRequest.websiteUrl) : "Not specified"}
            </Kv>
          </KvCard>
          {openRequest.description && (
            <div>
              <PanelLabel>Description</PanelLabel>
              <TextCard>{openRequest.description}</TextCard>
            </div>
          )}
        </Panel>
      )}

      {openTask && (
        <Panel label="Task" closeHref={closeHref} footer={<CompleteTaskButton id={openTask.id} closeHref={closeHref} />}>
          <div className="text-[21px] font-semibold leading-tight tracking-[-.01em]">{openTask.title}</div>
          <KvCard>
            <Kv label="Client" href={openTask.clientId ? `/clients/${openTask.clientId}` : undefined}>{openTask.clientName ?? "Business to-do"}</Kv>
            <Kv label="Due">{openTask.dueDate ? `${dueLabel(openTask.dueDate)}${openTask.overdue ? " · overdue" : openTask.dueDate === today ? " · today" : ""}` : "No date"}</Kv>
            <Kv label="Priority">{cap(openTask.priority)}</Kv>
            <div className="flex items-center justify-between gap-3.5 border-b border-line py-1.5 text-[14px]">
              <span className="text-dim">Status</span>
              <TaskStatusSelect id={openTask.id} status={openTask.status} />
            </div>
            <Kv label="Updated">{ageLabel(openTask.updatedAt, now)}</Kv>
          </KvCard>
          {openTask.description && (
            <div>
              <PanelLabel>Description</PanelLabel>
              <TextCard>{openTask.description}</TextCard>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
