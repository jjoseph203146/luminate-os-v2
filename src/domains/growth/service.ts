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
import { changedLeadFields, dueNow, statusOf, summarize, type LeadFields } from "./rules";
import { createLeadSchema, deleteLeadSchema, leadFollowUpSchema, leadStageSchema, patchLeadSchema, updateLeadSchema } from "./schemas";
import { leadInputFromRaw, WEBSITE_SOURCE } from "./intake";
import * as repo from "./repo";
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
  const patch = Object.fromEntries(changed.map((k) => [k, fields[k]])) as Partial<LeadFields>;
  if (!(await repo.updateLead(db, id, patch))) throw new RuleError(NOT_FOUND);
  await writeAudit(actor, { action: "lead.updated", entityType: "lead", entityId: id, after: stampActor(actor, { changed }) });
  return { changed };
}

/**
 * Changes only the fields that were sent. The bot write API uses this: the read-only connector
 * does not return emails, phones or notes, so a full-form update would wipe them.
 */
export async function patchLead(actor: Actor, raw: unknown, now: Date = new Date()): Promise<{ id: string; changed: string[] }> {
  assertLeadWriter(actor);
  const input = parseInput(patchLeadSchema, raw);
  checkRate(actor, now);
  const db = await leadDb(actor);
  const before = await repo.getLead(db, input.id);
  if (!before) throw new RuleError(NOT_FOUND);

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
  const fields = changedLeadFields(before, merged);
  if (fields.length > 0) {
    const patch = Object.fromEntries(fields.map((k) => [k, merged[k]])) as Partial<LeadFields>;
    if (!(await repo.updateLead(db, input.id, patch))) throw new RuleError(NOT_FOUND);
    await writeAudit(actor, { action: "lead.updated", entityType: "lead", entityId: input.id, after: stampActor(actor, { changed: fields }) });
    changed.push(...fields);
  }

  if (input.stage !== undefined && input.stage !== before.stage) {
    if (!(await repo.setLeadStatus(db, input.id, statusOf(input.stage)))) throw new RuleError(NOT_FOUND);
    await writeAudit(actor, {
      action: "lead.stage_changed",
      entityType: "lead",
      entityId: input.id,
      before: { stage: before.stage },
      after: stampActor(actor, { stage: input.stage }),
    });
    changed.push("stage");
  }
  return { id: input.id, changed };
}

/** Moves a lead to another stage. Saves the old app's status value, which is what the database accepts. */
export async function setLeadStage(actor: Actor, raw: unknown, now: Date = new Date()): Promise<{ stage: Stage; changed: boolean }> {
  assertLeadWriter(actor);
  const { id, stage } = parseInput(leadStageSchema, raw);
  checkRate(actor, now);
  const db = await leadDb(actor);
  const before = await repo.getLead(db, id);
  if (!before) throw new RuleError(NOT_FOUND);
  if (before.stage === stage) return { stage, changed: false };
  if (!(await repo.setLeadStatus(db, id, statusOf(stage)))) throw new RuleError(NOT_FOUND);
  await writeAudit(actor, { action: "lead.stage_changed", entityType: "lead", entityId: id, before: { stage: before.stage }, after: stampActor(actor, { stage }) });
  return { stage, changed: true };
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

