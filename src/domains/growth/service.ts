// Growth domain: the lead pipeline. The owner adds, edits, re-stages and deletes leads; the website form adds them too.
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { toLocalDate } from "@/platform/calendar/business-days";
import { createAdminClient, readDb } from "@/platform/db/server";
import { writeAudit } from "@/platform/audit/audit";
import { PermissionError, RateLimitError, RuleError, ValidationError } from "@/platform/errors";
import { parseInput } from "@/platform/auth/schemas";
import { createRateLimiter } from "@/platform/security/rate-limit";
import { stampActor } from "@/platform/audit/stamp";
import { getCalendar } from "@/domains/admin/service";
import {
  assertBackfillEnvironment,
  changedLeadFields,
  clientFromLead,
  decideClientLink,
  dueNow,
  isPayingClient,
  planWonBackfill,
  STAGE_LABEL,
  statusOf,
  summarize,
  type ClientLinkDecision,
  type LeadFields,
  type WonBackfillAction,
  type WonBackfillPlan,
} from "./rules";
import { createLeadSchema, deleteLeadSchema, leadFollowUpSchema, leadStageSchema, patchLeadSchema, updateLeadSchema } from "./schemas";
import { leadInputFromRaw, WEBSITE_SOURCE } from "./intake";
import * as repo from "./repo";
import { PipelineNotReadyError } from "./repo";
import type { GrowthOverview, SavedLead, Stage } from "./types";

type LeadWriter = Extract<Actor, { type: "owner" | "bot" }>;

export async function getGrowthOverview(actor: Actor): Promise<GrowthOverview> {
  assertCan(actor, "growth.read");
  const { timeZone } = await getCalendar(actor);
  const today = toLocalDate(new Date(), timeZone);
  const leads = await repo.listLeads(await readDb(actor));
  return { today, leads, summary: summarize(leads, today), dueNow: dueNow(leads, today) };
}

/** At most this many website leads in an hour; beyond it the form is treated as under attack. */
export const WEBSITE_LEADS_PER_HOUR = 30;
const DUPLICATE_WINDOW_MS = 10 * 60_000;

export interface WebsiteLeadResult {
  id: string | null;
  /** True when the same person just sent the same form: nothing new was saved. */
  duplicate: boolean;
  lead: { name: string; businessName: string; email: string; phone: string; notes: string };
}

/** Saves a lead sent from the public contact form on the marketing site. Callable by the system only. */
export async function createWebsiteLead(actor: Actor, raw: Record<string, unknown>, now: Date = new Date()): Promise<WebsiteLeadResult> {
  assertCan(actor, "growth.intake");
  const parsed = leadInputFromRaw(raw);
  if (!parsed.ok) throw new ValidationError(parsed.issues);
  const lead = parsed.value;
  const db = createAdminClient();

  if ((await repo.countSourceSince(db, WEBSITE_SOURCE, new Date(now.getTime() - 3_600_000))) >= WEBSITE_LEADS_PER_HOUR) {
    throw new RateLimitError("The form is busy right now. Please email us instead.");
  }
  if (await repo.findRecentDuplicate(db, { name: lead.name, email: lead.email, phone: lead.phone, since: new Date(now.getTime() - DUPLICATE_WINDOW_MS) })) {
    return { id: null, duplicate: true, lead };
  }
  const id = await repo.insertLead(db, { ...lead, source: WEBSITE_SOURCE });
  // Contact details stay out of the audit log; the lead row holds them.
  await writeAudit(actor, { action: "lead.created_from_website", entityType: "lead", entityId: id, after: { name: lead.name, businessName: lead.businessName, source: WEBSITE_SOURCE } });
  return { id, duplicate: false, lead };
}

// --- Leads added and edited by hand ----------------------------------------------

