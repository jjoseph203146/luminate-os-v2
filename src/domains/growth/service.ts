// Growth domain: the lead pipeline. Read-only in M1.
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { toLocalDate } from "@/platform/calendar/business-days";
import { createAdminClient, readDb } from "@/platform/db/server";
import { writeAudit } from "@/platform/audit/audit";
import { RateLimitError, ValidationError } from "@/platform/errors";
import { getCalendar } from "@/domains/admin/service";
import { dueNow, summarize } from "./rules";
import { leadInputFromRaw, WEBSITE_SOURCE } from "./intake";
import * as repo from "./repo";
import type { GrowthOverview } from "./types";

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
