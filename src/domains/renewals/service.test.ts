import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewAction, NewCycle } from "./rules";
import type { Action, Agreement, VerifiedPayment } from "./types";
import type { ClientBasics, CycleRecord } from "./repo";

// An in-memory stand-in for the database, with the same unique keys and conditional updates as migration 0009.
const store = vi.hoisted(() => ({
  clients: [] as ClientBasics[],
  agreements: [] as Agreement[],
  cycles: [] as CycleRecord[],
  actions: [] as (Omit<Action, "workItemCompleted"> & { outcome: string | null; completedBy: string | null })[],
  workItems: [] as { id: string; key: string; status: string; title: string; priority: string; dueDate: string }[],
  payments: [] as VerifiedPayment[],
  job: { exists: true, enabled: true, lastSuccessAt: null as string | null, lastRunFailed: false },
  failNextActionInsert: false,
  seq: 0,
}));
const mocks = vi.hoisted(() => ({ writeAudit: vi.fn() }));

vi.mock("@/platform/audit/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/platform/db/server", () => ({ readDb: vi.fn(async () => ({})) }));
vi.mock("./repo", () => {
  class RepoError extends Error {}
  // UUID-shaped, like the real ids (the owner forms check them).
  const id = () => `00000000-0000-4000-8000-${String(++store.seq).padStart(12, "0")}`;
  const withWork = (a: (typeof store.actions)[number]): Action => ({ ...a, workItemCompleted: store.workItems.some((w) => w.id === a.workItemId && w.status === "completed") });
  return {
    RepoError,
    getClient: async (_db: unknown, cid: string) => store.clients.find((c) => c.id === cid) ?? null,
    listClients: async (_db: unknown, ids?: string[]) => (ids ? store.clients.filter((c) => ids.includes(c.id)) : store.clients),
    listAgreements: async () => store.agreements.map((a) => ({ ...a })),
    getOpenAgreement: async (_db: unknown, cid: string) => store.agreements.find((a) => a.clientId === cid && a.status !== "cancelled") ?? null,
    listCyclesForPlanning: async (_db: unknown, since: string) => store.cycles.filter((c) => c.status === "open" || c.dueOn >= since).map((c) => ({ ...c })),
    listCyclesForClient: async (_db: unknown, cid: string) => store.cycles.filter((c) => c.clientId === cid),
    getCycle: async (_db: unknown, cyId: string) => store.cycles.find((c) => c.id === cyId) ?? null,
    listCyclesByIds: async (_db: unknown, ids: string[]) => store.cycles.filter((c) => ids.includes(c.id)),
    listActionsForCycles: async (_db: unknown, ids: string[]) => store.actions.filter((a) => ids.includes(a.cycleId)).map(withWork),
    listOpenActions: async (_db: unknown, until: string, cid?: string) => store.actions.filter((a) => a.status === "open" && a.dueOn <= until && (!cid || a.clientId === cid)).map(withWork),
    getAction: async (_db: unknown, aid: string) => {
      const a = store.actions.find((x) => x.id === aid);
      return a ? withWork(a) : null;
    },
    listVerifiedPayments: async (_db: unknown, ids: string[], since: string) => store.payments.filter((p) => ids.includes(p.clientId) && p.paidAt >= since),
    jobState: async () => store.job,
    insertAgreement: async (_db: unknown, a: Omit<Agreement, "id"> & { updatedBy?: string | null }) => {
      if (store.agreements.some((x) => x.clientId === a.clientId && x.status !== "cancelled")) return "conflict";
      const { updatedBy: _by, ...rest } = a;
      void _by;
      const ag: Agreement = { ...rest, id: id() };
      store.agreements.push(ag);
      return ag.id;
    },
    updateAgreement: async (_db: unknown, aid: string, patch: Record<string, unknown>, onlyIf?: string) => {
      const a = store.agreements.find((x) => x.id === aid && (!onlyIf || x.status === onlyIf));
      if (!a) return 0;
      const map: Record<string, keyof Agreement> = { plan_name: "planName", monthly_price_cents: "monthlyPriceCents", anniversary_day: "anniversaryDay", starts_on: "startsOn", invoice_sender: "invoiceSender", payment_link_url: "paymentLinkUrl", tasks_from: "tasksFrom", status: "status", source: "source", stripe_subscription_id: "stripeSubscriptionId" };
      for (const [k, v] of Object.entries(patch)) if (map[k]) (a as unknown as Record<string, unknown>)[map[k]] = v;
      return 1;
    },
    insertCycle: async (_db: unknown, c: NewCycle) => {
      if (store.cycles.some((x) => x.clientId === c.clientId && x.dueOn === c.dueOn)) return "conflict";
      const cy: CycleRecord = { ...c, id: id(), status: "open", paidAt: null, paymentRef: null, invoiceSentAt: null, reminderSentAt: null, invoiceUrl: null, manualAmountCents: null, manualMethod: null, manualNote: null };
      store.cycles.push(cy);
      return cy.id;
    },
    updateCycle: async (_db: unknown, cid: string, patch: Record<string, unknown>, onlyIf?: string) => {
      const c = store.cycles.find((x) => x.id === cid && (!onlyIf || x.status === onlyIf));
      if (!c) return 0;
      if (patch.status) c.status = patch.status as CycleRecord["status"];
      if ("paid_at" in patch) c.paidAt = patch.paid_at as string;
      if ("payment_ref" in patch) c.paymentRef = patch.payment_ref as string;
      if ("manual_amount_cents" in patch) c.manualAmountCents = patch.manual_amount_cents as number;
      return 1;
    },
    stampCycleOnce: async (_db: unknown, cid: string, column: "invoice_sent_at" | "reminder_sent_at", patch: Record<string, unknown>) => {
      const c = store.cycles.find((x) => x.id === cid);
      const field = column === "invoice_sent_at" ? "invoiceSentAt" : "reminderSentAt";
      if (!c || c[field]) return 0;
      c[field] = patch[column] as string;
      if (patch.invoice_url) c.invoiceUrl = patch.invoice_url as string;
      return 1;
    },
    insertAction: async (_db: unknown, a: NewAction) => {
      if (store.failNextActionInsert) {
        store.failNextActionInsert = false;
        throw new RepoError("create a billing task");
      }
      if (store.actions.some((x) => x.actionKey === a.actionKey)) return "conflict";
      const row = { ...a, id: id(), status: "open" as const, workItemId: null, outcome: null, completedBy: null };
      store.actions.push(row);
      return row.id;
    },
    closeAction: async (_db: unknown, aid: string, status: Action["status"], outcome: string, by: string) => {
      const a = store.actions.find((x) => x.id === aid && x.status === "open");
      if (!a) return 0;
      Object.assign(a, { status, outcome, completedBy: by });
      return 1;
    },
    linkWorkItem: async (_db: unknown, aid: string, wid: string) => {
      const a = store.actions.find((x) => x.id === aid && x.workItemId === null);
      if (a) a.workItemId = wid;
    },
    findWorkItemByKey: async (_db: unknown, key: string) => store.workItems.find((w) => w.key === key) ?? null,
    insertWorkItem: async (_db: unknown, w: { key: string; title: string; priority: string; dueDate: string }) => {
      if (store.workItems.some((x) => x.key === w.key)) return "conflict";
      const row = { id: id(), key: w.key, status: "ready", title: w.title, priority: w.priority, dueDate: w.dueDate };
      store.workItems.push(row);
      return row.id;
    },
    completeWorkItem: async (_db: unknown, wid: string) => {
      const w = store.workItems.find((x) => x.id === wid);
      if (w) w.status = "completed";
    },
  };
});