/** A double tap or retry within this window returns the lead already saved (same as the request form). */
export const MANUAL_DUPLICATE_WINDOW_MS = 2 * 60_000;
/** At most this many lead changes a minute, so a stuck button cannot flood the table or the audit log. */
const ownerWriteLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });
/** A bot batch can change several leads at once. Still capped, per bot name. */
const botWriteLimiter = createRateLimiter({ max: 120, windowMs: 60_000 });

function assertLeadWriter(actor: Actor): asserts actor is LeadWriter {
  assertCan(actor, "leads.write");
  if (actor.type !== "owner" && actor.type !== "bot") throw new PermissionError();
}

function checkRate(actor: LeadWriter, now: Date): void {
  const limiter = actor.type === "bot" ? botWriteLimiter : ownerWriteLimiter;
  const key = actor.type === "owner" ? actor.userId : actor.name;
  if (!limiter.check(key, now.getTime())) throw new RateLimitError("Too many changes at once. Wait a minute and try again.");
}

/** The owner writes through row-level security. A bot has no session, so it uses the service role after the permission check. */
async function leadDb(actor: LeadWriter) {
  return actor.type === "owner" ? readDb(actor) : createAdminClient();
}

const NOT_FOUND = "That lead could not be found. It may have been deleted.";
const MIGRATION_NEEDED = "Apply migration 0011 before saving this.";
const NOTES_MIGRATION_NEEDED = "Apply migration 0011 before replacing notes. The previous text is still there.";

function migrationOrThrow(error: unknown): never {
  if (error instanceof PipelineNotReadyError) throw new RuleError(MIGRATION_NEEDED);
  throw error;
}

function activityActor(actor: { type: string; name?: string }): { actorType: string; actorName: string | null } {
  if ((actor.type === "bot" || actor.type === "system") && actor.name) return { actorType: actor.type, actorName: actor.name };
  return { actorType: actor.type, actorName: null };
}

/** Adds a lead by hand. New leads start at "New lead". */
export async function createLead(actor: Actor, raw: unknown, now: Date = new Date()): Promise<SavedLead> {
  assertLeadWriter(actor);
  const input = parseInput(createLeadSchema, raw);
  checkRate(actor, now);
  const db = await leadDb(actor);

  const existing = await repo.findRecentLeadId(db, { ...input, since: new Date(now.getTime() - MANUAL_DUPLICATE_WINDOW_MS) });
  if (existing) return { id: existing, duplicate: true };

  const stage: Stage = "new_lead";
  const id = await repo.insertManualLead(db, input, statusOf(stage));
  // Contact details stay out of the audit log; the lead row holds them.
  await writeAudit(actor, { action: "lead.created", entityType: "lead", entityId: id, after: stampActor(actor, { stage, source: input.source, hasValue: input.value !== null }) });
  return { id, duplicate: false };
}

/** Saves the lead's details. Returns the NAMES of the fields that changed (empty when nothing did). */
export async function updateLead(actor: Actor, raw: unknown, now: Date = new Date()): Promise<{ changed: (keyof LeadFields)[] }> {
  assertLeadWriter(actor);
  const { id, ...fields } = parseInput(updateLeadSchema, raw);
  checkRate(actor, now);
  const db = await leadDb(actor);
  const before = await repo.getLead(db, id);
  if (!before) throw new RuleError(NOT_FOUND);
  const changed = changedLeadFields(before, fields);
  if (changed.length === 0) return { changed };
  if (before.stage === "lost" && changed.includes("lostReason") && fields.lostReason === null) {
    throw new RuleError("A lost lead needs a reason.");
  }
  const patch = Object.fromEntries(changed.map((k) => [k, fields[k]])) as Partial<LeadFields>;
  const historyId = await rememberLeadNotes(db, actor, id, before.notes, patch);
  try {
    if (!(await repo.updateLead(db, id, patch))) throw new RuleError(NOT_FOUND);
  } catch (error) {
    migrationOrThrow(error);
  }
  await writeAudit(actor, { action: "lead.updated", entityType: "lead", entityId: id, after: stampActor(actor, noteAudit(changed, before.notes, historyId)) });
  return { changed };
}

