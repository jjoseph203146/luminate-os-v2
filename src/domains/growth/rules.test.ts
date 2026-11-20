import { describe, expect, it } from "vitest";
import { assertBackfillEnvironment, assertBackfillPreviewAllowed, assertBackfillWriteAllowed, botTriesToWin, changedLeadFields, clientFromLead, confirmUrlFromArgv, decideClientLink, dueNow, followUpNote, followUpShort, followUpState, isPayingClient, leadSavedMessage, parseBackfillMode, planWonBackfill, projectRefFromSupabaseUrl, sortOpen, STAGE_TO_STATUS, stageMessage, stageOf, STATUS_TO_STAGE, statusOf, summarize, type BackfillClient, type BackfillLead, type LeadFields, type WonBackfillPlan } from "./rules";
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
  const base: LeadFields = { name: "A", businessName: "B", email: "a@b.co", phone: null, notes: null, followUpDate: null, source: null, value: 100, nextStep: null, nextStepOn: null, lostReason: null, kind: null, campaign: null };
  it("lists only the names of changed fields", () => {
    expect(changedLeadFields(base, { ...base })).toEqual([]);
    expect(changedLeadFields(base, { ...base, email: "c@d.co", value: 200, followUpDate: "2026-12-01" })).toEqual(["email", "followUpDate", "value"]);
    expect(changedLeadFields(base, { ...base, nextStep: "Call", kind: "inbound" })).toEqual(["nextStep", "kind"]);
  });
  it("treats a missing value and null alike", () => {
    expect(changedLeadFields({ ...base, notes: undefined as unknown as null }, base)).toEqual([]);
  });
});

describe("messages", () => {
  it("words a stage change", () => {
    expect(stageMessage({ stage: "won", changed: true })).toBe("Moved to Won.");
    expect(stageMessage({ stage: "won", changed: true, client: "created" })).toBe("Moved to Won and created a client.");
    expect(stageMessage({ stage: "won", changed: true, client: "linked" })).toBe("Moved to Won and linked the client.");
    expect(stageMessage({ stage: "won", changed: false })).toBe("Already in Won.");
  });
  it("words an edit", () => {
    expect(leadSavedMessage([])).toBe("Nothing changed.");
    expect(leadSavedMessage(["email"])).toBe("Lead saved.");
  });
});

const cid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const client = (n: number, over: Partial<BackfillClient> = {}): BackfillClient => ({
  id: cid(n),
  businessName: `Client ${n}`,
  email: `c${n}@example.com`,
  contactName: `Person ${n}`,
  archived: false,
  paying: true,
  ...over,
});
const leadRow = (n: number, over: Partial<BackfillLead> = {}): BackfillLead => ({
  id: cid(100 + n),
  name: `Lead ${n}`,
  businessName: `Lead Co ${n}`,
  email: null,
  phone: null,
  stage: "new_lead",
  clientId: null,
  ...over,
});

describe("decideClientLink", () => {
  const clients = [client(1), client(2, { businessName: "Shared", email: "other@example.com" }), client(3, { archived: true, email: "gone@example.com", businessName: "Gone Co" })];
  it("keeps a client the lead already has", () => {
    expect(decideClientLink({ clientId: cid(1), email: "nope@example.com", businessName: "Other" }, clients)).toEqual({ action: "keep", clientId: cid(1) });
  });
  it("matches one email, and does not use a placeholder or an archived client", () => {
    expect(decideClientLink({ clientId: null, email: "C1@Example.com", businessName: "Nope" }, clients)).toEqual({ action: "link", clientId: cid(1), how: "email" });
    expect(decideClientLink({ clientId: null, email: "no-email", businessName: "Not given" }, clients).action).toBe("create");
    expect(decideClientLink({ clientId: null, email: "gone@example.com", businessName: "Gone Co" }, clients).action).toBe("create");
  });
  it("matches the business name when the email does not, and refuses two matches", () => {
    expect(decideClientLink({ clientId: null, email: null, businessName: "Shared" }, clients)).toEqual({ action: "link", clientId: cid(2), how: "business_name" });
    const ambiguous = decideClientLink({ clientId: null, email: null, businessName: "Client 1" }, [client(1), client(4, { businessName: "Client 1", email: "c4@example.com" })]);
    expect(ambiguous.action).toBe("ambiguous");
  });
});

describe("clientFromLead", () => {
  it("uses the old placeholders and marks the client active", () => {
    expect(clientFromLead({ name: "Ada", businessName: "Not given", email: null, phone: null })).toEqual({
      business_name: "Unnamed",
      contact_name: "Ada",
      email: "no-email",
      phone: null,
      status: "active",
    });
  });
});

