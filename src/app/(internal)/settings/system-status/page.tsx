import { requireOwner } from "@/platform/auth/actor";
import { formatInTimeZone } from "@/platform/calendar/business-days";
import { getSystemStatus } from "@/domains/admin/service";
import { WEEKDAY_NAMES } from "@/domains/admin/rules";

export const metadata = { title: "System status" };

export default async function SystemStatusPage() {
  const actor = await requireOwner();
  const s = await getSystemStatus(actor);
  const hb = s.heartbeat;
  return (
    <section>
      <h1>System status</h1>
      <p>Names and yes/no only. Secret values are never shown.</p>
      <table>
        <tbody>
          <tr><th>Environment</th><td>{s.appEnv}</td></tr>
          <tr><th>Database</th><td>{s.databaseReachable ? "Reachable" : "Not reachable"}</td></tr>
          <tr>
            <th>Two-step verification</th>
            <td>{s.mfaRequired ? "Required" : "Not required"}{s.appEnv === "production" ? " (always required in production)" : s.mfaSwitch ? " (switch on)" : " (switch off; must be on before production)"}</td>
          </tr>
          <tr>
            <th>Scheduler heartbeat</th>
            <td>
              {!hb
                ? "Unavailable"
                : hb.freshness === "never"
                  ? "Never ran. Check CRON_SECRET and that the scheduler calls /api/jobs/tick."
                  : `${hb.freshness === "ok" ? "On schedule" : "STALE"}, last run ${hb.lastRunAt ? formatInTimeZone(hb.lastRunAt, s.timeZone) : "unknown"} (every ${hb.intervalMinutes} minutes)`}
            </td>
          </tr>
          <tr><th>Failed job runs, last 24 hours</th><td>{s.failedRunsLast24h}</td></tr>
          <tr>
            <th>Business calendar</th>
            <td>
              {s.calendar
                ? `${s.calendar.timeZone}; working days: ${s.calendar.workingDays.map((d) => WEEKDAY_NAMES[d]).join(", ")}; ${s.calendar.holidayCount} holiday(s) entered${s.calendar.holidayCount === 0 ? " (unconfirmed)" : ""}`
                : "Unavailable"}
            </td>
          </tr>
        </tbody>
      </table>
      <h2>Configuration</h2>
      <table>
        <thead><tr><th>Variable</th><th>Needed</th><th>Set</th></tr></thead>
        <tbody>
          {s.envChecks.map((c) => (
            <tr key={c.name}>
              <td><code>{c.name}</code></td>
              <td>{c.required ? "Yes" : "Optional"}</td>
              <td>{c.present ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