/** When notes are replaced, keep the previous text in lead_activities before the row is overwritten. */
async function rememberLeadNotes(db: Awaited<ReturnType<typeof leadDb>>, actor: LeadWriter, leadId: string, previous: string | null, patch: Partial<LeadFields>): Promise<string | null> {
  if (!("notes" in patch) || patch.notes === previous || !previous) return null;
  const who = activityActor(actor);
  const saved = await repo.insertLeadActivity(db, {
    leadId,
    kind: "note",
    summary: "Notes replaced.",
    body: previous,
    actorType: who.actorType,
    actorName: who.actorName,
  });
  if (saved === "unavailable") throw new RuleError(NOTES_MIGRATION_NEEDED);
  return saved;
}

function noteAudit(changed: readonly string[], previous: string | null, historyId: string | null): Record<string, unknown> {
  const after: Record<string, unknown> = { changed };
  if (changed.includes("notes") && previous) {
    after.notesRevised = true;
    after.previousLength = previous.length;
    if (historyId) after.historyId = historyId;
  }
  return after;
}

/**
 * Changes only the fields that were sent. The bot write API uses this: the read-only connector
 * does not return emails, phones or notes, so a full-form update would wipe them.
 * `nextStep`, `nextStepOn`, `lostReason`, `lastTouchAt`, `kind` and `campaign` are included.
 * Moving to Won still requires a signed contract and a paid deposit, and links or creates a client.
 */
export async function patchLead(actor: Actor, raw: unknown, now: Date = new Date()): Promise<{ id: string; changed: string[] }> {
  assertLeadWriter(actor);
  const input = parseInput(patchLeadSchema, raw);
  checkRate(actor, now);
  const db = await leadDb(actor);
  const before = await repo.getLead(db, input.id);
  if (!before) throw new RuleError(NOT_FOUND);
  const resultingStage = input.stage ?? before.stage;
  if ((input.stage === "lost" || input.lostReason !== undefined) && resultingStage === "lost") {
    const reason = input.lostReason !== undefined ? input.lostReason : before.lostReason;
    if (!reason) throw new RuleError("A lost lead needs a reason.");
  }

  const changed: string[] = [];
  const merged: LeadFields = { ...before };
  if (input.name !== undefined) merged.name = input.name;
  if (input.businessName !== undefined) merged.businessName = input.businessName;
  if (input.email !== undefined) merged.email = input.email;
  if (input.phone !== undefined) merged.phone = input.phone;
  if (input.notes !== undefined) merged.notes = input.notes;
  if (input.followUpDate !== undefined) merged.followUpDate = input.followUpDate;
  if (input.source !== undefined) merged.source = input.source;
  if (input.value !== undefined) merged.value = input.value;
  if (input.nextStep !== undefined) merged.nextStep = input.nextStep;
  if (input.nextStepOn !== undefined) merged.nextStepOn = input.nextStepOn;
  if (input.lostReason !== undefined) merged.lostReason = input.lostReason;
  if (input.kind !== undefined) merged.kind = input.kind;
  if (input.campaign !== undefined) merged.campaign = input.campaign;
  const fields = changedLeadFields(before, merged);
  if (fields.length > 0) {
    const patch = Object.fromEntries(fields.map((k) => [k, merged[k]])) as Partial<LeadFields>;
    const historyId = await rememberLeadNotes(db, actor, input.id, before.notes, patch);
    try {
      if (!(await repo.updateLead(db, input.id, patch))) throw new RuleError(NOT_FOUND);
    } catch (error) {
      migrationOrThrow(error);
    }
    await writeAudit(actor, { action: "lead.updated", entityType: "lead", entityId: input.id, after: stampActor(actor, noteAudit(fields, before.notes, historyId)) });
    changed.push(...fields);
  }

  if (input.lastTouchAt !== undefined && input.lastTouchAt !== before.lastTouchAt) {
    await recordLastTouch(db, actor, input.id, input.lastTouchAt);
    changed.push("lastTouchAt");
  }

  if (input.stage !== undefined && (input.stage !== before.stage || (input.stage === "won" && !before.clientId))) {
    const moved = await changeStage(actor, db, { ...before, ...merged, clientId: before.clientId, stage: before.stage }, input.stage, {
      lostReason: input.lostReason !== undefined ? input.lostReason : merged.lostReason,
      clientId: input.clientId ?? null,
      now,
    });
    if (moved.changed || moved.client === "linked" || moved.client === "created") changed.push("stage");
  }
  return { id: input.id, changed };
}