describe("isPayingClient", () => {
  it("counts a positive lifetime value or a paid revenue row, and skips archived clients", () => {
    expect(isPayingClient({ archived: false, lifetimeValue: 35, paidRevenue: false })).toBe(true);
    expect(isPayingClient({ archived: false, lifetimeValue: 0, paidRevenue: true })).toBe(true);
    expect(isPayingClient({ archived: false, lifetimeValue: 0, paidRevenue: false })).toBe(false);
    expect(isPayingClient({ archived: true, lifetimeValue: 100, paidRevenue: true })).toBe(false);
  });
});

describe("assertBackfillEnvironment", () => {
  it("allows local and staging only", () => {
    expect(assertBackfillEnvironment("local")).toBe("local");
    expect(assertBackfillEnvironment("staging")).toBe("staging");
    expect(() => assertBackfillEnvironment("production")).toThrow(/production/);
    expect(() => assertBackfillEnvironment(undefined)).toThrow(/production/);
  });
});

describe("botTriesToWin", () => {
  it("catches Won and a client id, and ignores an empty client id", () => {
    expect(botTriesToWin({ stage: "won" })).toBe(true);
    expect(botTriesToWin({ stage: " Won " })).toBe(true);
    expect(botTriesToWin({ clientId: "22222222-2222-4222-8222-222222222222" })).toBe(true);
    expect(botTriesToWin({ stage: "in_discussion", clientId: "" })).toBe(false);
    expect(botTriesToWin({ stage: "in_discussion", clientId: null })).toBe(false);
    expect(botTriesToWin({ stage: "lost" })).toBe(false);
  });
});

const STAGING_URL = "https://stagingref.supabase.co";

