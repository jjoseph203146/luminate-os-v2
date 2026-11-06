// Growth domain: the lead pipeline. The owner adds, edits, re-stages and deletes leads; the website form adds them too.
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { toLocalDate } from "@/platform/calendar/business-days";
import { createAdminClient, readDb } from "@/platform/db/server";
import { writeAudit } from "@/platform/audit/audit";
import { RateLimitError, RuleError, ValidationError } from "@/platform/errors";
import { parseInput } from "@/platform/auth/schemas";
import { createRateLimiter } from "@/platform/security/rate-limit";
import { getCalendar } from "@/domains/admin/service";
import { changedLeadFields, dueNow, statusOf, summarize, type LeadFields } from "./rules";
import { createLeadSchema, deleteLeadSchema, leadFollowUpSchema, leadStageSchema, updateLeadSchema } from "./schemas";
import { leadInputFromRaw, WEBSITE_SOURCE } from "./intake";
import * as repo from "./repo";
import type { GrowthOverview, SavedLead, Stage } from "./types";

type Owner = Extract<Actor, { type: "owner" }>;

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
const writeLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });

function checkRate(actor: Owner, now: Date): void {
  if (!writeLimiter.check(actor.userId, now.getTime())) throw new RateLimitError("Too many changes at once. Wait a minute and try again.");
}

const NOT_FOUND = "That lead could not be found. It may have been deleted.";

/** Adds a lead by hand. New leads start at "New lead". */
export async function createLead(actor: Owner, raw: unknown, now: Date = new Date()): Promise<SavedLead> {
  assertCan(actor, "growth.write");
  const input = parseInput(createLeadSchema, raw);
  checkRate(actor, now);
  const db = await readDb(actor);

  const existing = await repo.findRecentLeadId(db, { ...input, since: new Date(now.getTime() - MANUAL_DUPLICATE_WINDOW_MS) });
  if (existing) return { id: existing, duplicate: true };

  const stage: Stage = "new_lead";
  const id = await repo.insertManualLead(db, input, statusOf(stage));
  // Contact details stay out of the audit log; the lead row holds them.
  await writeAudit(actor, { action: "lead.created", entityType: "lead", entityId: id, after: { stage, source: input.source, hasValue: input.value !== null } });
  return { id, duplicate: false };
}

/** Saves the lead's details. Returns the NAMES of the fields that changed (empty when nothing did). */
export async function updateLead(actor: Owner, raw: unknown, now: Date = new Date()): Promise<{ changed: (keyof LeadFields)[] }> {
  assertCan(actor, "growth.write");
  const { id, ...fields } = parseInput(updateLeadSchema, raw);
  checkRate(actor, now);
  const db = await readDb(actor);
  const before = await repo.getLead(db, id);
  if (!before) throw new RuleError(NOT_FOUND);
  const changed = changedLeadFields(before, fields);
  if (changed.length === 0) return { changed };
  const patch = Object.fromEntries(changed.map((k) => [k, fields[k]])) as Partial<LeadFields>;
  if (!(await repo.updateLead(db, id, patch))) throw new RuleError(NOT_FOUND);
  await writeAudit(actor, { action: "lead.updated", entityType: "lead", entityId: id, after: { changed } });
  return { changed };
}

/** Moves a lead to another stage. Saves the old app's status value, which is what the database accepts. */
export async function setLeadStage(actor: Owner, raw: unknown, now: Date = new Date()): Promise<{ stage: Stage; changed: boolean }> {
  assertCan(actor, "growth.write");
  const { id, stage } = parseInput(leadStageSchema, raw);
  checkRate(actor, now);
  const db = await readDb(actor);
  const before = await repo.getLead(db, id);
  if (!before) throw new RuleError(NOT_FOUND);
  if (before.stage === stage) return { stage, changed: false };
  if (!(await repo.setLeadStatus(db, id, statusOf(stage)))) throw new RuleError(NOT_FOUND);
  await writeAudit(actor, { action: "lead.stage_changed", entityType: "lead", entityId: id, before: { stage: before.stage }, after: { stage } });
  return { stage, changed: true };
}

/** Sets or clears the follow-up date. */
export async function setLeadFollowUp(actor: Owner, raw: unknown, now: Date = new Date()): Promise<{ followUpDate: string | null; changed: boolean }> {
  assertCan(actor, "growth.write");
  const { id, followUpDate } = parseInput(leadFollowUpSchema, raw);
  checkRate(actor, now);
  const db = await readDb(actor);
  const before = await repo.getLead(db, id);
  if (!before) throw new RuleError(NOT_FOUND);
  if (before.followUpDate === followUpDate) return { followUpDate, changed: false };
  if (!(await repo.updateLead(db, id, { followUpDate }))) throw new RuleError(NOT_FOUND);
  await writeAudit(actor, { action: "lead.updated", entityType: "lead", entityId: id, after: { changed: ["followUpDate"] } });
  return { followUpDate, changed: true };
}

/** Deletes a lead for good (the old app allowed this too). The form must carry a ticked confirmation box. */
export async function deleteLead(actor: Owner, raw: unknown, now: Date = new Date()): Promise<void> {
  assertCan(actor, "growth.write");
  const { id } = parseInput(deleteLeadSchema, raw);
  checkRate(actor, now);
  const db = await readDb(actor);
  const before = await repo.getLead(db, id);
  if (!before) throw new RuleError(NOT_FOUND);
  if (!(await repo.deleteLead(db, id))) throw new RuleError(NOT_FOUND);
  await writeAudit(actor, { action: "lead.deleted", entityType: "lead", entityId: id, before: { stage: before.stage } });
}

