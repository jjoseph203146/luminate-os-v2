import { ActionForm } from "@/ui/ActionForm";
import { BTN_SMALL, Banner, Card, Heading } from "@/ui/forms";
import { Icon } from "@/ui/Icon";
import { Pill } from "@/ui/kit";
import { requireOwner } from "@/platform/auth/actor";
import { formatInTimeZone } from "@/platform/calendar/business-days";
import { listJobs, listRuns } from "@/domains/automation/service";
import { runJobNowAction } from "../settings/actions";

export const metadata = { title: "Automations" };

function runTone(status: string): "green" | "red" | "amber" | "gray" {
  if (status === "succeeded" || status === "success" || status === "ok") return "green";
  if (status === "failed" || status === "error") return "red";
  if (status === "running" || status === "retrying") return "amber";
  return "gray";
}

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const actor = await requireOwner();
  const { job } = await searchParams;
  const [jobs, history] = await Promise.all([listJobs(actor), listRuns(actor, { jobKey: job ?? null })]);
  return (
    <>
      <Banner tone="amber" icon={<Icon name="info" size={18} />}>
        These are the system jobs. Business jobs (follow-ups, care cycles, reminders) arrive in later phases, along with Off and Dry-run modes.
      </Banner>

      <section>
        <Heading>Jobs</Heading>
        <Card className="overflow-hidden">
          {jobs.map((j) => (
            <div key={j.key} className="flex flex-col gap-2 border-t border-line px-3.5 py-3 first:border-t-0 md:flex-row md:items-center md:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-medium">{j.name}</span>
                  <Pill tone={j.freshness === "ok" ? "green" : j.freshness === "stale" ? "red" : "gray"}>
                    {j.freshness === "ok" ? "On schedule" : j.freshness === "stale" ? "Stale" : "Never ran"}
                  </Pill>
                  {!j.enabled && <Pill tone="gray">Disabled</Pill>}
                </div>
                <div className="mt-0.5 text-[13px] text-dim">{j.description}</div>
                <div className="mt-1 font-mono text-[12px] text-dim">
                  every {j.intervalMinutes} min · last success {j.lastRunAt ? formatInTimeZone(j.lastRunAt, history.timeZone) : "never"}
                </div>
              </div>
              <ActionForm action={runJobNowAction} submitLabel="Run now" buttonClassName={BTN_SMALL}>
                <input type="hidden" name="jobKey" value={j.key} />
              </ActionForm>
            </div>
          ))}
        </Card>
      </section>

      <section>
        <Heading>Recent runs{job ? ` for ${job}` : ""}</Heading>
        {history.runs.length === 0 ? (
          <Card className="px-4 py-6 text-center text-[13px] text-dim">No runs yet.</Card>
        ) : (
          <Card className="overflow-hidden">
            {history.runs.map((r) => (
              <div key={r.id} className="border-t border-line px-3.5 py-2.5 first:border-t-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium">{r.jobKey}</span>
                  <Pill tone={runTone(r.status)}>{r.status}</Pill>
                </div>
                <div className="mt-1 font-mono text-[12px] text-dim">
                  {formatInTimeZone(r.startedAt, history.timeZone)}
                  {r.finishedAt ? ` → ${formatInTimeZone(r.finishedAt, history.timeZone)}` : ""} · {r.attempts} attempt{r.attempts === 1 ? "" : "s"} · {r.triggerSource}
                </div>
                {r.error && <div className="mt-1 break-words text-[12px] text-red">{r.error}</div>}
              </div>
            ))}
          </Card>
        )}
      </section>
    </>
  );
}