describe("assertBackfillWriteAllowed", () => {
  it("reads a project ref and ignores a trailing slash", () => {
    expect(projectRefFromSupabaseUrl(STAGING_URL)).toBe("stagingref");
    expect(projectRefFromSupabaseUrl("http://127.0.0.1:54321")).toBeNull();
  });

  it("allows --confirm-url or an allowlisted ref, and still refuses production", () => {
    expect(assertBackfillWriteAllowed({ appEnv: "staging", supabaseUrl: STAGING_URL, confirmUrl: `${STAGING_URL}/` })).toBe("staging");
    expect(assertBackfillWriteAllowed({ appEnv: "local", supabaseUrl: STAGING_URL, allowedProjectRefs: "other, stagingref" })).toBe("local");
    expect(() => assertBackfillWriteAllowed({ appEnv: "staging", supabaseUrl: STAGING_URL })).toThrow(/Refusing to write/);
    expect(() => assertBackfillWriteAllowed({ appEnv: "staging", supabaseUrl: STAGING_URL, confirmUrl: "https://other.supabase.co" })).toThrow(/Refusing to write/);
    expect(() => assertBackfillWriteAllowed({ appEnv: "staging", supabaseUrl: STAGING_URL, allowedProjectRefs: "other" })).toThrow(/Refusing to write/);
    expect(() => assertBackfillWriteAllowed({ appEnv: "production", supabaseUrl: STAGING_URL, confirmUrl: STAGING_URL })).toThrow(/production/);
    expect(() => assertBackfillWriteAllowed({ appEnv: undefined, supabaseUrl: STAGING_URL, allowedProjectRefs: "stagingref" })).toThrow(/production/);
    expect(() => assertBackfillWriteAllowed({ appEnv: "staging", supabaseUrl: undefined, confirmUrl: STAGING_URL })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("reads one --confirm-url flag", () => {
    expect(confirmUrlFromArgv(["node", "script", "--apply"])).toBeUndefined();
    expect(confirmUrlFromArgv(["--confirm-url=https://stagingref.supabase.co"])).toBe("https://stagingref.supabase.co");
    expect(() => confirmUrlFromArgv(["--confirm-url=", "--confirm-url=https://a.supabase.co"])).toThrow(/once/);
    expect(() => confirmUrlFromArgv(["--confirm-url="])).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});

const PROD_URL = "https://prodref.supabase.co";

describe("assertBackfillPreviewAllowed", () => {
  it("allows local and staging without the production acknowledgement", () => {
    expect(assertBackfillPreviewAllowed({ appEnv: "local", acknowledgeProduction: false })).toBe("local");
    expect(assertBackfillPreviewAllowed({ appEnv: "staging", acknowledgeProduction: false })).toBe("staging");
  });

  it("allows production only with the acknowledgement and a project ref", () => {
    expect(assertBackfillPreviewAllowed({ appEnv: "production", acknowledgeProduction: true, supabaseUrl: PROD_URL })).toBe("production");
    expect(() => assertBackfillPreviewAllowed({ appEnv: "production", acknowledgeProduction: false, supabaseUrl: PROD_URL })).toThrow(/i-know-this-is-production/);
    expect(() => assertBackfillPreviewAllowed({ appEnv: "production", acknowledgeProduction: true })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => assertBackfillPreviewAllowed({ appEnv: "production", acknowledgeProduction: true, supabaseUrl: "http://127.0.0.1:54321" })).toThrow(/supabase\.co/);
  });

  it("refuses an unset APP_ENV", () => {
    expect(() => assertBackfillPreviewAllowed({ appEnv: undefined, acknowledgeProduction: true, supabaseUrl: PROD_URL })).toThrow(/unset APP_ENV/);
  });
});

describe("parseBackfillMode", () => {
  it("defaults to dry-run and reads preview", () => {
    expect(parseBackfillMode(["node", "script"])).toEqual({ mode: "dry-run", confirmUrl: undefined, acknowledgeProduction: false });
    expect(parseBackfillMode(["--preview", "--i-know-this-is-production"])).toEqual({ mode: "preview", confirmUrl: undefined, acknowledgeProduction: true });
    expect(parseBackfillMode(["--apply", "--confirm-url=https://stagingref.supabase.co"])).toEqual({
      mode: "apply",
      confirmUrl: "https://stagingref.supabase.co",
      acknowledgeProduction: false,
    });
  });

  it("rejects mixed flags", () => {
    expect(() => parseBackfillMode(["--preview", "--apply"])).toThrow(/only one of --dry-run, --apply, or --preview/);
    expect(() => parseBackfillMode(["--preview", "--dry-run"])).toThrow(/only one of --dry-run, --apply, or --preview/);
    expect(() => parseBackfillMode(["--preview", "--apply", "--dry-run"])).toThrow(/only one of --dry-run, --apply, or --preview/);
    expect(() => parseBackfillMode(["--dry-run", "--apply"])).toThrow(/only one of --dry-run, --apply, or --preview/);
  });
});

describe("planWonBackfill", () => {
  const clients = Array.from({ length: 12 }, (_, i) => client(i + 1));
  const leads: BackfillLead[] = [
    leadRow(1, { email: "c1@example.com", businessName: "Client 1" }),
    leadRow(2, { businessName: "Client 2" }),
    leadRow(3, { stage: "won", clientId: cid(3) }),
    leadRow(4, { stage: "in_discussion", clientId: cid(4) }),
    leadRow(5, { email: "c5@example.com" }),
    leadRow(6, { email: "c5@example.com" }),
    leadRow(7, { stage: "won", businessName: "Brand New", email: "new@example.com" }),
  ];

  function apply(plan: WonBackfillPlan, rows: BackfillLead[], people: BackfillClient[]): { leads: BackfillLead[]; clients: BackfillClient[] } {
    const nextLeads = rows.map((l) => ({ ...l }));
    const nextClients = people.map((c) => ({ ...c }));
    let created = 0;
    for (const action of plan.actions) {
      if (action.op !== "link" && action.op !== "mark_won" && action.op !== "create_client") continue;
      const row = nextLeads.find((l) => l.id === action.leadId);
      if (!row) continue;
      if (action.op === "create_client") {
        created += 1;
        const id = cid(50 + created);
        nextClients.push({ id, businessName: row.businessName, email: row.email ?? "no-email", contactName: row.name, archived: false, paying: false });
        row.clientId = id;
        row.stage = "won";
        continue;
      }
      row.clientId = action.clientId;
      if (action.op === "mark_won" || action.markWon) row.stage = "won";
    }
    return { leads: nextLeads, clients: nextClients };
  }

  it("covers 12 paying clients and only writes a link, a won mark, or one new client", () => {
    const plan = planWonBackfill(leads, clients);
    expect(plan.payingCount).toBe(12);
    expect(plan.actions.filter((a) => a.op === "link").map((a) => a.op)).toHaveLength(2);
    expect(plan.actions.some((a) => a.op === "mark_won" && a.clientId === cid(4))).toBe(true);
    expect(plan.actions.some((a) => a.op === "already" && a.clientId === cid(3))).toBe(true);
    expect(plan.actions.some((a) => a.op === "ambiguous" && a.clientId === cid(5))).toBe(true);
    expect(plan.actions.filter((a) => a.op === "create_client")).toHaveLength(1);
    expect(plan.actions.filter((a) => a.op === "unmatched_client")).toHaveLength(7);
  });

  it("is idempotent: applying the plan leaves nothing further to write", () => {
    const first = planWonBackfill(leads, clients);
    const applied = apply(first, leads, clients);
    const second = planWonBackfill(applied.leads, applied.clients);
    expect(second.actions.some((a) => a.op === "link" || a.op === "mark_won" || a.op === "create_client")).toBe(false);
    expect(second.payingCount).toBe(12);
  });
});
