// Pure rules for the Today screen. No database, easy to test.
import { addCalendarDays, toLocalDate } from "@/platform/calendar/business-days";
import { summarizeMonitor, type MonitorRow } from "@/domains/clients/rules";
import type { AttentionItem, BusinessTodo, RevenueSummary, WaitingItem } from "./types";

export const ATTENTION_LIMIT = 25;

export interface ClientRow {
  id: string;
  business_name: string;
  status: string;
  subscription_price: number;
  archived_at: string | null;
  monitoring_paused_at: string | null;
}
export interface MonitorInput extends NonNullable<MonitorRow> {
  client_id: string;
}
export interface RequestRow {
  id: string;
  client_id: string;
  display_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}
export interface TaskRow {
  id: string;
  client_id: string | null;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  updated_at: string;
}
export interface ProjectRow {
  id: string;
  client_id: string | null;
  name: string | null;
  blocker_note: string | null;
  updated_at: string;
}
export interface PaymentRow {
  id: string;
  client_id: string | null;
  amount: number;
  status: string;
  paid_at: string | null;
  created_at: string;
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function daysBetween(fromIso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / 86_400_000));
}

export interface AttentionInput {
  clients: ClientRow[];
  monitors: MonitorInput[];
  requests: RequestRow[];
  tasks: TaskRow[];
  projects: ProjectRow[];
  payments: PaymentRow[];
}

export function buildAttention(input: AttentionInput, today: string, now: Date, timeZone: string): AttentionItem[] {
  const names = new Map(input.clients.map((c) => [c.id, c.business_name]));
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const items: AttentionItem[] = [];
  const thirtyDaysAgo = addCalendarDays(today, -30);

  for (const p of input.payments) {
    if (p.status !== "failed" || !p.client_id) continue;
    if (toLocalDate(new Date(p.created_at), timeZone) < thirtyDaysAgo) continue;
    items.push({
      key: `pay-${p.id}`,
      kind: "payment_failed",
      severity: 1,
      title: "Payment failed",
      detail: `$${p.amount.toFixed(2)} did not go through`,
      clientName: nameOf(p.client_id),
      href: `/clients/${p.client_id}?tab=billing`,
      asOf: p.created_at,
    });
  }

  for (const c of input.clients) {
    if (c.archived_at) continue;
    if (c.status === "past_due") {
      items.push({
        key: `due-${c.id}`,
        kind: "past_due",
        severity: 1,
        title: "Client is past due",
        detail: "Subscription is marked past due",
        clientName: c.business_name,
        href: `/clients/${c.id}?tab=billing`,
        asOf: null,
      });
    }
  }

  const clientsById = new Map(input.clients.map((c) => [c.id, c]));
  for (const m of input.monitors) {
    const c = clientsById.get(m.client_id);
    if (!c || c.archived_at || c.status === "paused") continue;
    const summary = summarizeMonitor(m, c.monitoring_paused_at !== null, now);
    const base = { clientName: c.business_name, href: `/clients/${c.id}?tab=websites`, asOf: m.last_checked_at };
    if (summary.state === "down") items.push({ ...base, key: `mon-${c.id}`, kind: "site_down", severity: 1, title: "Website is down", detail: m.url });
    else if (summary.state === "slow") items.push({ ...base, key: `mon-${c.id}`, kind: "site_slow", severity: 3, title: "Website is slow", detail: m.url });
    else if (summary.state === "stale") items.push({ ...base, key: `mon-${c.id}`, kind: "site_stale", severity: 3, title: "Website check is out of date", detail: `${m.url} cannot be called healthy` });
  }

  for (const r of input.requests) {
    if (r.status === "completed") continue;
    const age = daysBetween(r.created_at, now);
    const base = { key: `req-${r.id}`, kind: "request" as const, clientName: nameOf(r.client_id), href: `/work?view=requests&request=${r.id}`, asOf: r.created_at };
    if (r.status === "new") items.push({ ...base, severity: 2, title: `New request #${r.display_id}`, detail: r.title });
    else if (r.status === "waiting_on_client" && age >= 5) items.push({ ...base, severity: 3, title: `Waiting on client ${age} days`, detail: `#${r.display_id} ${r.title}` });
    else if ((r.status === "in_review" || r.status === "in_progress") && age >= 7) items.push({ ...base, severity: 3, title: `Open ${age} days`, detail: `#${r.display_id} ${r.title}` });
  }

  for (const t of input.tasks) {
    if (t.status === "completed" || !t.client_id) continue;
    const overdue = t.due_date !== null && t.due_date < today;
    const dueToday = t.due_date === today;
    let severity: 1 | 2 | 3 | 4 | null = null;
    if (t.priority === "urgent") severity = 1;
    else if (t.priority === "high" || overdue || dueToday) severity = 2;
    if (!severity) continue;
    items.push({
      key: `task-${t.id}`,
      kind: "task",
      severity,
      title: overdue ? "Task overdue" : dueToday ? "Task due today" : `${t.priority === "urgent" ? "Urgent" : "High priority"} task`,
      detail: t.title,
      clientName: nameOf(t.client_id),
      href: `/work?view=tasks&task=${t.id}`,
      asOf: t.updated_at,
    });
  }

  for (const p of input.projects) {
    if (!p.blocker_note?.trim() || !p.client_id) continue;
    items.push({
      key: `blk-${p.id}`,
      kind: "blocker",
      severity: 2,
      title: "Project blocked",
      detail: p.blocker_note.trim().slice(0, 140),
      clientName: nameOf(p.client_id),
      href: `/clients/${p.client_id}?tab=projects`,
      asOf: p.updated_at,
    });
  }

  return items.sort((a, b) => a.severity - b.severity || (a.asOf ?? "").localeCompare(b.asOf ?? "") || a.key.localeCompare(b.key));
}

