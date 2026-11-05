// Monitoring domain: shows what the site checker found, and sends alerts about it.
// The checks themselves still run in the old app; this domain only reads them.
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { createAdminClient, createUserClient } from "@/platform/db/server";
import { getCalendar } from "@/domains/admin/service";
import { notifyOwner } from "@/domains/notifications/service";
import { planAlerts } from "./rules";
import * as repo from "./repo";
import type { MonitoringOverview } from "./types";

export async function getMonitoringOverview(actor: Actor): Promise<MonitoringOverview> {
  assertCan(actor, "monitoring.read");
  const db = await createUserClient();
  const [sites, issues, calendar] = await Promise.all([repo.listSites(db), repo.listOpenIssues(db), getCalendar(actor)]);
  return { sites, issues, timeZone: calendar.timeZone, asOf: new Date().toISOString() };
}

export interface AlertRunSummary {
  sites: number;
  planned: number;
  sent: number;
  held: number;
}

/**
 * The scheduled alert job. Sends each planned alert, then remembers it so the same problem is not
 * announced again. If a push could not be delivered, the state is not saved and the next run retries.
 * If push is not set up or no device is registered, the state is saved anyway so old news does not
 * flood in when a phone is added later.
 */
export async function runMonitorAlerts(actor: Actor, now: Date = new Date()): Promise<AlertRunSummary> {
  assertCan(actor, "monitoring.read");
  const db = createAdminClient();
  const [sites, previous] = await Promise.all([repo.listSites(db), repo.listAlertState(db)]);
  const plan = planAlerts(sites, previous, now);
  let sent = 0;
  let held = 0;
  for (const alert of plan) {
    if (!alert.payload) {
      await repo.saveAlertState(db, alert.key, alert.state, null);
      continue;
    }
    const result = await notifyOwner(actor, alert.payload);
    const delivered = result.sent > 0;
    const nothingToSendTo = result.skipped === "not_configured" || result.skipped === "no_devices";
    if (delivered || nothingToSendTo) {
      await repo.saveAlertState(db, alert.key, alert.state, delivered ? now : null);
      if (delivered) sent += 1;
    } else {
      held += 1;
    }
  }
  return { sites: sites.length, planned: plan.length, sent, held };
}
