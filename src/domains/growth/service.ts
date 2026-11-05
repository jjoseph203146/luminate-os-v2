// Growth domain: the lead pipeline. Read-only in M1.
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { toLocalDate } from "@/platform/calendar/business-days";
import { createUserClient } from "@/platform/db/server";
import { getCalendar } from "@/domains/admin/service";
import { dueNow, summarize } from "./rules";
import * as repo from "./repo";
import type { GrowthOverview } from "./types";

export async function getGrowthOverview(actor: Actor): Promise<GrowthOverview> {
  assertCan(actor, "growth.read");
  const { timeZone } = await getCalendar(actor);
  const today = toLocalDate(new Date(), timeZone);
  const leads = await repo.listLeads(await createUserClient());
  return { today, leads, summary: summarize(leads, today), dueNow: dueNow(leads, today) };
}
