import { describe, expect, it } from "vitest";
import { changedLeadFields, dueNow, followUpNote, followUpShort, followUpState, leadSavedMessage, sortOpen, STAGE_TO_STATUS, stageMessage, stageOf, STATUS_TO_STAGE, statusOf, summarize, type LeadFields } from "./rules";
import { LEAD_STATUSES, STAGES } from "./types";
import type { Lead } from "./types";

const TODAY = "2026-11-05";
const lead = (over: Partial<Lead>): Lead => ({
  id: "x", name: "N", businessName: "B", email: null, phone: null, stage: "new_lead", followUpDate: null,
  notes: null, source: null, value: null, createdAt: "2026-11-01T00:00:00Z", ...over,
});

describe("stageOf", () => {
  it("maps the old statuses", () => {
    expect(stageOf("interested")).toBe("new_lead");
    expect(stageOf("contacted")).toBe("in_discussion");
    expect(stageOf("quoted")).toBe("proposal_sent");
    expect(stageOf("won")).toBe("won");
    expect(stageOf("lost")).toBe("lost");
  });
  it("shows an unknown status as a new lead", () => expect(stageOf("???")).toBe("new_lead"));
});

describe("follow-ups", () => {
  it("classifies by date", () => {
    expect(followUpState(lead({ followUpDate: "2026-11-04" }), TODAY)).toBe("overdue");
    expect(followUpState(lead({ followUpDate: TODAY }), TODAY)).toBe("today");
    expect(followUpState(lead({ followUpDate: "2026-11-09" }), TODAY)).toBe("upcoming");
    expect(followUpState(lead({}), TODAY)).toBe("none");
  });
  it("ignores closed leads", () => expect(followUpState(lead({ stage: "won", followUpDate: "2026-11-01" }), TODAY)).toBe("none"));
  it("words the note", () => {
    expect(followUpNote(lead({ followUpDate: "2026-11-04" }), TODAY)).toBe("Follow-up overdue · 1 day");
    expect(followUpNote(lead({ followUpDate: "2026-11-02" }), TODAY)).toBe("Follow-up overdue · 3 days");
    expect(followUpNote(lead({ followUpDate: TODAY }), TODAY)).toBe("Follow-up due today");
    expect(followUpNote(lead({ followUpDate: "2026-11-06" }), TODAY)).toBe("Follow-up in 1 day");
    expect(followUpNote(lead({ source: "Referral" }), TODAY)).toBe("Referral · No follow-up date");
  });
});

describe("followUpShort", () => {
  it("is short enough for a list row", () => {
    expect(followUpShort(lead({ followUpDate: "2026-11-04" }), TODAY)).toBe("1 day overdue");
    expect(followUpShort(lead({ followUpDate: TODAY }), TODAY)).toBe("Follow up today");
    expect(followUpShort(lead({ followUpDate: "2026-11-20" }), TODAY)).toBe("Follow up in 15 days");
    expect(followUpShort(lead({ source: "Referral" }), TODAY)).toBe("Referral");
    expect(followUpShort(lead({}), TODAY)).toBe("No follow-up date");
  });
});

describe("summarize", () => {
  const leads = [
    lead({ id: "1", businessName: "Maple", stage: "proposal_sent", value: 850, followUpDate: "2026-11-04" }),
    lead({ id: "2", stage: "in_discussion", value: 1200, followUpDate: TODAY }),
    lead({ id: "3", stage: "new_lead", value: null }),
    lead({ id: "4", stage: "won", value: 2000, followUpDate: "2026-01-01" }),
    lead({ id: "5", stage: "lost", value: 500 }),
  ];
  const s = summarize(leads, TODAY);
  it("adds open deal value only and counts leads with no value", () => {
    expect(s.pipelineValue).toBe(2050);
    expect(s.unvalued).toBe(1);
    expect(s.openCount).toBe(3);
  });
  it("counts follow-ups and proposals", () => {
    expect(s.followUpsDue).toBe(2);
    expect(s.followUpsOverdue).toBe(1);
    expect(s.proposalsOut).toBe(1);
    expect(s.proposalNames).toEqual(["Maple"]);
  });
  it("computes the win rate only from closed leads", () => {
    expect(s.winRate).toBe(50);
    expect(summarize([lead({})], TODAY).winRate).toBeNull();
  });
  it("lists the four stages without lost", () => expect(s.stages.map((x) => x.stage)).toEqual(["new_lead", "in_discussion", "proposal_sent", "won"]));
  it("handles no leads", () => {
    const e = summarize([], TODAY);
    expect(e.pipelineValue).toBe(0);
    expect(e.winRate).toBeNull();
  });
});

describe("ordering", () => {
  it("puts the most overdue follow-up first", () => {
    const a = lead({ id: "a", followUpDate: "2026-11-04" });
    const b = lead({ id: "b", followUpDate: "2026-11-01" });
    const c = lead({ id: "c", followUpDate: "2026-11-09" });
    expect(dueNow([a, b, c], TODAY).map((l) => l.id)).toEqual(["b", "a"]);
    expect(sortOpen([c, a, b, lead({ id: "d" })]).map((l) => l.id)).toEqual(["b", "a", "c", "d"]);
  });
});

describe("statusOf", () => {
  it("writes the old status values the database accepts", () => {
    expect(statusOf("new_lead")).toBe("interested");
    expect(statusOf("in_discussion")).toBe("contacted");
    expect(statusOf("proposal_sent")).toBe("quoted");
    expect(statusOf("won")).toBe("won");
    expect(statusOf("lost")).toBe("lost");
  });
  it("round-trips every stage and every status", () => {
    for (const stage of STAGES) expect(stageOf(statusOf(stage))).toBe(stage);
    for (const status of LEAD_STATUSES) expect(statusOf(stageOf(status))).toBe(status);
  });
  it("only ever writes an allowed status", () => {
    expect([...new Set(Object.values(STAGE_TO_STATUS))].sort()).toEqual([...LEAD_STATUSES].sort());
    expect(Object.keys(STATUS_TO_STAGE).sort()).toEqual([...LEAD_STATUSES].sort());
  });
});

describe("changedLeadFields", () => {
  const base: LeadFields = { name: "A", businessName: "B", email: "a@b.co", phone: null, notes: null, followUpDate: null, source: null, value: 100 };
  it("lists only the names of changed fields", () => {
    expect(changedLeadFields(base, { ...base })).toEqual([]);
    expect(changedLeadFields(base, { ...base, email: "c@d.co", value: 200, followUpDate: "2026-12-01" })).toEqual(["email", "followUpDate", "value"]);
  });
  it("treats a missing value and null alike", () => {
    expect(changedLeadFields({ ...base, notes: undefined as unknown as null }, base)).toEqual([]);
  });
});

describe("messages", () => {
  it("words a stage change", () => {
    expect(stageMessage({ stage: "won", changed: true })).toBe("Moved to Won.");
    expect(stageMessage({ stage: "won", changed: false })).toBe("Already in Won.");
  });
  it("words an edit", () => {
    expect(leadSavedMessage([])).toBe("Nothing changed.");
    expect(leadSavedMessage(["email"])).toBe("Lead saved.");
  });
});