/** Things blocked on someone else: requests waiting on the client and tasks marked Waiting. */
export function buildWaiting(input: AttentionInput): WaitingItem[] {
  const names = new Map(input.clients.map((c) => [c.id, c.business_name]));
  const items: WaitingItem[] = [];
  for (const r of input.requests) {
    if (r.status !== "waiting_on_client") continue;
    items.push({
      key: `wreq-${r.id}`,
      kind: "request",
      title: r.title,
      code: r.display_id,
      clientName: names.get(r.client_id) ?? null,
      href: `/work?view=requests&request=${r.id}`,
      since: r.updated_at,
    });
  }
  for (const t of input.tasks) {
    if (t.status !== "waiting") continue;
    items.push({
      key: `wtask-${t.id}`,
      kind: "task",
      title: t.title,
      code: null,
      clientName: t.client_id ? (names.get(t.client_id) ?? null) : null,
      href: `/work?view=tasks&task=${t.id}`,
      since: t.updated_at,
    });
  }
  return items.sort((a, b) => a.since.localeCompare(b.since) || a.key.localeCompare(b.key));
}

/** Business to-dos are open tasks that belong to no client. */
export function buildTodos(tasks: TaskRow[], today: string): BusinessTodo[] {
  return tasks
    .filter((t) => t.status !== "completed" && !t.client_id)
    .map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      dueDate: t.due_date,
      overdue: t.due_date !== null && t.due_date < today,
    }))
    .sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
    );
}

export function buildRevenue(clients: ClientRow[], payments: PaymentRow[], today: string, timeZone: string): RevenueSummary {
  const month = today.slice(0, 7);
  const thirtyDaysAgo = addCalendarDays(today, -30);
  let paidThisMonth = 0;
  let paidThisMonthCount = 0;
  let latestPaidAt: string | null = null;
  let failed = 0;
  let pending = 0;
  for (const p of payments) {
    if (p.status === "paid" && p.paid_at) {
      if (!latestPaidAt || p.paid_at > latestPaidAt) latestPaidAt = p.paid_at;
      if (toLocalDate(new Date(p.paid_at), timeZone).startsWith(month)) {
        paidThisMonth += p.amount;
        paidThisMonthCount += 1;
      }
    } else if (p.status === "failed" && toLocalDate(new Date(p.created_at), timeZone) >= thirtyDaysAgo) failed += 1;
    else if (p.status === "pending") pending += 1;
  }
  const planTotal = clients
    .filter((c) => !c.archived_at && (c.status === "active" || c.status === "past_due"))
    .reduce((sum, c) => sum + c.subscription_price, 0);
  return {
    planTotal: Math.round(planTotal * 100) / 100,
    paidThisMonth: Math.round(paidThisMonth * 100) / 100,
    paidThisMonthCount,
    latestPaidAt,
    failedLast30Days: failed,
    pendingCount: pending,
  };
}
