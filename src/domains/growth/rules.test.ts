import { describe, expect, it } from "vitest";
import { dueNow, followUpNote, followUpShort, followUpState, sortOpen, stageOf, summarize } from "./rules";
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
