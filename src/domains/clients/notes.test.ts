import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAudit: vi.fn(),
  clientExists: vi.fn(),
  insertNote: vi.fn(),
  getNote: vi.fn(),
  updateNote: vi.fn(),
  logActivity: vi.fn(),
}));
vi.mock("@/platform/audit/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/platform/db/server", () => ({ readDb: async () => ({ who: "owner" }), createAdminClient: () => ({ who: "admin" }) }));
vi.mock("./repo", () => ({
  clientExists: mocks.clientExists,
  insertNote: mocks.insertNote,
  getNote: mocks.getNote,
  updateNote: mocks.updateNote,
  logActivity: mocks.logActivity,
}));

import { createClientNote, updateClientNote } from "./service";
import { PermissionError, RuleError } from "@/platform/errors";
import type { Actor } from "@/platform/auth/types";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const NOTE = "22222222-2222-4222-8222-222222222222";
const bot: Actor = { type: "bot", name: "daily-crm", ip: null };
const ai: Actor = { type: "ai", name: "mcp" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clientExists.mockResolvedValue(true);
  mocks.insertNote.mockResolvedValue({ id: NOTE });
  mocks.getNote.mockResolvedValue({ id: NOTE, client_id: CLIENT, content: "Old note" });
  mocks.updateNote.mockResolvedValue(true);
  mocks.writeAudit.mockResolvedValue(undefined);
});

describe("client notes", () => {
  it("refuses the read-only ai actor before it reads anything", async () => {
    await expect(createClientNote(ai, { clientId: CLIENT, content: "Hello" })).rejects.toBeInstanceOf(PermissionError);
    await expect(updateClientNote(ai, { id: NOTE, content: "Hello" })).rejects.toBeInstanceOf(PermissionError);
    expect(mocks.clientExists).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("saves a note as the bot, on the service-role client, and audits the length but not the text", async () => {
    const content = "Called 555-0100 about the homepage.";
    const saved = await createClientNote(bot, { clientId: CLIENT, content });
    expect(saved).toEqual({ id: NOTE });
    expect(mocks.insertNote).toHaveBeenCalledWith({ who: "admin" }, CLIENT, content);
    expect(mocks.writeAudit).toHaveBeenCalledWith(bot, expect.objectContaining({ action: "client_note.created", entityId: NOTE, clientId: CLIENT, after: { length: content.length, bot: "daily-crm" } }));
    expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain("555");
  });

  it("updates the text, and does nothing when it is unchanged", async () => {
    expect(await updateClientNote(bot, { id: NOTE, content: "A new note" })).toEqual({ id: NOTE, changed: true });
    expect(mocks.updateNote).toHaveBeenCalledWith({ who: "admin" }, NOTE, "A new note");
    expect(mocks.writeAudit).toHaveBeenCalledWith(bot, expect.objectContaining({ action: "client_note.updated", after: { length: "A new note".length, bot: "daily-crm" } }));
    mocks.writeAudit.mockClear();
    expect(await updateClientNote(bot, { id: NOTE, content: "Old note" })).toEqual({ id: NOTE, changed: false });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("says so when the client or the note is missing", async () => {
    mocks.clientExists.mockResolvedValue(false);
    await expect(createClientNote(bot, { clientId: CLIENT, content: "Hello" })).rejects.toBeInstanceOf(RuleError);
    mocks.getNote.mockResolvedValue(null);
    await expect(updateClientNote(bot, { id: NOTE, content: "Hello" })).rejects.toBeInstanceOf(RuleError);
  });
});
