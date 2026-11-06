// Alerts domain: tells the owner about money and client activity that the old app records.
// The old app still receives Stripe's events and the client portal's requests; this job only reads what it
// wrote, so no webhook or portal moves. One owner per job (CLAUDE.md): this job sends; it never writes business data.
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { createAdminClient } from "@/platform/db/server";
import { notifyOwner } from "@/domains/notifications/service";
import { noticeKey, paymentKey, planActivityAlerts, WINDOW_DAYS } from "./rules";
import * as repo from "./repo";

export interface ActivityRunSummary {
  payments: number;
  notices: number;
  planned: number;
  sent: number;
  held: number;
}

const unique = (ids: (string | null)[]) => [...new Set(ids.filter((v): v is string => v !== null))];

/**
 * The scheduled job. Sends each planned alert, then remembers it so it is announced once.
 * If a push could not be delivered the state is not saved, the run stops, and the next run retries from that alert. If push is not set up or
 * no device is registered, the state is saved anyway so old news does not flood in when a phone is added later.
 */
export async function runActivityAlerts(actor: Actor, now: Date = new Date()): Promise<ActivityRunSummary> {
  assertCan(actor, "alerts.run");
  const db = createAdminClient();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

  const [payments, notices] = await Promise.all([repo.listRecentPayments(db, since), repo.listRecentNotices(db, since)]);
  const previous = await repo.listAlertState(db, [...payments.map((p) => paymentKey(p.id)), ...notices.map((n) => noticeKey(n.id))]);
  const [clients, requests] = await Promise.all([
    repo.listClients(db, unique([...payments.map((p) => p.clientId), ...notices.map((n) => n.clientId)])),
    repo.listRequests(db, unique(notices.map((n) => n.requestId))),
  ]);

  const plan = planActivityAlerts(
    {
      payments,
      notices,
      clients: Object.fromEntries(clients.map((c) => [c.id, c])),
      requests: Object.fromEntries(requests.map((r) => [r.id, r])),
      previous,
    },
    now,
  );

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
      // The push channel is failing. Stop here instead of trying (and failing) with every remaining alert:
      // this one is retried first next run, and newer ones wait their turn behind it.
      held += 1;
      break;
    }
  }
  return { payments: payments.length, notices: notices.length, planned: plan.length, sent, held };
}