export interface StageChange {
  stage: Stage;
  changed: boolean;
  client: "linked" | "created" | "kept" | null;
}

/** Moves a lead to another stage. Saves the old app's status value, which is what the database accepts. */
export async function setLeadStage(actor: Actor, raw: unknown, now: Date = new Date()): Promise<StageChange> {
  assertLeadWriter(actor);
  const input = parseInput(leadStageSchema, raw);
  checkRate(actor, now);
  const db = await leadDb(actor);
  const before = await repo.getLead(db, input.id);
  if (!before) throw new RuleError(NOT_FOUND);
  return changeStage(actor, db, before, input.stage, { lostReason: input.lostReason ?? null, clientId: input.clientId ?? null, now });
}

async function changeStage(
  actor: LeadWriter,
  db: Awaited<ReturnType<typeof leadDb>>,
  before: repo.StoredLead,
  stage: Stage,
  extras: { lostReason: LeadFields["lostReason"]; clientId: string | null; now: Date },
): Promise<StageChange> {
  if (stage === "lost") {
    const reason = extras.lostReason ?? before.lostReason;
    if (!reason) throw new RuleError("Pick a reason for marking the lead lost.");
    if (reason !== before.lostReason) {
      try {
        if (!(await repo.updateLead(db, before.id, { lostReason: reason }))) throw new RuleError(NOT_FOUND);
      } catch (error) {
        migrationOrThrow(error);
      }
      await writeAudit(actor, {
        action: "lead.updated",
        entityType: "lead",
        entityId: before.id,
        after: stampActor(actor, { changed: ["lostReason"], lostReason: reason }),
      });
      before = { ...before, lostReason: reason };
    }
  }

  let client: StageChange["client"] = null;
  if (stage === "won") {
    const linked = await linkWonLead(actor, db, { ...before, lostReason: extras.lostReason ?? before.lostReason }, extras.clientId);
    client = linked.client;
    before = { ...before, clientId: linked.clientId };
  }

  if (before.stage === stage) return { stage, changed: false, client };

  const saved = await repo.setLeadStatus(db, before.id, statusOf(stage), extras.now.toISOString());
  if (saved === "missing") throw new RuleError(NOT_FOUND);
  if (saved === "ok") {
    const who = activityActor(actor);
    await repo.insertLeadActivity(db, {
      leadId: before.id,
      kind: "stage",
      summary: stage === "won" ? "Moved to Won. Contract signed and deposit paid." : `Moved to ${STAGE_LABEL[stage]}.`,
      occurredAt: extras.now.toISOString(),
      actorType: who.actorType,
      actorName: who.actorName,
    });
  }
  await writeAudit(actor, {
    action: "lead.stage_changed",
    entityType: "lead",
    entityId: before.id,
    clientId: before.clientId,
    before: { stage: before.stage },
    after: stampActor(actor, { stage, client, stageChangedAt: saved === "ok" }),
  });
  return { stage, changed: true, client };
}

