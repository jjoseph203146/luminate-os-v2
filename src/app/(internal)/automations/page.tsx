import { ActionForm } from "@/ui/ActionForm";
import { requireOwner } from "@/platform/auth/actor";
import { formatInTimeZone } from "@/platform/calendar/business-days";
import { listJobs, listRuns } from "@/domains/automation/service";
import { runJobNowAction } from "../settings/actions";

export const metadata = { title: "Automations" };

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const actor = await requireOwner();
  const { job } = await searchParams;
  const [jobs, history] = await Promise.all([listJobs(actor), listRuns(actor, { jobKey: job ?? null })]);
  return (
    <section>
      <h1>Automations</h1>
      <p>Scheduled jobs and their recent runs. Business jobs (follow-ups, care cycles, reminders) arrive in later phases.</p>
      <h2>Jobs</h2>
      <table>
        <thead><tr><th>Job</th><th>Every</th><th>Enabled</th><th>Last success</th><th>Health</th><th></th></tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.key}>
              <td>{j.name}<br /><small>{j.description}</small></td>
              <td>{j.intervalMinutes} min</td>
              <td>{j.enabled ? "Yes" : "No"}</td>
              <td>{j.lastRunAt ? formatInTimeZone(j.lastRunAt, history.timeZone) : "Never"}</td>
              <td>{j.freshness === "ok" ? "On schedule" : j.freshness === "stale" ? "Stale" : "Never ran"}</td>
              <td>
                <ActionForm action={runJobNowAction} submitLabel="Run now">
                  <input type="hidden" name="jobKey" value={j.key} />
                </ActionForm>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Recent runs{job ? ` for ${job}` : ""}</h2>
      {history.runs.length === 0 ? (
        <p>No runs yet.</p>
      ) : (
        <table>
          <thead><tr><th>Job</th><th>Started</th><th>Finished</th><th>Status</th><th>Attempts</th><th>Trigger</th><th>Error</th></tr></thead>
          <tbody>
            {history.runs.map((r) => (
              <tr key={r.id}>
                <td>{r.jobKey}</td>
                <td>{formatInTimeZone(r.startedAt, history.timeZone)}</td>
                <td>{r.finishedAt ? formatInTimeZone(r.finishedAt, history.timeZone) : ""}</td>
                <td>{r.status}</td>
                <td>{r.attempts}</td>
                <td>{r.triggerSource}</td>
                <td>{r.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
