// Today domain: the single entry point for the daily starting screen. Read-only.
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { addCalendarDays, toLocalDate } from "@/platform/calendar/business-days";
import { createUserClient } from "@/platform/db/server";
import { getCalendar } from "@/domains/admin/service";
import { ATTENTION_LIMIT, buildAttention, buildRevenue, buildTodos, buildWaiting } from "./rules";
import { loadTodayInputs } from "./repo";
import type { TodayData } from "./types";

export async function getToday(actor: Actor): Promise<TodayData> {
  assertCan(actor, "clients.read");
  assertCan(actor, "work.read");
  const now = new Date();
  const { timeZone } = await getCalendar(actor);
  const today = toLocalDate(now, timeZone);
  const since = new Date(`${addCalendarDays(today, -62)}T00:00:00Z`).toISOString();
  const db = await createUserClient();
  const input = await loadTodayInputs(db, since);
  const attention = buildAttention(input, today, now, timeZone);
  return {
    today,
    timeZone,
    attention: attention.slice(0, ATTENTION_LIMIT),
    attentionTotal: attention.length,
    todos: buildTodos(input.tasks, today),
    waiting: buildWaiting(input),
    revenue: buildRevenue(input.clients, input.payments, today, timeZone),
    generatedAt: now.toISOString(),
  };
}
