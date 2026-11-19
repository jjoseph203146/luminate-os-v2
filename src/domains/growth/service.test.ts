import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  PipelineNotReadyError: class PipelineNotReadyError extends Error {
    constructor() {
      super("not ready");
      this.name = "PipelineNotReadyError";
    }
  },
  writeAudit: vi.fn(),
  getLead: vi.fn(),
  findRecentLeadId: vi.fn(),
  insertManualLead: vi.fn(),
  updateLead: vi.fn(),
  setLeadStatus: vi.fn(),
  deleteLead: vi.fn(),
  pipelineReady: vi.fn(),
  insertLeadActivity: vi.fn(),
  listClientCandidates: vi.fn(),
  clientExists: vi.fn(),
  insertClient: vi.fn(),
  insertAccount: vi.fn(),
  linkAccount: vi.fn(),
  deleteUnusedAccount: vi.fn(),
  setLeadClient: vi.fn(),
  setLastTouch: vi.fn(),
  listPaidClientIds: vi.fn(),
  listLeadsForBackfill: vi.fn(),
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
  pipelineReady: mocks.pipelineReady,
  insertLeadActivity: mocks.insertLeadActivity,
  listClientCandidates: mocks.listClientCandidates,
  clientExists: mocks.clientExists,
  insertClient: mocks.insertClient,
  insertAccount: mocks.insertAccount,
  linkAccount: mocks.linkAccount,
  deleteUnusedAccount: mocks.deleteUnusedAccount,
  setLeadClient: mocks.setLeadClient,
  setLastTouch: mocks.setLastTouch,
  listPaidClientIds: mocks.listPaidClientIds,
  listLeadsForBackfill: mocks.listLeadsForBackfill,
  PipelineNotReadyError: mocks.PipelineNotReadyError,
}));

import { createLead, deleteLead, MANUAL_DUPLICATE_WINDOW_MS, patchLead, runWonBackfill, setLeadFollowUp, setLeadStage, updateLead } from "./service";
import { PermissionError, RateLimitError, RuleError, ValidationError } from "@/platform/errors";
import type { Actor } from "@/platform/auth/types";

const NOW = new Date("2026-11-05T12:00:00Z");
const ID = "11111111-1111-4111-8111-111111111111";
let n = 0;
/** A fresh owner each test, so the per-owner rate limit does not carry over. */
const owner = () => ({ type: "owner", userId: `owner-${++n}`, email: null, ip: null }) as const;

const CLIENT = "22222222-2222-4222-8222-222222222222";
const saved = {
  id: ID, name: "Marcus Rowe", businessName: "Nova Barbershop", email: "marcus@nova.example", phone: "(803) 555-0100",
  stage: "new_lead" as const, followUpDate: null, notes: "Wants a booking page", source: "Referral", value: 2500,
  nextStep: null, nextStepOn: null, lostReason: null, kind: null, campaign: null, clientId: null, stageChangedAt: null, lastTouchAt: null,
};
const emptyPipeline = { nextStep: null, nextStepOn: null, lostReason: null, kind: null, campaign: null };
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
  mocks.setLeadStatus.mockResolvedValue("legacy");
  mocks.deleteLead.mockResolvedValue(true);
  mocks.pipelineReady.mockResolvedValue(false);
  mocks.insertLeadActivity.mockResolvedValue("activity-1");
  mocks.listClientCandidates.mockResolvedValue([]);
  mocks.clientExists.mockResolvedValue(true);
  mocks.insertClient.mockResolvedValue(CLIENT);
  mocks.insertAccount.mockResolvedValue("account-1");
  mocks.linkAccount.mockResolvedValue(true);
  mocks.setLeadClient.mockResolvedValue(true);
  mocks.setLastTouch.mockResolvedValue(true);
  mocks.listPaidClientIds.mockResolvedValue(new Set());
  mocks.listLeadsForBackfill.mockResolvedValue([]);
});

