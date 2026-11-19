import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAudit: vi.fn(),
  getClientName: vi.fn(),
  findRecentRequest: vi.fn(),
  nextRequestDisplayId: vi.fn(),
  insertRequest: vi.fn(),
  clientHasWebsite: vi.fn(),
}));
vi.mock("@/platform/audit/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/platform/db/server", () => ({
  createUserClient: async () => ({ who: "owner" }),
  createAdminClient: () => ({ who: "admin" }),
  readDb: async () => ({}),
}));
vi.mock("@/domains/admin/service", () => ({ getCalendar: vi.fn() }));
vi.mock("./repo", () => ({
  getClientName: mocks.getClientName,
  findRecentRequest: mocks.findRecentRequest,
  nextRequestDisplayId: mocks.nextRequestDisplayId,
  insertRequest: mocks.insertRequest,
  clientHasWebsite: mocks.clientHasWebsite,
  RepoError: class RepoError extends Error { code: string | null = null; },
}));

import { createRequest } from "./service";
import { PermissionError } from "@/platform/errors";
import type { Actor } from "@/platform/auth/types";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const bot: Actor = { type: "bot", name: "daily-crm", ip: null };
const ai: Actor = { type: "ai", name: "mcp" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClientName.mockResolvedValue("Acme");
  mocks.findRecentRequest.mockResolvedValue(null);
  mocks.nextRequestDisplayId.mockResolvedValue("LUM-20");
  mocks.insertRequest.mockResolvedValue({ id: "req-1", displayId: "LUM-20", coverageStored: true });
  mocks.writeAudit.mockResolvedValue(undefined);
});

describe("createRequest", () => {
  it("refuses the read-only ai actor", async () => {
    await expect(createRequest(ai, { clientId: CLIENT, title: "Update hours", coverage: "included" })).rejects.toBeInstanceOf(PermissionError);
    expect(mocks.insertRequest).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("stores included-in-care as the bot and audits the classification, not a charge", async () => {
    const saved = await createRequest(bot, { clientId: CLIENT, title: "Update hours", coverage: "included", status: "new" });
    expect(saved).toMatchObject({ id: "req-1", displayId: "LUM-20", duplicate: false, coverageStored: true });
    expect(mocks.insertRequest).toHaveBeenCalledWith({ who: "admin" }, expect.objectContaining({ coverage: "included", price: null, status: "new" }));
    const after = mocks.writeAudit.mock.calls[0]?.[1].after;
    expect(after).toMatchObject({ coverage: "included", price: null, bot: "daily-crm", origin: "bot" });
    expect(mocks.writeAudit.mock.calls[0]?.[0]).toEqual(bot);
  });
});
