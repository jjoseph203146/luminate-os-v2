import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadDashboard: vi.fn(),
  getCalendar: vi.fn(),
}));
vi.mock("./repo", () => ({ loadDashboard: mocks.loadDashboard }));
vi.mock("@/domains/admin/service", () => ({ getCalendar: mocks.getCalendar }));
vi.mock("@/platform/db/server", () => ({ readDb: vi.fn(async () => ({})) }));

import { getOwnerDashboard } from "./service";
import { PermissionError } from "@/platform/errors";

const owner = { type: "owner", userId: "u1", email: "owner@example.com", ip: null } as const;
const NOW = new Date("2026-11-20T03:30:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCalendar.mockResolvedValue({ timeZone: "America/New_York" });
  mocks.loadDashboard.mockResolvedValue({
    leads: { available: true, pipelineAvailable: true, truncated: false, rows: [] },
    clients: { available: true, truncated: false, rows: [] },
    payments: { available: true, truncated: false, rows: [{ amount: 12, status: "paid", paidAt: "2026-11-19T15:00:00Z", clientId: null }] },
  });
});

describe("getOwnerDashboard", () => {
  it("is owner-only", async () => {
    for (const actor of [
      { type: "ai", name: "mcp" },
      { type: "bot", name: "daily-crm", ip: null },
      { type: "system", name: "jobs" },
      { type: "integration", name: "stripe" },
    ] as const) {
      await expect(getOwnerDashboard(actor, NOW)).rejects.toBeInstanceOf(PermissionError);
    }
    expect(mocks.loadDashboard).not.toHaveBeenCalled();
  });

  it("uses the business time zone and does not treat a paid row as anything else", async () => {
    const dash = await getOwnerDashboard(owner, NOW);
    expect(dash.today).toBe("2026-11-19");
    expect(dash.timeZone).toBe("America/New_York");
    if (!dash.revenue.available) throw new Error("expected revenue");
    expect(dash.revenue.collectedAllTime).toBe(12);
    expect(mocks.getCalendar).toHaveBeenCalledWith(owner);
  });

  it("does not call Stripe or write an audit row", () => {
    const service = readFileSync(new URL("./service.ts", import.meta.url), "utf8");
    const repo = readFileSync(new URL("./repo.ts", import.meta.url), "utf8");
    expect(service).not.toMatch(/from ["'][^"']*stripe/);
    expect(service).not.toContain("getStripe");
    expect(repo.toLowerCase()).not.toContain("stripe");
    expect(service).not.toContain("writeAudit");
    expect(repo).not.toContain(".insert(");
    expect(repo).not.toContain(".update(");
    expect(repo).not.toContain(".delete(");
  });
});