async function recordLastTouch(db: Awaited<ReturnType<typeof leadDb>>, actor: LeadWriter, leadId: string, at: string | null): Promise<void> {
  const who = activityActor(actor);
  if (at) {
    const saved = await repo.insertLeadActivity(db, {
      leadId,
      kind: "outreach",
      summary: "Last touch recorded.",
      occurredAt: at,
      actorType: who.actorType,
      actorName: who.actorName,
    });
    if (saved === "unavailable") throw new RuleError(MIGRATION_NEEDED);
  }
  try {
    // After the activity insert, so an explicit time wins over the trigger (including a clear).
    if (!(await repo.setLastTouch(db, leadId, at))) throw new RuleError(NOT_FOUND);
  } catch (error) {
    migrationOrThrow(error);
  }
  await writeAudit(actor, {
    action: "lead.updated",
    entityType: "lead",
    entityId: leadId,
    after: stampActor(actor, { changed: ["lastTouchAt"], cleared: at === null }),
  });
}

/**
 * Won means the contract is signed and the deposit is paid (the caller already checked that).
 * Links an existing client, or creates one. Does not create a project, an invoice, or a Stripe charge.
 */
async function linkWonLead(
  actor: LeadWriter,
  db: Awaited<ReturnType<typeof leadDb>>,
  lead: repo.StoredLead,
  chosenClientId: string | null,
): Promise<{ clientId: string; client: "linked" | "created" | "kept" }> {
  if (!(await repo.pipelineReady(db))) throw new RuleError(MIGRATION_NEEDED);
  if (lead.clientId) return { clientId: lead.clientId, client: "kept" };

  const candidates = await repo.listClientCandidates(db);
  let decision: ClientLinkDecision;
  let how: "email" | "business_name" | "chosen" = "email";
  if (chosenClientId) {
    if (!(await repo.clientExists(db, chosenClientId))) throw new RuleError("That client could not be found.");
    decision = { action: "link", clientId: chosenClientId, how: "email" };
    how = "chosen";
  } else {
    decision = decideClientLink(lead, candidates);
    if (decision.action === "link") how = decision.how;
  }
  if (decision.action === "ambiguous") {
    throw new RuleError("More than one client matches this lead. Enter the client id to link.");
  }
  if (decision.action === "keep") return { clientId: decision.clientId, client: "kept" };

  let clientId: string;
  let created = false;
  if (decision.action === "create") {
    const fields = clientFromLead(lead);
    clientId = await repo.insertClient(db, fields);
    created = true;
    const accountLinked = await ensureAccount(db, clientId, fields.business_name);
    await writeAudit(actor, {
      action: "client.created_from_lead",
      entityType: "client",
      entityId: clientId,
      clientId,
      after: stampActor(actor, { leadId: lead.id, accountLinked, status: "active" }),
    });
  } else {
    clientId = decision.clientId;
  }

  let linked = false;
  try {
    linked = await repo.setLeadClient(db, lead.id, clientId);
  } catch (error) {
    migrationOrThrow(error);
  }
  if (!linked) {
    const again = await repo.getLead(db, lead.id);
    if (again?.clientId) return { clientId: again.clientId, client: "kept" };
    throw new RuleError(NOT_FOUND);
  }
  await writeAudit(actor, {
    action: "lead.client_linked",
    entityType: "lead",
    entityId: lead.id,
    clientId,
    after: stampActor(actor, { created, how: created ? "created" : how }),
  });
  return { clientId, client: created ? "created" : "linked" };
}

/** Best effort, same as a client created from Stripe: an account row grouped under the client. */
async function ensureAccount(db: Awaited<ReturnType<typeof leadDb>>, clientId: string, name: string): Promise<boolean> {
  try {
    const accountId = await repo.insertAccount(db, name);
    const linked = await repo.linkAccount(db, clientId, accountId);
    if (!linked) await repo.deleteUnusedAccount(db, accountId);
    return linked;
  } catch {
    return false;
  }
}

