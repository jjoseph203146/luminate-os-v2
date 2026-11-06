import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-11-05T12:00:00Z");
const mocks = vi.hoisted(() => ({
  listSites: vi.fn(),
  listAlertState: vi.fn(),
  saveAlertState: vi.fn(),
  notifyOwner: vi.fn(),
}));

vi.mock("@/platform/db/server", () => ({ createAdminClient: () => ({}), createUserClient: async () => ({}) }));
vi.mock("./repo", () => ({ listSites: mocks.listSites, listAlertState: mocks.listAlertState, saveAlertState: mocks.saveAlertState, listOpenIssues: vi.fn() }));
vi.mock("@/domains/notifications/service", () => ({ notifyOwner: mocks.notifyOwner }));
vi.mock("@/domains/admin/service", () => ({ getCalendar: vi.fn() }));

import { runMonitorAlerts } from "./service";

const downSite = {
  id: "s1", clientId: "c1", clientName: "Acme", url: "https://acme.com", status: "down" as const, responseTimeMs: null, httpStatus: 503,
  securityScore: null, brokenLinks: null, sslExpiresAt: null, domainExpiresAt: null, lastCheckedAt: new Date(NOW.getTime() - 60_000).toISOString(), lastError: null, alertsMuted: false,
};
const system = { type: "system", name: "monitor_alerts" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listSites.mockResolvedValue([downSite]);
  mocks.listAlertState.mockResolvedValue([{ key: "site:s1:status", state: "up" }]);
});

describe("runMonitorAlerts", () => {
  it("sends the alert and remembers it when delivered", async () => {
    mocks.notifyOwner.mockResolvedValue({ sent: 1, failed: 0, removed: 0, skipped: null });
    const r = await runMonitorAlerts(system, NOW);
    expect(r).toEqual({ sites: 1, planned: 1, sent: 1, held: 0 });
    expect(mocks.notifyOwner).toHaveBeenCalledWith(system, expect.objectContaining({ title: "Site down: Acme" }));
    expect(mocks.saveAlertState).toHaveBeenCalledWith({}, "site:s1:status", "down", NOW);
  });
  it("does not remember the alert when delivery failed, so the next run retries", async () => {
    mocks.notifyOwner.mockResolvedValue({ sent: 0, failed: 1, removed: 0, skipped: null });
    const r = await runMonitorAlerts(system, NOW);
    expect(r).toEqual({ sites: 1, planned: 1, sent: 0, held: 1 });
    expect(mocks.saveAlertState).not.toHaveBeenCalled();
  });
  it("remembers the alert without sending when no phone is registered, so old news is not replayed later", async () => {
    mocks.notifyOwner.mockResolvedValue({ sent: 0, failed: 0, removed: 0, skipped: "no_devices" });
    const r = await runMonitorAlerts(system, NOW);
    expect(r).toEqual({ sites: 1, planned: 1, sent: 0, held: 0 });
    expect(mocks.saveAlertState).toHaveBeenCalledWith({}, "site:s1:status", "down", null);
  });
  it("sends nothing when nothing changed", async () => {
    mocks.listAlertState.mockResolvedValue([{ key: "site:s1:status", state: "down" }]);
    const r = await runMonitorAlerts(system, NOW);
    expect(r.planned).toBe(0);
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
  });
});
