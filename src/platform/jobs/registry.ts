import { runActivityAlerts } from "@/domains/alerts/service";
import { runMonitorAlerts } from "@/domains/monitoring/service";
import type { JobHandler } from "./runner";

// One handler per row in the jobs table. Business jobs arrive in later phases.
export const handlers: Record<string, JobHandler> = {
  // Does no business work. Its recent runs prove the scheduler is calling the app.
  heartbeat: async ({ now }) => ({ ok: true, at: now.toISOString() }),
  // Reads the old app's site checks and pushes an alert when something needs attention.
  monitor_alerts: async ({ now }) => ({ ...(await runMonitorAlerts({ type: "system", name: "monitor_alerts" }, now)) }),
  // Tells the owner about payments and client requests and comments that the old app recorded.
  activity_alerts: async ({ now }) => ({ ...(await runActivityAlerts({ type: "system", name: "activity_alerts" }, now)) }),
};