/** Sets or clears the follow-up date. */
export async function setLeadFollowUp(actor: Actor, raw: unknown, now: Date = new Date()): Promise<{ followUpDate: string | null; changed: boolean }> {
  assertLeadWriter(actor);
  const { id, followUpDate } = parseInput(leadFollowUpSchema, raw);
  checkRate(actor, now);
  const db = await leadDb(actor);
  const before = await repo.getLead(db, id);
  if (!before) throw new RuleError(NOT_FOUND);
  if (before.followUpDate === followUpDate) return { followUpDate, changed: false };
  if (!(await repo.updateLead(db, id, { followUpDate }))) throw new RuleError(NOT_FOUND);
  await writeAudit(actor, { action: "lead.updated", entityType: "lead", entityId: id, after: stampActor(actor, { changed: ["followUpDate"] }) });
  return { followUpDate, changed: true };
}

/** Deletes a lead for good (the old app allowed this too). The form must carry a ticked confirmation box. Bots cannot delete. */
export async function deleteLead(actor: Actor, raw: unknown, now: Date = new Date()): Promise<void> {
  assertCan(actor, "growth.write");
  if (actor.type !== "owner") throw new PermissionError();
  const { id } = parseInput(deleteLeadSchema, raw);
  checkRate(actor, now);
  const db = await leadDb(actor);
  const before = await repo.getLead(db, id);
  if (!before) throw new RuleError(NOT_FOUND);
  if (!(await repo.deleteLead(db, id))) throw new RuleError(NOT_FOUND);
  await writeAudit(actor, { action: "lead.deleted", entityType: "lead", entityId: id, before: { stage: before.stage } });
}

const BACKFILL_ACTOR = "won-backfill";

export interface WonBackfillResult extends WonBackfillPlan {
  /** The APP_ENV the guard accepted. Never production. */
  target: "local" | "staging";
  apply: boolean;
  /** Writes that happened. Empty on a dry run. */
  applied: { op: string; leadId: string; clientId: string; created: boolean }[];
  /** Business names and ids so a dry run can be checked. No emails, phones, or notes. */
  roster: {
    clients: { id: string; businessName: string; paying: boolean; archived: boolean }[];
    leads: { id: string; businessName: string; stage: string; clientId: string | null }[];
  };
}

/**
 * Links or creates clients for paying clients and for Won leads that are not linked yet.
 * Dry-run (`apply: false`) reads and returns the plan. It writes nothing.
 * Refuses to run unless APP_ENV is local or staging, before it reads.
 * The bot cannot call this.
 */
export async function runWonBackfill(actor: Actor, options: { apply: boolean }, now: Date = new Date()): Promise<WonBackfillResult> {
  assertCan(actor, "growth.backfill");
  if (actor.type !== "owner" && !(actor.type === "system" && actor.name === BACKFILL_ACTOR)) throw new PermissionError();
  let target: "local" | "staging";
  try {
    target = assertBackfillEnvironment(process.env.APP_ENV);
  } catch (error) {
    throw new RuleError(error instanceof Error ? error.message : "Refusing to run the Won backfill.");
  }
  const db = createAdminClient();
  if (!(await repo.pipelineReady(db))) throw new RuleError(MIGRATION_NEEDED);
  const [clients, paid, leads] = await Promise.all([repo.listClientCandidates(db), repo.listPaidClientIds(db), repo.listLeadsForBackfill(db)]);
  const backfillClients = clients.map((c) => ({
    id: c.id,
    businessName: c.businessName,
    email: c.email,
    contactName: c.contactName,
    archived: c.archived,
    paying: isPayingClient({ archived: c.archived, lifetimeValue: c.lifetimeValue, paidRevenue: paid.has(c.id) }),
  }));
  const plan = planWonBackfill(leads, backfillClients);
  const roster: WonBackfillResult["roster"] = {
    clients: backfillClients.map((c) => ({ id: c.id, businessName: c.businessName, paying: c.paying, archived: c.archived })),
    leads: leads.map((l) => ({ id: l.id, businessName: l.businessName, stage: l.stage, clientId: l.clientId })),
  };
  if (!options.apply) return { ...plan, target, apply: false, applied: [], roster };

  const applied: WonBackfillResult["applied"] = [];
  for (const action of plan.actions) {
    const row = await applyBackfillAction(actor, db, action, leads, now);
    if (row) applied.push(row);
  }
  return { ...plan, target, apply: true, applied, roster };
}

