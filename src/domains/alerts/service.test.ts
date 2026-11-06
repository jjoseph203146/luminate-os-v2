import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-11-06T12:00:00Z");
const mocks = vi.hoisted(() => ({
  listRecentPayments: vi.fn(),
  listRecentNotices: vi.fn(),
  listClients: vi.fn(),
  listRequests: vi.fn(),
  listAlertState: vi.fn(),
  saveAlertState: vi.fn(),
  notifyOwner: vi.fn(),
}));

vi.mock("@/platform/db/server", () => ({ createAdminClient: () => ({}) }));
vi.mock("./repo", () => ({
  listRecentPayments: mocks.listRecentPayments,
  listRecentNotices: mocks.listRecentNotices,
  listClients: mocks.listClients,
  listRequests: mocks.listRequests,
  listAlertState: mocks.listAlertState,
  saveAlertState: mocks.saveAlertState,
}));
vi.mock("@/domains/notifications/service", () => ({ notifyOwner: mocks.notifyOwner }));

import { runActivityAlerts } from "./service";
import { PermissionError } from "@/platform/errors";

const system = { type: "system", name: "activity_alerts" } as const;
const paid = { id: "p1", clientId: "c1", amount: 49, status: "paid", createdAt: "2026-11-06T10:00:00Z", paidAt: "2026-11-06T10:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listRecentPayments.mockResolvedValue([paid]);
  mocks.listRecentNotices.mockResolvedValue([]);
  mocks.listClients.mockResolvedValue([{ id: "c1", name: "Acme Bakery", archived: false, onHold: false }]);
  mocks.listRequests.mockResolvedValue([]);
  mocks.listAlertState.mockResolvedValue([{ key: "activity:seeded", state: "yes" }]);
});

describe("runActivityAlerts", () => {
  it("sends the alert and remembers it when delivered", async () => {
    mocks.notifyOwner.mockResolvedValue({ sent: 1, failed: 0, removed: 0, skipped: null });
    const r = await runActivityAlerts(system, NOW);
    expect(r).toEqual({ payments: 1, notices: 0, planned: 1, sent: 1, held: 0 });
    expect(mocks.notifyOwner).toHaveBeenCalledWith(system, expect.objectContaining({ title: "Payment received: Acme Bakery" }));
    expect(mocks.saveAlertState).toHaveBeenCalledWith({}, "payment:p1", "paid", NOW);
  });
  it("does not remember the alert when delivery failed, so the next run retries", async () => {
    mocks.notifyOwner.mockResolvedValue({ sent: 0, failed: 1, removed: 0, skipped: null });
    const r = await runActivityAlerts(system, NOW);
    expect(r).toMatchObject({ sent: 0, held: 1 });
    expect(mocks.saveAlertState).not.toHaveBeenCalled();
  });
  it("stops at the first undeliverable alert so a dead channel is tried once per run, not once per alert", async () => {
    mocks.listRecentPayments.mockResolvedValue([paid, { ...paid, id: "p2", paidAt: "2026-11-06T11:00:00Z", createdAt: "2026-11-06T11:00:00Z" }]);
    mocks.notifyOwner.mockResolvedValue({ sent: 0, failed: 1, removed: 0, skipped: null });
    const r = await runActivityAlerts(system, NOW);
    expect(mocks.notifyOwner).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ planned: 2, sent: 0, held: 1 });
    expect(mocks.saveAlertState).not.toHaveBeenCalled();
  });
  it("reads the saved state only for the rows it is looking at", async () => {
    mocks.notifyOwner.mockResolvedValue({ sent: 1, failed: 0, removed: 0, skipped: null });
    mocks.listRecentNotices.mockResolvedValue([{ id: "n1", type: "new_request", clientId: "c1", requestId: "r1", read: false, createdAt: "2026-11-06T09:00:00Z" }]);
    await runActivityAlerts(system, NOW);
    expect(mocks.listAlertState).toHaveBeenCalledWith({}, ["payment:p1", "notif:n1"]);
  });
  it("remembers the alert without sending when no phone is registered, so old news is not replayed later", async () => {
    mocks.notifyOwner.mockResolvedValue({ sent: 0, failed: 0, removed: 0, skipped: "no_devices" });
    const r = await runActivityAlerts(system, NOW);
    expect(r).toMatchObject({ sent: 0, held: 0 });
    expect(mocks.saveAlertState).toHaveBeenCalledWith({}, "payment:p1", "paid", null);
  });
  it("on the very first run records what exists and sends nothing", async () => {
    mocks.listAlertState.mockResolvedValue([]);
    const r = await runActivityAlerts(system, NOW);
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
    expect(mocks.saveAlertState).toHaveBeenCalledWith({}, "activity:seeded", "yes", null);
    expect(mocks.saveAlertState).toHaveBeenCalledWith({}, "payment:p1", "paid", null);
  });
  it("only reads the last 14 days", async () => {
    mocks.notifyOwner.mockResolvedValue({ sent: 1, failed: 0, removed: 0, skipped: null });
    await runActivityAlerts(system, NOW);
    expect(mocks.listRecentPayments).toHaveBeenCalledWith({}, new Date("2026-10-23T12:00:00Z"));
  });
  it("is not allowed for actors without the permission", async () => {
    await expect(runActivityAlerts({ type: "client" } as never, NOW)).rejects.toBeInstanceOf(PermissionError);
  });
});