describe("createLead", () => {
  it("saves a new lead at New lead with the old status value and a clean audit row", async () => {
    const r = await createLead(owner(), form, NOW);
    expect(r).toEqual({ id: ID, duplicate: false });
    expect(mocks.insertManualLead).toHaveBeenCalledWith(
      {},
      { name: "Marcus Rowe", businessName: "Nova Barbershop", email: "marcus@nova.example", phone: "(803) 555-0100", notes: "Wants a booking page", followUpDate: null, source: "Referral", value: 2500, ...emptyPipeline },
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
    expect(await setLeadStage(owner(), { id: ID, stage: "proposal_sent" }, NOW)).toEqual({ stage: "proposal_sent", changed: true, client: null });
    expect(mocks.setLeadStatus).toHaveBeenCalledWith({}, ID, "quoted", NOW.toISOString());
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "lead.stage_changed",
      before: { stage: "new_lead" },
      clientId: null,
      after: { stage: "proposal_sent", client: null, stageChangedAt: false },
    }));
  });

  it("skips a move to the stage it is already in", async () => {
    expect(await setLeadStage(owner(), { id: ID, stage: "new_lead" }, NOW)).toEqual({ stage: "new_lead", changed: false, client: null });
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

describe("the bot actor", () => {
  const bot = () => ({ type: "bot" as const, name: `bot-${++n}`, ip: "203.0.113.9" });
  it("creates a lead and stamps the audit row with the bot name, without contact details", async () => {
    const actor = bot();
    const r = await createLead(actor, form, NOW);
    expect(r).toEqual({ id: ID, duplicate: false });
    expect(mocks.writeAudit).toHaveBeenCalledWith(actor, expect.objectContaining({ action: "lead.created", after: { stage: "new_lead", source: "Referral", hasValue: true, bot: actor.name } }));
    expectNoContactDetails();
  });
  it("patches only the fields it was sent", async () => {
    const actor = bot();
    const r = await patchLead(actor, { id: ID, source: "Cold Outreach", stage: "in_discussion" }, NOW);
    expect(r.changed).toEqual(["source", "stage"]);
    expect(mocks.updateLead).toHaveBeenCalledWith({}, ID, { source: "Cold Outreach" });
    expect(mocks.setLeadStatus).toHaveBeenCalledWith({}, ID, "contacted", NOW.toISOString());
    expect(mocks.writeAudit.mock.calls.map((c) => c[1].action)).toEqual(["lead.updated", "lead.stage_changed"]);
    expect(mocks.writeAudit.mock.calls[0]?.[1].after).toMatchObject({ changed: ["source"], bot: actor.name });
  });
  it("cannot delete a lead", async () => {
    await expect(deleteLead(bot(), { id: ID, confirm: "yes" }, NOW)).rejects.toBeInstanceOf(PermissionError);
    expect(mocks.deleteLead).not.toHaveBeenCalled();
  });
});

describe("Won", () => {
  const won = { id: ID, stage: "won", contractSigned: "yes", depositPaid: "yes" };
  it("refuses until the contract is signed and the deposit is paid", async () => {
    await expect(setLeadStage(owner(), { id: ID, stage: "won" }, NOW)).rejects.toBeInstanceOf(ValidationError);
    await expect(setLeadStage(owner(), { id: ID, stage: "won", contractSigned: "yes" }, NOW)).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.insertClient).not.toHaveBeenCalled();
    expect(mocks.setLeadStatus).not.toHaveBeenCalled();
  });

  it("does not change the lead when migration 0011 is not visible", async () => {
    await expect(setLeadStage(owner(), won, NOW)).rejects.toBeInstanceOf(RuleError);
    expect(mocks.setLeadStatus).not.toHaveBeenCalled();
    expect(mocks.insertClient).not.toHaveBeenCalled();
  });

  it("links the one client with the same email and does not create another", async () => {
    mocks.pipelineReady.mockResolvedValue(true);
    mocks.setLeadStatus.mockResolvedValue("ok");
    mocks.listClientCandidates.mockResolvedValue([{ id: CLIENT, businessName: "Nova Barbershop", email: "marcus@nova.example", contactName: "Marcus", archived: false }]);
    expect(await setLeadStage(owner(), won, NOW)).toEqual({ stage: "won", changed: true, client: "linked" });
    expect(mocks.setLeadClient).toHaveBeenCalledWith({}, ID, CLIENT);
    expect(mocks.insertClient).not.toHaveBeenCalled();
    expect(mocks.insertLeadActivity).toHaveBeenCalledWith({}, expect.objectContaining({ kind: "stage" }));
    expectNoContactDetails();
  });

  it("creates a client when nothing matches, and keeps the contact details out of the audit", async () => {
    mocks.pipelineReady.mockResolvedValue(true);
    mocks.setLeadStatus.mockResolvedValue("ok");
    const r = await setLeadStage(owner(), won, NOW);
    expect(r.client).toBe("created");
    expect(mocks.insertClient).toHaveBeenCalledWith({}, expect.objectContaining({ business_name: "Nova Barbershop", contact_name: "Marcus Rowe", email: "marcus@nova.example", status: "active" }));
    expect(mocks.insertAccount).toHaveBeenCalled();
    expect(mocks.writeAudit.mock.calls.map((c) => c[1].action)).toEqual(["client.created_from_lead", "lead.client_linked", "lead.stage_changed"]);
    expectNoContactDetails();
  });

  it("refuses to guess when two clients match", async () => {
    mocks.pipelineReady.mockResolvedValue(true);
    mocks.listClientCandidates.mockResolvedValue([
      { id: CLIENT, businessName: "A", email: "marcus@nova.example", contactName: "A", archived: false },
      { id: "33333333-3333-4333-8333-333333333333", businessName: "B", email: "marcus@nova.example", contactName: "B", archived: false },
    ]);
    await expect(setLeadStage(owner(), won, NOW)).rejects.toBeInstanceOf(RuleError);
    expect(mocks.insertClient).not.toHaveBeenCalled();
    expect(mocks.setLeadStatus).not.toHaveBeenCalled();
  });

  it("uses the client id the owner typed", async () => {
    mocks.pipelineReady.mockResolvedValue(true);
    mocks.setLeadStatus.mockResolvedValue("ok");
    await setLeadStage(owner(), { ...won, clientId: CLIENT }, NOW);
    expect(mocks.clientExists).toHaveBeenCalledWith({}, CLIENT);
    expect(mocks.setLeadClient).toHaveBeenCalledWith({}, ID, CLIENT);
    expect(mocks.insertClient).not.toHaveBeenCalled();
  });

  it("will not clear the reason on a lead that is already lost", async () => {
    mocks.getLead.mockResolvedValue({ ...saved, stage: "lost", lostReason: "timing" });
    await expect(updateLead(owner(), { ...form, id: ID, lostReason: "" }, NOW)).rejects.toBeInstanceOf(RuleError);
    expect(mocks.updateLead).not.toHaveBeenCalled();
  });

  it("requires a lost reason and records it", async () => {
    await expect(setLeadStage(owner(), { id: ID, stage: "lost" }, NOW)).rejects.toBeInstanceOf(ValidationError);
    mocks.pipelineReady.mockResolvedValue(false);
    await setLeadStage(owner(), { id: ID, stage: "lost", lostReason: "timing" }, NOW);
    expect(mocks.updateLead).toHaveBeenCalledWith({}, ID, { lostReason: "timing" });
    expect(mocks.setLeadStatus).toHaveBeenCalledWith({}, ID, "lost", NOW.toISOString());
  });
});

describe("pipeline edits", () => {
  it("patches next step, lost reason and last touch without touching omitted contact fields", async () => {
    const actor = { type: "bot" as const, name: "daily-crm", ip: null };
    const r = await patchLead(actor, { id: ID, nextStep: "Send the proposal", nextStepOn: "2026-11-20", lostReason: "price", lastTouchAt: "2026-11-19T15:00:00Z" }, NOW);
    expect(r.changed).toEqual(["nextStep", "nextStepOn", "lostReason", "lastTouchAt"]);
    expect(mocks.updateLead).toHaveBeenCalledWith({}, ID, { nextStep: "Send the proposal", nextStepOn: "2026-11-20", lostReason: "price" });
    expect(mocks.setLastTouch).toHaveBeenCalledWith({}, ID, "2026-11-19T15:00:00.000Z");
    expect(mocks.insertLeadActivity).toHaveBeenCalledWith({}, expect.objectContaining({ kind: "outreach", summary: "Last touch recorded." }));
    expectNoContactDetails();
  });

  it("keeps the previous notes before replacing them, and refuses when history cannot be stored", async () => {
    await updateLead(owner(), { ...form, id: ID, notes: "A newer note" }, NOW);
    expect(mocks.insertLeadActivity).toHaveBeenCalledWith({}, expect.objectContaining({ kind: "note", summary: "Notes replaced.", body: "Wants a booking page" }));
    expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain("newer note");
    expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain("booking page");
    mocks.insertLeadActivity.mockResolvedValue("unavailable");
    mocks.updateLead.mockClear();
    await expect(updateLead(owner(), { ...form, id: ID, notes: "Another note" }, NOW)).rejects.toBeInstanceOf(RuleError);
    expect(mocks.updateLead).not.toHaveBeenCalled();
  });

  it("turns a missing pipeline column into a rule error and does not pretend it saved", async () => {
    mocks.updateLead.mockRejectedValue(new mocks.PipelineNotReadyError());
    await expect(patchLead({ type: "bot", name: "daily-crm", ip: null }, { id: ID, nextStep: "Call" }, NOW)).rejects.toBeInstanceOf(RuleError);
  });
});

describe("runWonBackfill", () => {
  const system = { type: "system" as const, name: "won-backfill" };
  let previousEnv: string | undefined;
  beforeEach(() => {
    previousEnv = process.env.APP_ENV;
    process.env.APP_ENV = "staging";
  });
  afterEach(() => {
    if (previousEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previousEnv;
  });

  it("refuses production before it reads, and refuses the bot", async () => {
    process.env.APP_ENV = "production";
    await expect(runWonBackfill(system, { apply: true })).rejects.toBeInstanceOf(RuleError);
    expect(mocks.listLeadsForBackfill).not.toHaveBeenCalled();
    process.env.APP_ENV = "staging";
    await expect(runWonBackfill({ type: "bot", name: "daily-crm", ip: null }, { apply: false })).rejects.toBeInstanceOf(PermissionError);
    await expect(runWonBackfill({ type: "system", name: "billing_tasks" }, { apply: false })).rejects.toBeInstanceOf(PermissionError);
  });

  it("dry-run returns the plan and writes nothing", async () => {
    mocks.pipelineReady.mockResolvedValue(true);
    mocks.listClientCandidates.mockResolvedValue([{ id: CLIENT, businessName: "Nova Barbershop", email: "marcus@nova.example", contactName: "M", phone: null, archived: false, lifetimeValue: 40 }]);
    mocks.listLeadsForBackfill.mockResolvedValue([{ id: ID, name: "Marcus Rowe", businessName: "Nova Barbershop", email: "marcus@nova.example", phone: null, stage: "new_lead", clientId: null }]);
    const r = await runWonBackfill(system, { apply: false });
    expect(r).toMatchObject({ apply: false, target: "staging", payingCount: 1, applied: [] });
    expect(r.actions).toEqual([{ op: "link", leadId: ID, clientId: CLIENT, how: "email", markWon: true }]);
    expect(mocks.setLeadClient).not.toHaveBeenCalled();
    expect(mocks.insertClient).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain("marcus@");
    expect(r.roster.clients[0]?.businessName).toBe("Nova Barbershop");
  });

  it("apply creates a client for an unlinked Won lead", async () => {
    mocks.pipelineReady.mockResolvedValue(true);
    mocks.listClientCandidates.mockResolvedValue([]);
    mocks.listLeadsForBackfill.mockResolvedValue([{ id: ID, name: "Ada", businessName: "New Co", email: null, phone: null, stage: "won", clientId: null }]);
    const r = await runWonBackfill(system, { apply: true });
    expect(r.applied).toEqual([{ op: "create_client", leadId: ID, clientId: CLIENT, created: true }]);
    expect(mocks.setLeadClient).toHaveBeenCalledWith({}, ID, CLIENT);
    expect(mocks.writeAudit).toHaveBeenCalled();
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
