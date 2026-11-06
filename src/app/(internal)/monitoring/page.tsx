import Link from "next/link";
import { requireOwner } from "@/platform/auth/actor";
import { formatInTimeZone } from "@/platform/calendar/business-days";
import { getMonitoringOverview } from "@/domains/monitoring/service";
import { daysLeft, hostOf, isListed, siteHealth } from "@/domains/monitoring/rules";
import { SECURITY_CHECK_TOTAL } from "@/domains/monitoring/scan-types";
import { ActionForm } from "@/ui/ActionForm";
import { Banner, BTN_PRIMARY, BTN_SMALL, Card, Heading } from "@/ui/forms";
import { Icon } from "@/ui/Icon";
import { Pill } from "@/ui/kit";
import { PageTitle } from "@/ui/shell/PageTitle";
import { checkSpeedAction, scanSitesAction } from "./actions";

export const metadata = { title: "Monitoring" };
// "Scan now" runs the checks inside the request: a few seconds normally, at most about 25.
export const maxDuration = 60;

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
  const { sites, issues, visual, timeZone, asOf } = await getMonitoringOverview(actor);
  const now = new Date(asOf);
  const ORDER = ["down", "attention", "unknown", "up", "off"];
  const rows = sites
    .filter(isListed)
    .map((m) => ({ m, h: siteHealth(m, now) }))
    .sort((a, b) => ORDER.indexOf(a.h.kind) - ORDER.indexOf(b.h.kind) || a.m.clientName.localeCompare(b.m.clientName));
  const count = (kind: string) => rows.filter((r) => r.h.kind === kind).length;
  const names = new Map(sites.map((s) => [s.clientId, s.clientName]));

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title="Monitoring" sub="Client site checks and open issues" />
      <Banner tone="blue" icon={<Icon name="info" size={18} />}>
        Every site is checked automatically every 10 minutes, and the alert job turns problems into notifications. Use Scan now to check straight away. If the checks stop, you get an alert.
      </Banner>

      <ActionForm action={scanSitesAction} submitLabel="Scan all sites now" className="flex flex-col gap-3" buttonClassName={BTN_PRIMARY} note="Checks every monitored site right now. Takes a few seconds.">
        <span />
      </ActionForm>

      <div className="flex flex-wrap gap-2">
        <Pill tone="green">{count("up")} up</Pill>
        <Pill tone="red">{count("down")} down</Pill>
        <Pill tone="amber">{count("attention")} need attention</Pill>
        <Pill tone="gray">{count("unknown")} unknown</Pill>
        {count("off") > 0 && <Pill tone="gray">{count("off")} monitoring off</Pill>}
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
                    <Stat label="Security" value={m.securityScore === null ? "n/a" : `${m.securityScore}/${SECURITY_CHECK_TOTAL}`} />
                    <Stat label="SSL expires" value={ssl.text} bad={ssl.bad} />
                    <Stat label="Domain expires" value={dom.text} bad={dom.bad} />
                    <Stat label="Broken links" value={m.brokenLinks === null ? "n/a" : String(m.brokenLinks)} bad={(m.brokenLinks ?? 0) > 0} />
                  </div>
                  <div className="mt-2 text-[12px] text-dim">
                    Checked {ago(m.lastCheckedAt, now)}
                    {m.lastCheckedAt ? ` (${formatInTimeZone(m.lastCheckedAt, timeZone)})` : ""}
                  </div>
                  {m.lastError && <div className="mt-1 break-words text-[12px] text-red">{m.lastError}</div>}
                  {(() => {
                    const v = visual?.[m.clientId];
                    if (m.muteReason === "paused" && !v) return null;
                    return (
                      <div className="mt-3 border-t border-line pt-2.5">
                        <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-dim">Speed and visual (mobile)</div>
                        {v && v.performanceScore !== null ? (
                          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-5">
                            <Stat label="Speed" value={`${v.performanceScore}/100`} bad={v.performanceScore < 50} />
                            <Stat label="LCP" value={v.lcpMs === null ? "n/a" : `${(v.lcpMs / 1000).toFixed(1)} s`} bad={(v.lcpMs ?? 0) > 4000} />
                            <Stat label="CLS" value={v.cls === null ? "n/a" : String(v.cls)} bad={(v.cls ?? 0) > 0.25} />
                            <Stat label="TBT" value={v.tbtMs === null ? "n/a" : `${v.tbtMs} ms`} bad={(v.tbtMs ?? 0) > 600} />
                            <Stat label="Visual change" value={v.diffPercent === null ? "n/a" : `${v.diffPercent}%`} bad={(v.diffPercent ?? 0) >= 20} />
                          </div>
                        ) : (
                          <div className="mt-1 text-[12px] text-dim">Not checked yet.</div>
                        )}
                        {v?.lastCheckedAt && <div className="mt-1.5 text-[12px] text-dim">Speed checked {ago(v.lastCheckedAt, now)}</div>}
                        {v?.lastError && <div className="mt-1 break-words text-[12px] text-red">{v.lastError}</div>}
                      </div>
                    );
                  })()}
                  {m.muteReason === "paused" ? (
                    <div className="mt-2 text-[12px] text-dim">Monitoring is switched off for this client, so it is not scanned.</div>
                  ) : (
                    <div className="mt-2.5 flex flex-wrap items-start gap-2">
                      <ActionForm action={scanSitesAction} submitLabel="Scan now" className="flex flex-col gap-2" buttonClassName={BTN_SMALL}>
                        <input type="hidden" name="clientId" value={m.clientId} />
                      </ActionForm>
                      <ActionForm action={checkSpeedAction} submitLabel="Check speed now" className="flex flex-col gap-2" buttonClassName={BTN_SMALL}>
                        <input type="hidden" name="clientId" value={m.clientId} />
                      </ActionForm>
                    </div>
                  )}
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