import { changeAgreementStatus, followStripe, getBillingToday, markInvoiceSent, markReminderSent, markReviewed, recordManualPayment, runBillingTasks, saveAgreement } from "./service";
import { PermissionError, RuleError } from "@/platform/errors";

const system = { type: "system", name: "billing_tasks" } as const;
const owner = { type: "owner", userId: "11111111-1111-4111-8111-111111111111", email: null, ip: null } as const;
const CLIENT = "22222222-2222-4222-8222-222222222222";
/** Noon in New York on a date. */
const at = (date: string) => new Date(`${date}T17:00:00Z`);
const run = (date: string) => runBillingTasks(system, at(date), { stripe: null });
const open = () => store.actions.filter((a) => a.status === "open").map((a) => a.milestone);
const tasksOf = () => store.workItems.map((w) => `${w.status}:${w.key.split(":").slice(2).join(":")}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.writeAudit.mockResolvedValue(undefined);
  Object.assign(store, { clients: [], agreements: [], cycles: [], actions: [], workItems: [], payments: [], failNextActionInsert: false, seq: 0 });
  store.job = { exists: true, enabled: true, lastSuccessAt: null, lastRunFailed: false };
  store.clients.push({ id: CLIENT, name: "Oak & Ember Coffee", status: "active", archived: false, subscriptionPrice: 35, planName: "Essential", billingAnchorDate: "2026-11-12", clientSince: "2026-01-12", stripeCustomerId: "cus_1" });
  store.agreements.push({ id: "ag-1", clientId: CLIENT, planName: "Essential", monthlyPriceCents: 3500, anniversaryDay: 12, startsOn: "2026-01-12", status: "active", invoiceSender: "luminate", paymentLinkUrl: null, tasksFrom: "2026-11-01", source: "manual", stripeSubscriptionId: null });
});

describe("the billing job", () => {
  it("is for the scheduler only", async () => {
    await expect(runBillingTasks({ type: "ai", name: "mcp" }, at("2026-11-07"))).rejects.toBeInstanceOf(PermissionError);
    await expect(runBillingTasks({ type: "integration", name: "stripe" }, at("2026-11-07"))).rejects.toBeInstanceOf(PermissionError);
  });
  it("walks the SOP schedule day by day for an unpaid renewal, one task per milestone", async () => {
    await run("2026-11-06");
    expect(store.cycles).toHaveLength(0);
    await run("2026-11-07");
    expect(tasksOf()).toEqual(["ready:2026-11-12:send_invoice"]);
    await run("2026-11-12");
    await run("2026-11-15");
    await run("2026-11-19");
    expect(tasksOf()).toEqual(["ready:2026-11-12:send_invoice", "ready:2026-11-12:verify_payment", "ready:2026-11-12:friendly_reminder", "ready:2026-11-12:grace_review"]);
    expect(store.workItems.map((w) => w.priority)).toEqual(["normal", "high", "high", "urgent"]);
    expect(store.workItems[0]!.title).toBe("Send renewal invoice/payment link ($35.00, renews Nov 12)");
  });
  it("is idempotent: repeated runs and retries create nothing twice", async () => {
    await run("2026-11-19");
    const before = { cycles: store.cycles.length, actions: store.actions.length, work: store.workItems.length };
    const again = await run("2026-11-19");
    await run("2026-11-19");
    expect({ cycles: store.cycles.length, actions: store.actions.length, work: store.workItems.length }).toEqual(before);
    expect(again).toMatchObject({ cyclesCreated: 0, tasksCreated: 0 });
  });
  it("after missed runs catches up all due milestones, and keeps overdue ones open", async () => {
    await run("2026-11-16");
    expect(open()).toEqual(["send_invoice", "verify_payment", "friendly_reminder"]);
    await run("2026-11-25");
    expect(open()).toEqual(["send_invoice", "verify_payment", "friendly_reminder", "grace_review"]);
  });
  it("a failed step fails the run visibly, and the retry repairs it", async () => {
    store.failNextActionInsert = true;
    await expect(run("2026-11-07")).rejects.toThrow(/1 step\(s\) failed/);
    expect(store.actions).toHaveLength(0);
    await run("2026-11-07");
    expect(tasksOf()).toEqual(["ready:2026-11-12:send_invoice"]);
  });
  it("a verified payment settles the renewal and closes the reminders that no longer apply", async () => {
    await run("2026-11-13");
    store.payments.push({ id: "rev-1", clientId: CLIENT, amountCents: 3500, paidAt: "2026-11-13T15:00:00Z", eventType: "subscription" });
    const s = await run("2026-11-13");
    expect(s.paid).toBe(1);
    expect(store.cycles[0]).toMatchObject({ status: "paid", paymentRef: "rev-1" });
    expect(open()).toEqual([]);
    expect(store.actions.map((a) => a.outcome)).toEqual(["payment_confirmed", "payment_confirmed"]);
    expect(store.workItems.every((w) => w.status === "completed")).toBe(true);
    await run("2026-11-20");
    expect(store.actions).toHaveLength(2);
  });
  it("a task ticked off on the Work page is recorded as done", async () => {
    await run("2026-11-07");
    store.workItems[0]!.status = "completed";
    await run("2026-11-08");
    expect(store.actions[0]).toMatchObject({ status: "done", outcome: "completed_in_work" });
  });
  it("keeps historical amounts when the price changes", async () => {
    await run("2026-11-07");
    store.agreements[0]!.monthlyPriceCents = 4900;
    await run("2026-12-07");
    expect(store.cycles.map((c) => c.amountCents)).toEqual([3500, 4900]);
  });
  it("cancelled plan: cancels the future renewal and its tasks", async () => {
    await run("2026-11-07");
    store.agreements[0]!.status = "cancelled";
    await run("2026-11-08");
    expect(store.cycles[0]!.status).toBe("cancelled");
    expect(store.actions[0]).toMatchObject({ status: "cancelled", outcome: "plan_cancelled" });
    expect(store.workItems[0]!.status).toBe("completed");
  });
});

describe("owner actions", () => {
  beforeEach(async () => {
    await run("2026-11-16");
  });
  const cycleId = () => store.cycles[0]!.id;

  it("are for the owner only", async () => {
    await expect(markInvoiceSent({ type: "ai", name: "mcp" } as never, { cycleId: cycleId() })).rejects.toBeInstanceOf(PermissionError);
    await expect(getBillingToday({ type: "ai", name: "mcp" })).rejects.toBeInstanceOf(PermissionError);
  });
  it("Mark sent: recorded once, closes the send task, and is not payment", async () => {
    const r = await markInvoiceSent(owner, { cycleId: cycleId(), invoiceUrl: "https://invoice.stripe.com/i/abc" }, at("2026-11-16"));
    expect(r.message).toMatch(/stays unpaid/);
    expect(store.cycles[0]).toMatchObject({ status: "open", invoiceUrl: "https://invoice.stripe.com/i/abc" });
    expect(store.actions.find((a) => a.milestone === "send_invoice")).toMatchObject({ status: "done", outcome: "sent" });
    await expect(markInvoiceSent(owner, { cycleId: cycleId() }, at("2026-11-16"))).rejects.toThrow(/Already marked sent on Nov 16/);
    expect(mocks.writeAudit).toHaveBeenCalledWith(owner, expect.objectContaining({ action: "billing.invoice_marked_sent" }));
  });
  it("Mark sent is refused when Stripe sends the invoice (one sender only)", async () => {
    store.cycles[0]!.invoiceSender = "stripe_invoice";
    await expect(markInvoiceSent(owner, { cycleId: cycleId() })).rejects.toBeInstanceOf(RuleError);
  });
  it("Mark reminder sent: once, closes the +3 task", async () => {
    await markReminderSent(owner, { cycleId: cycleId() }, at("2026-11-16"));
    expect(store.actions.find((a) => a.milestone === "friendly_reminder")).toMatchObject({ status: "done", outcome: "reminder_sent" });
    await expect(markReminderSent(owner, { cycleId: cycleId() })).rejects.toThrow(/already marked sent/);
  });
  it("Mark done on the Day 0 check leaves the renewal unpaid, so the +7 review still comes", async () => {
    const verify = store.actions.find((a) => a.milestone === "verify_payment")!;
    await markReviewed(owner, { actionId: verify.id }, at("2026-11-16"));
    expect(store.cycles[0]!.status).toBe("open");
    await run("2026-11-19");
    expect(open()).toContain("grace_review");
  });
  it("a manual payment settles the renewal, closes its tasks, and is audited", async () => {
    const r = await recordManualPayment(owner, { cycleId: cycleId(), amount: "35.00", paidOn: "2026-11-15", method: "check", note: "Cheque 1042", confirm: "yes" }, at("2026-11-16"));
    expect(r.message).toBe("Payment recorded.");
    expect(store.cycles[0]).toMatchObject({ status: "paid_manual", manualAmountCents: 3500 });
    expect(open()).toEqual([]);
    expect(mocks.writeAudit).toHaveBeenCalledWith(owner, expect.objectContaining({ action: "billing.payment_recorded", after: expect.objectContaining({ hasNote: true }) }));
    expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain("Cheque 1042");
    await expect(recordManualPayment(owner, { cycleId: cycleId(), amount: "35", paidOn: "2026-11-15", method: "check", confirm: "yes" }, at("2026-11-16"))).rejects.toThrow(/already paid/);
  });
  it("refuses a future payment date and an unticked confirmation", async () => {
    await expect(recordManualPayment(owner, { cycleId: cycleId(), amount: "35", paidOn: "2026-11-30", method: "cash", confirm: "yes" }, at("2026-11-16"))).rejects.toThrow(/future/);
    await expect(recordManualPayment(owner, { cycleId: cycleId(), amount: "35", paidOn: "2026-11-15", method: "cash" }, at("2026-11-16"))).rejects.toThrow();
  });
  it("pausing cancels open tasks at once; resuming restarts from today", async () => {
    await changeAgreementStatus(owner, { clientId: CLIENT, change: "pause" }, at("2026-11-16"));
    expect(open()).toEqual([]);
    expect(store.actions.every((a) => a.outcome === "plan_paused")).toBe(true);
    await run("2026-12-08");
    expect(store.cycles).toHaveLength(1);
    await changeAgreementStatus(owner, { clientId: CLIENT, change: "resume" }, at("2026-12-20"));
    expect(store.agreements[0]!.tasksFrom).toBe("2026-12-20");
    await run("2027-01-07");
    expect(store.cycles.map((c) => c.dueOn)).toEqual(["2026-11-12", "2027-01-12"]);
  });
  it("cancelling needs a tick", async () => {
    await expect(changeAgreementStatus(owner, { clientId: CLIENT, change: "cancel" })).rejects.toThrow(/Tick the box/);
  });
  it("Today lists open billing tasks with client, amount, due date, action and priority", async () => {
    const t = await getBillingToday(owner, at("2026-11-16"));
    expect(t.available).toBe(true);
    expect(t.tasks.map((x) => [x.title, x.clientName, x.amountCents, x.dueOn, x.priority, x.overdue])).toEqual([
      ["Verify renewal payment", "Oak & Ember Coffee", 3500, "2026-11-12", "high", true],
      ["Send friendly payment reminder", "Oak & Ember Coffee", 3500, "2026-11-15", "high", true],
      ["Send renewal invoice/payment link", "Oak & Ember Coffee", 3500, "2026-11-07", "normal", true],
    ]);
    expect(t.tasks[0]!.invoiceHref).toBe("https://dashboard.stripe.com/customers/cus_1");
  });
});

describe("schedules follow Stripe", () => {
  const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  const sub = {
    id: "sub_1",
    customerId: "cus_1",
    customerName: null,
    status: "active",
    collectionMethod: "charge_automatically",
    periodCents: 4900,
    monthlyCents: 4900,
    nextBillingAt: sec("2026-11-20T18:00:00Z"),
    cancelAtPeriodEnd: false,
    paused: false,
    pauseResumesAt: null,
    currentPeriodPaid: true,
    billingCycleAnchor: sec("2026-02-20T18:00:00Z"),
    startDate: sec("2026-02-20T18:00:00Z"),
  };
  const stripe = (subs: unknown[]) => ({ listSubscriptions: vi.fn(async () => subs), listOpenInvoices: vi.fn(async () => []) });

  beforeEach(() => {
    store.agreements = [];
  });

  it("creates the schedule from the subscription (no setup) and makes the tasks on Stripe's renewal date", async () => {
    const s = await runBillingTasks(system, at("2026-11-20"), { stripe: stripe([sub]) as never });
    expect(s.schedulesCreated).toBe(1);
    expect(store.agreements[0]).toMatchObject({ source: "stripe", stripeSubscriptionId: "sub_1", anniversaryDay: 20, monthlyPriceCents: 4900, invoiceSender: "stripe_autopay", planName: "Essential", tasksFrom: "2026-11-20" });
    // Autopay: Stripe charges, so no "send invoice" task; Day 0 checks the payment.
    expect(tasksOf()).toEqual(["ready:2026-11-20:verify_payment"]);
  });
  it("updates and then cancels with the subscription, closing the tasks", async () => {
    await runBillingTasks(system, at("2026-11-20"), { stripe: stripe([sub]) as never });
    await runBillingTasks(system, at("2026-11-21"), { stripe: stripe([{ ...sub, monthlyCents: 9900 }]) as never });
    expect(store.agreements[0]!.monthlyPriceCents).toBe(9900);
    await runBillingTasks(system, at("2026-11-22"), { stripe: stripe([{ ...sub, status: "canceled" }]) as never });
    expect(store.agreements[0]!.status).toBe("cancelled");
    expect(open()).toEqual([]);
  });
  it("a Stripe outage fails the run visibly, but existing schedules still get their tasks", async () => {
    await runBillingTasks(system, at("2026-11-20"), { stripe: stripe([sub]) as never });
    const down = { listSubscriptions: vi.fn(async () => Promise.reject(new Error("Stripe down"))), listOpenInvoices: vi.fn() };
    await expect(runBillingTasks(system, at("2026-11-23"), { stripe: down as never })).rejects.toThrow(/read Stripe subscriptions/);
    expect(open()).toContain("friendly_reminder");
  });
  it("the owner can take a schedule over by hand, and Stripe then leaves it alone; pausing needs that", async () => {
    await runBillingTasks(system, at("2026-11-20"), { stripe: stripe([sub]) as never });
    await expect(changeAgreementStatus(owner, { clientId: CLIENT, change: "pause" })).rejects.toThrow(/Pause or cancel the subscription in Stripe/);
    await saveAgreement(owner, { clientId: CLIENT, monthlyPrice: "35", anniversaryDay: "20", startsOn: "2026-02-20", invoiceSender: "luminate" });
    expect(store.agreements[0]).toMatchObject({ source: "manual", monthlyPriceCents: 3500 });
    await runBillingTasks(system, at("2026-11-21"), { stripe: stripe([]) as never });
    expect(store.agreements[0]).toMatchObject({ source: "manual", status: "active" });
    await followStripe(owner, { clientId: CLIENT });
    expect(store.agreements[0]!.source).toBe("stripe");
  });
});

describe("billing schedules", () => {
  it("lists paying clients without a schedule on Today", async () => {
    store.clients.push({ id: "33333333-3333-4333-8333-333333333333", name: "Willow & Thread", status: "active", archived: false, subscriptionPrice: 49, planName: null, billingAnchorDate: null, clientSince: null, stripeCustomerId: null });
    expect((await getBillingToday(owner, at("2026-11-16"))).missingSchedules).toEqual([{ clientId: "33333333-3333-4333-8333-333333333333", clientName: "Willow & Thread" }]);
  });
  it("edits apply from now on and are audited with before and after", async () => {
    const r = await saveAgreement(owner, { clientId: CLIENT, planName: "Professional", monthlyPrice: "49", anniversaryDay: "31", startsOn: "2026-01-12", invoiceSender: "stripe_autopay", paymentLinkUrl: "" });
    expect(r.message).toMatch(/keep their amount/);
    expect(store.agreements[0]).toMatchObject({ monthlyPriceCents: 4900, anniversaryDay: 31, invoiceSender: "stripe_autopay" });
    expect(mocks.writeAudit).toHaveBeenCalledWith(owner, expect.objectContaining({ action: "billing_schedule.updated", before: expect.objectContaining({ monthlyPriceCents: 3500 }) }));
  });
  it("validates the schedule", async () => {
    await expect(saveAgreement(owner, { clientId: CLIENT, monthlyPrice: "0", anniversaryDay: "12", startsOn: "2026-01-12", invoiceSender: "luminate" })).rejects.toThrow();
    await expect(saveAgreement(owner, { clientId: CLIENT, monthlyPrice: "35", anniversaryDay: "32", startsOn: "2026-01-12", invoiceSender: "luminate" })).rejects.toThrow();
    await expect(saveAgreement(owner, { clientId: CLIENT, monthlyPrice: "35", anniversaryDay: "12", startsOn: "2026-01-12", invoiceSender: "luminate", paymentLinkUrl: "http://pay.example" })).rejects.toThrow();
  });
});