async function applyBackfillAction(
  actor: Actor,
  db: ReturnType<typeof createAdminClient>,
  action: WonBackfillAction,
  leads: repo.BackfillLeadRow[],
  now: Date,
): Promise<WonBackfillResult["applied"][number] | null> {
  if (action.op === "already" || action.op === "ambiguous" || action.op === "ambiguous_lead" || action.op === "unmatched_client") return null;
  const lead = leads.find((l) => l.id === action.leadId);
  if (!lead) return null;
  const who = activityActor(actor);

  if (action.op === "create_client") {
    const fields = clientFromLead(lead);
    const clientId = await repo.insertClient(db, fields);
    const accountLinked = await ensureAccount(db, clientId, fields.business_name);
    const linked = await repo.setLeadClient(db, lead.id, clientId);
    if (!linked) {
      await writeAudit(actor, {
        action: "client.created_from_lead",
        entityType: "client",
        entityId: clientId,
        clientId,
        after: { backfill: BACKFILL_ACTOR, leadId: lead.id, linked: false, accountLinked },
      });
      return null;
    }
    await repo.insertLeadActivity(db, { leadId: lead.id, kind: "stage", summary: "Backfill created a client and linked this won lead.", actorType: who.actorType, actorName: who.actorName, occurredAt: now.toISOString() });
    await writeAudit(actor, {
      action: "lead.client_linked",
      entityType: "lead",
      entityId: lead.id,
      clientId,
      after: { backfill: BACKFILL_ACTOR, created: true, accountLinked },
    });
    return { op: action.op, leadId: lead.id, clientId, created: true };
  }

  if (action.op === "link") {
    const linked = await repo.setLeadClient(db, action.leadId, action.clientId);
    if (!linked) {
      const again = await repo.getLead(db, action.leadId);
      if (again?.clientId !== action.clientId) return null;
    }
    if (action.markWon) {
      const saved = await repo.setLeadStatus(db, action.leadId, statusOf("won"), now.toISOString());
      if (saved === "missing") return null;
    }
    await repo.insertLeadActivity(db, {
      leadId: action.leadId,
      kind: "stage",
      summary: action.markWon ? "Backfill marked this lead Won and linked the paying client." : "Backfill linked this won lead to a client.",
      actorType: who.actorType,
      actorName: who.actorName,
      occurredAt: now.toISOString(),
    });
    await writeAudit(actor, {
      action: "lead.client_linked",
      entityType: "lead",
      entityId: action.leadId,
      clientId: action.clientId,
      after: { backfill: BACKFILL_ACTOR, created: false, how: action.how, markWon: action.markWon },
    });
    return { op: action.op, leadId: action.leadId, clientId: action.clientId, created: false };
  }

  const saved = await repo.setLeadStatus(db, action.leadId, statusOf("won"), now.toISOString());
  if (saved === "missing") return null;
  await repo.insertLeadActivity(db, {
    leadId: action.leadId,
    kind: "stage",
    summary: "Backfill marked this linked lead Won.",
    actorType: who.actorType,
    actorName: who.actorName,
    occurredAt: now.toISOString(),
  });
  await writeAudit(actor, {
    action: "lead.stage_changed",
    entityType: "lead",
    entityId: action.leadId,
    clientId: action.clientId,
    before: { stage: lead.stage },
    after: { backfill: BACKFILL_ACTOR, stage: "won" },
  });
  return { op: action.op, leadId: action.leadId, clientId: action.clientId, created: false };
}

