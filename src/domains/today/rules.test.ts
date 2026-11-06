import { describe, expect, it } from "vitest";
import { buildAttention, buildRevenue, buildTodos, buildWaiting, type AttentionInput, type ClientRow, type TaskRow } from "./rules";

const now = new Date("2026-11-05T15:00:00Z");
const today = "2026-11-05";
const tz = "America/New_York";

const client = (over: Partial<ClientRow> = {}): ClientRow => ({
  id: "c1",
  business_name: "Acme",
  status: "active",
  subscription_price: 100,
  archived_at: null,
  monitoring_paused_at: null,
  ...over,
});
const task = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: "t1",
  client_id: null,
  title: "Do thing",
  status: "ready",
  priority: "normal",
  due_date: null,
  updated_at: "2026-11-04T00:00:00Z",
  ...over,
});
const empty: AttentionInput = { clients: [client()], monitors: [], requests: [], tasks: [], projects: [], payments: [] };

describe("buildAttention", () => {
  it("never calls a stale website healthy and flags it", () => {
    const out = buildAttention(
      { ...empty, monitors: [{ client_id: "c1", status: "up", url: "https://a.com", last_checked_at: "2026-10-30T00:00:00Z", http_status: 200, response_time_ms: 1, ssl_expires_at: null, domain_expires_at: null }] },
      today, now, tz,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("site_stale");
  });
  it("does not list a fresh healthy website", () => {
    const out = buildAttention(
      { ...empty, monitors: [{ client_id: "c1", status: "up", url: "https://a.com", last_checked_at: "2026-11-05T14:00:00Z", http_status: 200, response_time_ms: 1, ssl_expires_at: null, domain_expires_at: null }] },
      today, now, tz,
    );
    expect(out).toHaveLength(0);
  });
  it("puts down sites and failed payments first", () => {
    const out = buildAttention(
      {
        ...empty,
        requests: [{ id: "r1", client_id: "c1", display_id: "1", title: "Fix", status: "new", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" }],
        payments: [{ id: "p1", client_id: "c1", amount: 50, status: "failed", paid_at: null, created_at: "2026-11-03T00:00:00Z" }],
      },
      today, now, tz,
    );
    expect(out.map((i) => i.kind)).toEqual(["payment_failed", "request"]);
  });
  it("skips archived and paused clients' sites", () => {
    const mon = { client_id: "c1", status: "down", url: "https://a.com", last_checked_at: "2026-11-05T14:00:00Z", http_status: 500, response_time_ms: 1, ssl_expires_at: null, domain_expires_at: null };
    expect(buildAttention({ ...empty, clients: [client({ archived_at: "2026-01-01T00:00:00Z" })], monitors: [mon] }, today, now, tz)).toHaveLength(0);
    expect(buildAttention({ ...empty, clients: [client({ status: "paused" })], monitors: [mon] }, today, now, tz)).toHaveLength(0);
  });
  it("includes urgent and overdue client tasks, not business to-dos or normal tasks", () => {
    const out = buildAttention(
      { ...empty, tasks: [task({ id: "a", client_id: "c1", priority: "urgent" }), task({ id: "b", client_id: "c1", due_date: "2026-11-01" }), task({ id: "c", client_id: "c1" }), task({ id: "d", priority: "urgent" })] },
      today, now, tz,
    );
    expect(out.map((i) => i.key).sort()).toEqual(["task-a", "task-b"]);
  });
  it("leaves billing tasks to the Billing group (no second 'Task overdue' item)", () => {
    const items = buildAttention({ ...empty, tasks: [task({ client_id: "c1", priority: "urgent", source_reference: "billing:c1:2026-11-01:grace_review" })] }, today, now, tz);
    expect(items.filter((i) => i.kind === "task")).toEqual([]);
  });
  it("ignores failed payments older than 30 days", () => {
    const out = buildAttention({ ...empty, payments: [{ id: "p", client_id: "c1", amount: 1, status: "failed", paid_at: null, created_at: "2026-09-01T00:00:00Z" }] }, today, now, tz);
    expect(out).toHaveLength(0);
  });
});

describe("buildTodos", () => {
  it("lists only open tasks with no client, overdue and urgent first", () => {
    const out = buildTodos(
      [task({ id: "a", priority: "low" }), task({ id: "b", priority: "urgent" }), task({ id: "c", due_date: "2026-11-01" }), task({ id: "d", client_id: "c1" }), task({ id: "e", status: "completed" })],
      today,
    );
    expect(out.map((t) => t.id)).toEqual(["c", "b", "a"]);
  });
});

describe("buildRevenue", () => {
  it("sums paid this month in the business time zone and plan prices of active clients", () => {
    const r = buildRevenue(
      [client(), client({ id: "c2", status: "paused", subscription_price: 999 }), client({ id: "c3", status: "past_due", subscription_price: 50 })],
      [
        { id: "1", client_id: "c1", amount: 100, status: "paid", paid_at: "2026-11-02T12:00:00Z", created_at: "2026-11-02T12:00:00Z" },
        { id: "2", client_id: "c1", amount: 100, status: "paid", paid_at: "2026-10-31T12:00:00Z", created_at: "2026-10-31T12:00:00Z" },
        { id: "3", client_id: "c1", amount: 10, status: "paid", paid_at: "2026-11-01T02:00:00Z", created_at: "2026-11-01T02:00:00Z" },
        { id: "4", client_id: "c1", amount: 5, status: "failed", paid_at: null, created_at: "2026-11-02T00:00:00Z" },
        { id: "5", client_id: "c1", amount: 5, status: "pending", paid_at: null, created_at: "2026-11-02T00:00:00Z" },
      ],
      today, tz,
    );
    // "3" was paid at 22:00 local on Oct 31, so it is not November.
    expect(r.paidThisMonth).toBe(100);
    expect(r.paidThisMonthCount).toBe(1);
    expect(r.planTotal).toBe(150);
    expect(r.failedLast30Days).toBe(1);
    expect(r.pendingCount).toBe(1);
    expect(r.latestPaidAt).toBe("2026-11-02T12:00:00Z");
  });
});

describe("buildWaiting", () => {
  it("lists requests waiting on the client and tasks marked Waiting, oldest first", () => {
    const out = buildWaiting({
      ...empty,
      requests: [
        { id: "r1", client_id: "c1", display_id: "LUM-1", title: "Send logo", status: "waiting_on_client", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-20T00:00:00Z" },
        { id: "r2", client_id: "c1", display_id: "LUM-2", title: "Other", status: "new", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" },
      ],
      tasks: [task({ id: "t9", status: "waiting", client_id: "c1", updated_at: "2026-10-10T00:00:00Z" }), task({ id: "t8", status: "ready" })],
    });
    expect(out.map((i) => i.key)).toEqual(["wtask-t9", "wreq-r1"]);
    expect(out[1]?.clientName).toBe("Acme");
  });
});
