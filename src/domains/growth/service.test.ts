import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAudit: vi.fn(),
  getLead: vi.fn(),
  findRecentLeadId: vi.fn(),
  insertManualLead: vi.fn(),
  updateLead: vi.fn(),
  setLeadStatus: vi.fn(),
  deleteLead: vi.fn(),
}));

vi.mock("@/platform/audit/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/platform/db/server", () => ({ createAdminClient: () => ({}), readDb: async () => ({}) }));
vi.mock("@/domains/admin/service", () => ({ getCalendar: vi.fn() }));
vi.mock("./repo", () => ({
  listLeads: vi.fn(),
  countSourceSince: vi.fn(),
  findRecentDuplicate: vi.fn(),
  insertLead: vi.fn(),
  getLead: mocks.getLead,
  findRecentLeadId: mocks.findRecentLeadId,
  insertManualLead: mocks.insertManualLead,
  updateLead: mocks.updateLead,
  setLeadStatus: mocks.setLeadStatus,
  deleteLead: mocks.deleteLead,
}));

import { createLead, deleteLead, MANUAL_DUPLICATE_WINDOW_MS, setLeadFollowUp, setLeadStage, updateLead } from "./service";
import { PermissionError, RateLimitError, RuleError, ValidationError } from "@/platform/errors";
import type { Actor } from "@/platform/auth/types";

const NOW = new Date("2026-11-05T12:00:00Z");
const ID = "11111111-1111-4111-8111-111111111111";
let n = 0;
/** A fresh owner each test, so the per-owner rate limit does not carry over. */
const owner = () => ({ type: "owner", userId: `owner-${++n}`, email: null, ip: null }) as const;

const saved = {
  id: ID, name: "Marcus Rowe", businessName: "Nova Barbershop", email: "marcus@nova.example", phone: "(803) 555-0100",
  stage: "new_lead", followUpDate: null, notes: "Wants a booking page", source: "Referral", value: 2500,
};
const form = { name: "Marcus Rowe", businessName: "Nova Barbershop", email: "marcus@nova.example", phone: "(803) 555-0100", notes: "Wants a booking page", followUpDate: "", source: "Referral", value: "2500" };

/** No email, phone, notes or names in any audit row. */
function expectNoContactDetails() {
  const rows = JSON.stringify(mocks.writeAudit.mock.calls);
  for (const secret of ["marcus", "Marcus", "555", "booking page", "Nova"]) expect(rows).not.toContain(secret);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLead.mockResolvedValue({ ...saved });
  mocks.findRecentLeadId.mockResolvedValue(null);
  mocks.insertManualLead.mockResolvedValue(ID);
  mocks.updateLead.mockResolvedValue(true);
  mocks.setLeadStatus.mockResolvedValue(true);
  mocks.deleteLead.mockResolvedValue(true);
});

