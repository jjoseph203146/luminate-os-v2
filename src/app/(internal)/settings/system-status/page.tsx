import { Card, Heading } from "@/ui/forms";
import { Pill } from "@/ui/kit";
import { requireOwner } from "@/platform/auth/actor";
import { formatInTimeZone } from "@/platform/calendar/business-days";
import { getSystemStatus } from "@/domains/admin/service";
import { WEEKDAY_NAMES } from "@/domains/admin/rules";

export const metadata = { title: "System status" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line px-4 py-3 first:border-t-0 md:flex-row md:items-baseline md:gap-4">
      <div className="text-[13px] font-medium text-dim md:w-[220px] md:flex-none">{label}</div>
      <div className="min-w-0 flex-1 break-words text-[14px]">{children}</div>
    </div>
  );
}

export default async function SystemStatusPage() {
  const actor = await requireOwner();
  const s = await getSystemStatus(actor);
  const hb = s.heartbeat;
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13px] text-dim">Names and yes/no only. Secret values are never shown.</p>
      <Card className="overflow-hidden">
        <Row label="Environment"><span className="font-mono">{s.appEnv}</span></Row>
        <Row label="Database">
          <Pill tone={s.databaseReachable ? "green" : "red"}>{s.databaseReachable ? "Reachable" : "Not reachable"}</Pill>
        </Row>
        <Row label="Two-step verification">
          {s.mfaRequired ? "Required (switch on)" : "Off (switch off). Set AUTH_REQUIRE_MFA=true to require it."}
        </Row>
        <Row label="Scheduler heartbeat">
          {!hb
            ? "Unavailable"
            : hb.freshness === "never"
              ? "Never ran. Check CRON_SECRET and that the scheduler calls /api/jobs/tick."
              : `${hb.freshness === "ok" ? "On schedule" : "STALE"}, last run ${hb.lastRunAt ? formatInTimeZone(hb.lastRunAt, s.timeZone) : "unknown"} (every ${hb.intervalMinutes} minutes)`}
        </Row>
        <Row label="Failed job runs, last 24 hours"><span className="font-mono">{s.failedRunsLast24h}</span></Row>
        <Row label="Business calendar">
          {s.calendar
            ? `${s.calendar.timeZone}; working days: ${s.calendar.workingDays.map((d) => WEEKDAY_NAMES[d]).join(", ")}; ${s.calendar.holidayCount} holiday(s) entered${s.calendar.holidayCount === 0 ? " (unconfirmed)" : ""}`
            : "Unavailable"}
        </Row>
      </Card>

      <div>
        <Heading>Configuration</Heading>
        <Card className="overflow-hidden">
          {s.envChecks.map((c) => (
            <div key={c.name} className="flex min-h-[48px] items-center gap-3 border-t border-line px-4 py-2 first:border-t-0">
              <code className="min-w-0 flex-1 break-all font-mono text-[13px]">{c.name}</code>
              <span className="text-[12px] text-dim">{c.required ? "Needed" : "Optional"}</span>
              <Pill tone={c.present ? "green" : c.required ? "red" : "gray"}>{c.present ? "Set" : "Not set"}</Pill>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
