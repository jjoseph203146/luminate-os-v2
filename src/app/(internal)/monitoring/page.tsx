import Link from "next/link";
import { requireOwner } from "@/platform/auth/actor";
import { formatInTimeZone } from "@/platform/calendar/business-days";
import { getMonitoringOverview } from "@/domains/monitoring/service";
import { daysLeft, hostOf, isStale } from "@/domains/monitoring/rules";
import type { SiteMonitor } from "@/domains/monitoring/types";
import { Banner, Card, Heading } from "@/ui/forms";
import { Icon } from "@/ui/Icon";
import { Pill, type KitTone } from "@/ui/kit";
import { PageTitle } from "@/ui/shell/PageTitle";

export const metadata = { title: "Monitoring" };

function health(m: SiteMonitor, now: Date): { label: string; tone: KitTone } {
  if (isStale(m.lastCheckedAt, now)) return { label: "No recent check", tone: "amber" };
  if (m.status === "down") return { label: "Down", tone: "red" };
  if (m.status === "slow") return { label: "Slow", tone: "amber" };
  if (m.status === "up") return { label: "Up", tone: "green" };
  return { label: "Unknown", tone: "gray" };
}

function ago(iso: string | null, now: Date): string {
  if (!iso) return "never";
  const mins = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function expiry(date: string | null, now: Date): { text: string; bad: boolean } {
  const d = daysLeft(date, now);
  if (d === null) return { text: "Not checked", bad: false };
  if (d < 0) return { text: `Expired ${-d} day${d === -1 ? "" : "s"} ago`, bad: true };
  return { text: `${d} day${d === 1 ? "" : "s"}`, bad: d <= 14 };
}

function Stat({ label, value, bad = false }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-dim">{label}</div>
      <div className={`truncate font-mono text-[13.5px] ${bad ? "text-red" : ""}`}>{value}</div>
    </div>
  );
}

export default async function MonitoringPage() {
  const actor = await requireOwner();
  const { sites, issues, timeZone, asOf } = await getMonitoringOverview(actor);
  const now = new Date(asOf);
  const rows = sites
    .map((m) => ({ m, h: health(m, now) }))
    .sort((a, b) => ["red", "amber", "gray", "green"].indexOf(a.h.tone) - ["red", "amber", "gray", "green"].indexOf(b.h.tone) || a.m.clientName.localeCompare(b.m.clientName));
  const count = (tone: KitTone) => rows.filter((r) => r.h.tone === tone).length;
  const names = new Map(sites.map((s) => [s.clientId, s.clientName]));

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title="Monitoring" sub="Client site checks and open issues" />
      <Banner tone="amber" icon={<Icon name="info" size={18} />}>
        The checks still run in the old app. This screen shows what they found, and the alert job turns problems into notifications. If the checks stop, you get an alert.
      </Banner>

      <div className="flex flex-wrap gap-2">
        <Pill tone="green">{count("green")} up</Pill>
        <Pill tone="red">{count("red")} down</Pill>
        <Pill tone="amber">{count("amber")} need attention</Pill>
        <Pill tone="gray">{count("gray")} unknown</Pill>
      </div>

      <section>
        <Heading>Sites</Heading>
        {rows.length === 0 ? (
          <Card className="px-4 py-6 text-center text-[13px] text-dim">No sites are being monitored yet.</Card>
        ) : (
          <Card className="overflow-hidden">
            {rows.map(({ m, h }) => {
              const ssl = expiry(m.sslExpiresAt, now);
              const dom = expiry(m.domainExpiresAt, now);
              return (
                <div key={m.id} className="border-t border-line px-3.5 py-3 first:border-t-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/clients/${m.clientId}`} className="min-w-0 flex-1 truncate text-[15px] font-medium hover:underline">
                      {m.clientName}
                    </Link>
                    <Pill tone={h.tone}>{h.label}</Pill>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[12px] text-dim">{hostOf(m.url)}</div>
                  <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-5">
                    <Stat label="Response" value={m.responseTimeMs === null ? "n/a" : `${m.responseTimeMs} ms`} />
                    <Stat label="Security" value={m.securityScore === null ? "n/a" : `${m.securityScore}/100`} />
                    <Stat label="SSL expires" value={ssl.text} bad={ssl.bad} />
                    <Stat label="Domain expires" value={dom.text} bad={dom.bad} />
                    <Stat label="Broken links" value={m.brokenLinks === null ? "n/a" : String(m.brokenLinks)} bad={(m.brokenLinks ?? 0) > 0} />
                  </div>
                  <div className="mt-2 text-[12px] text-dim">
                    Checked {ago(m.lastCheckedAt, now)}
                    {m.lastCheckedAt ? ` (${formatInTimeZone(m.lastCheckedAt, timeZone)})` : ""}
                  </div>
                  {m.lastError && <div className="mt-1 break-words text-[12px] text-red">{m.lastError}</div>}
                </div>
              );
            })}
          </Card>
        )}
      </section>

      <section>
        <Heading>Open issues</Heading>
        {issues.length === 0 ? (
          <Card className="px-4 py-6 text-center text-[13px] text-dim">No unresolved issues.</Card>
        ) : (
          <Card className="overflow-hidden">
            {issues.map((i) => (
              <div key={i.id} className="flex items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{i.title}</div>
                  <div className="mt-0.5 truncate text-[12px] text-dim">
                    {i.clientId ? (names.get(i.clientId) ?? "Client") : "No client"}
                    {i.lastSeen ? ` · last seen ${ago(i.lastSeen, now)}` : ""}
                  </div>
                </div>
                {i.level && <Pill tone={i.level === "error" || i.level === "fatal" ? "red" : "gray"}>{i.level}</Pill>}
                {i.webUrl && /^https:\/\//.test(i.webUrl) && (
                  <a href={i.webUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] text-blue">Open</a>
                )}
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