describe("createLead", () => {
  it("saves a new lead at New lead with the old status value and a clean audit row", async () => {
    const r = await createLead(owner(), form, NOW);
    expect(r).toEqual({ id: ID, duplicate: false });
    expect(mocks.insertManualLead).toHaveBeenCalledWith(
      {},
      { name: "Marcus Rowe", businessName: "Nova Barbershop", email: "marcus@nova.example", phone: "(803) 555-0100", notes: "Wants a booking page", followUpDate: null, source: "Referral", value: 2500 },
      "interested",
    );
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "lead.created", entityId: ID, after: { stage: "new_lead", source: "Referral", hasValue: true } }));
    expectNoContactDetails();
  });

  it("returns the lead already saved on a double tap and saves nothing new", async () => {
    mocks.findRecentLeadId.mockResolvedValue("existing");
    expect(await createLead(owner(), form, NOW)).toEqual({ id: "existing", duplicate: true });
    expect(mocks.findRecentLeadId).toHaveBeenCalledWith({}, expect.objectContaining({ name: "Marcus Rowe", email: "marcus@nova.example", since: new Date(NOW.getTime() - MANUAL_DUPLICATE_WINDOW_MS) }));
    expect(mocks.insertManualLead).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("fills a blank business name, tidies text and reads a formatted value", async () => {
    await createLead(owner(), { name: "  Jane   Smith ", businessName: " ", email: "JANE@Acme.COM", value: "$1,250.50", followUpDate: "2026-12-01" }, NOW);
    expect(mocks.insertManualLead.mock.calls[0]?.[1]).toMatchObject({ name: "Jane Smith", businessName: "Not given", email: "jane@acme.com", phone: null, value: 1250.5, followUpDate: "2026-12-01" });
  });

  it.each([
    [{ ...form, name: "" }, "name"],
    [{ ...form, email: "nope" }, "valid email"],
    [{ ...form, phone: "123" }, "too short"],
    [{ ...form, phone: "call me" }, "digits"],
    [{ ...form, value: "-5" }, "number of dollars"],
    [{ ...form, value: "10.555" }, "number of dollars"],
    [{ ...form, value: "99999999" }, "too large"],
    [{ ...form, followUpDate: "2026-02-30" }, "real date"],
    [{ ...form, notes: "x".repeat(5001) }, "too long"],
    [{ ...form, source: "x".repeat(81) }, "too long"],
  ])("rejects bad input %#", async (input, words) => {
    const err = await createLead(owner(), input, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).issues.join(" ")).toContain(words);
    expect(mocks.insertManualLead).not.toHaveBeenCalled();
  });

  it("slows a flood of changes", async () => {
    const o = owner();
    for (let i = 0; i < 30; i++) await createLead(o, form, NOW);
    await expect(createLead(o, form, NOW)).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("updateLead", () => {
  it("saves only the changed fields and audits their names", async () => {
    const r = await updateLead(owner(), { ...form, id: ID, email: "new@nova.example", value: "3000" }, NOW);
    expect(r).toEqual({ changed: ["email", "value"] });
    expect(mocks.updateLead).toHaveBeenCalledWith({}, ID, { email: "new@nova.example", value: 3000 });
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "lead.updated", entityId: ID, after: { changed: ["email", "value"] } }));
    expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain("new@nova");
    expectNoContactDetails();
  });

  it("does nothing when nothing changed", async () => {
    expect(await updateLead(owner(), { ...form, id: ID }, NOW)).toEqual({ changed: [] });
    expect(mocks.updateLead).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("says so when the lead is gone", async () => {
    mocks.getLead.mockResolvedValue(null);
    await expect(updateLead(owner(), { ...form, id: ID }, NOW)).rejects.toBeInstanceOf(RuleError);
  });

  it("needs a real lead id", async () => {
    await expect(updateLead(owner(), { ...form, id: "x" }, NOW)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("setLeadStage", () => {
  it("writes the old status value and audits the move", async () => {
    expect(await setLeadStage(owner(), { id: ID, stage: "proposal_sent" }, NOW)).toEqual({ stage: "proposal_sent", changed: true });
    expect(mocks.setLeadStatus).toHaveBeenCalledWith({}, ID, "quoted");
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "lead.stage_changed", before: { stage: "new_lead" }, after: { stage: "proposal_sent" } }));
  });

  it("skips a move to the stage it is already in", async () => {
    expect(await setLeadStage(owner(), { id: ID, stage: "new_lead" }, NOW)).toEqual({ stage: "new_lead", changed: false });
    expect(mocks.setLeadStatus).not.toHaveBeenCalled();
  });

  it("refuses an unknown stage, including a raw status value", async () => {
    await expect(setLeadStage(owner(), { id: ID, stage: "quoted" }, NOW)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("setLeadFollowUp", () => {
  it("sets and clears the date", async () => {
    expect(await setLeadFollowUp(owner(), { id: ID, followUpDate: "2026-11-20" }, NOW)).toEqual({ followUpDate: "2026-11-20", changed: true });
    expect(mocks.updateLead).toHaveBeenCalledWith({}, ID, { followUpDate: "2026-11-20" });
    mocks.getLead.mockResolvedValue({ ...saved, followUpDate: "2026-11-20" });
    expect(await setLeadFollowUp(owner(), { id: ID, followUpDate: "" }, NOW)).toEqual({ followUpDate: null, changed: true });
    expect(mocks.updateLead).toHaveBeenLastCalledWith({}, ID, { followUpDate: null });
  });
});

describe("deleteLead", () => {
  it("needs the confirmation box", async () => {
    await expect(deleteLead(owner(), { id: ID }, NOW)).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.deleteLead).not.toHaveBeenCalled();
  });

  it("deletes and audits without contact details", async () => {
    await deleteLead(owner(), { id: ID, confirm: "yes" }, NOW);
    expect(mocks.deleteLead).toHaveBeenCalledWith({}, ID);
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "lead.deleted", entityId: ID, before: { stage: "new_lead" } }));
    expectNoContactDetails();
  });
});

describe("permissions", () => {
  const others: Actor[] = [
    { type: "ai", name: "connector" },
    { type: "system", name: "job" },
    { type: "integration", name: "stripe" },
  ];
  it.each(others)("refuses $type", async (actor) => {
    const a = actor as unknown as ReturnType<typeof owner>;
    await expect(createLead(a, form, NOW)).rejects.toBeInstanceOf(PermissionError);
    await expect(updateLead(a, { ...form, id: ID }, NOW)).rejects.toBeInstanceOf(PermissionError);
    await expect(setLeadStage(a, { id: ID, stage: "won" }, NOW)).rejects.toBeInstanceOf(PermissionError);
    await expect(setLeadFollowUp(a, { id: ID, followUpDate: "" }, NOW)).rejects.toBeInstanceOf(PermissionError);
    await expect(deleteLead(a, { id: ID, confirm: "yes" }, NOW)).rejects.toBeInstanceOf(PermissionError);
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
});
