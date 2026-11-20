// Owner dashboard. Read only: no Stripe, no writes, no audit rows.
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { toLocalDate } from "@/platform/calendar/business-days";
import { readDb } from "@/platform/db/server";
import { getCalendar } from "@/domains/admin/service";
import { buildOwnerDashboard } from "./rules";
import { loadDashboard } from "./repo";
import type { OwnerDashboard } from "./types";

export async function getOwnerDashboard(actor: Actor, now: Date = new Date()): Promise<OwnerDashboard> {
  assertCan(actor, "dashboard.read");
  const [calendar, loaded] = await Promise.all([getCalendar(actor), readDb(actor).then(loadDashboard)]);
  const today = toLocalDate(now, calendar.timeZone);
  return buildOwnerDashboard({ ...loaded, today, timeZone: calendar.timeZone, generatedAt: now.toISOString() });
}
