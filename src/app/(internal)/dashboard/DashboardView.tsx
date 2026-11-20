import type { ReactNode } from "react";
import Link from "next/link";
import { STAGE_LABEL } from "@/domains/growth/rules";
import { formatMoney } from "@/domains/clients/rules";
import type { LeadLine, OwnerDashboard } from "@/domains/dashboard/types";
import { EmptyNote, Group, ListRow, SectionHead, type KitTone } from "@/ui/kit";
import { PageTitle } from "@/ui/shell/PageTitle";

function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function asOf(iso: string, timeZone: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "time unavailable";
  try {
    return instant.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });
  } catch {
    return "time unavailable";
  }
}

function countText(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}

function moneyText(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatMoney(value);
}

function Stat({ label, value, note, tone = "text-ink" }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[14px] border border-line bg-surface px-3.5 py-3">
      <div className="text-[12px] font-semibold uppercase tracking-[.08em] text-dim">{label}</div>
      <div className={`text-[26px] font-semibold leading-[1.1] tracking-[-.02em] [font-variant-numeric:tabular-nums] ${tone}`}>{value}</div>
      <div className="text-[12.5px] leading-snug text-dim">{note}</div>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[13px] leading-[1.45] text-dim">{children}</div>;
}

const DUE_PILL: Record<LeadLine["due"], { pill: string; tone: KitTone }> = {
  overdue: { pill: "Overdue", tone: "red" },
  today: { pill: "Due today", tone: "amber" },
  stale: { pill: "Stale", tone: "amber" },
  won: { pill: "Won", tone: "gray" },
};

function LeadList({ title, count, rows, total, empty, unavailable }: { title: string; count: number | null; rows: LeadLine[] | null; total: number | null; empty: string; unavailable: string }) {
  const tone = count && count > 0 ? "text-red" : "text-dim";
  return (
    <section>
      <SectionHead title={title} count={countText(count)} countTone={tone} />
      <Group>
        {rows === null ? (
          <EmptyNote>{unavailable}</EmptyNote>
        ) : rows.length === 0 ? (
          <EmptyNote>{empty}</EmptyNote>
        ) : (
          rows.map((row) => {
            const pill = DUE_PILL[row.due];
            return <ListRow key={row.id} href={row.href} icon="person_search" tone={pill.tone} title={row.businessName} sub={row.detail} pill={pill.pill} pillTone={pill.tone} />;
          })
        )}
      </Group>
      {rows && total !== null && total > rows.length && <p className="mx-0.5 mt-2 text-[12px] text-dim">Showing {rows.length} of {total}.</p>}
    </section>
  );
}

const SOURCES: { term: string; detail: string }[] = [
  { term: "New leads", detail: "Leads created this Monday–Sunday week, using the business time zone on leads.created_at." },
  { term: "Sources", detail: "The source recorded on those new leads. A blank source is counted as “No source”." },
  { term: "Pipeline", detail: "Counts by leads.status: interested, contacted, quoted, won, lost. “Changed this week” uses leads.stage_changed_at and means the current stage last changed this week." },
  { term: "Open deal value", detail: "Sum of leads.estimated_value on leads that are not won or lost. This is deal value, not revenue. Leads with no value are counted beside it." },
  { term: "Proposals", detail: "Open leads in Proposal sent (status quoted). There is no proposals table, so this is the stage, not a separate proposal." },
  { term: "Won", detail: "Status won: the contract is signed and the deposit is paid. Won deal value is shown separately and is not added to revenue." },
  { term: "Win rate", detail: "Won divided by won plus lost. Open leads are not in the rate. Blank when nothing is closed." },
  { term: "Follow-ups", detail: "Open leads whose follow_up_date is today or earlier." },
  { term: "Next steps", detail: "Open leads whose next_step_on is today or earlier. The next step text is the owner’s reminder, not the lead notes." },
  { term: "Stale", detail: "Open leads whose last touch, or created date when no touch is recorded, is 30 calendar days ago or older. A stage change does not count as a touch. Stale leads stay open." },
  { term: "Lost reasons", detail: "leads.lost_reason on lost leads." },
  { term: "Linked leads", detail: "leads.client_id. A won lead with no client is listed." },
  { term: "Active clients", detail: "Clients with no archived_at. Past due, paused and onboarding still count as active here." },
  { term: "Paying clients", detail: "Not archived, and lifetime_value is above zero or a revenue_events row is status paid with amount above zero." },
  { term: "Revenue", detail: "Sum of revenue_events with status paid and amount above zero. The month and week use paid_at in the business time zone. A paid row with no paid date is in the all-time total only. Pending, failed, zero, refunds, deal value and Won are not included. Refunds are not stored yet, so they are not subtracted." },
];

export function DashboardView({ dash }: { dash: OwnerDashboard }) {
  const leads = dash.leads.available ? dash.leads : null;
  const clients = dash.clients.available ? dash.clients : null;
  const revenue = dash.revenue.available ? dash.revenue : null;
  const maxStage = Math.max(1, ...(leads?.stages.map((stage) => stage.count) ?? [1]));
  const proposalNote = !leads
    ? "Leads could not be read."
    : leads.proposalsOut === 0
      ? "None in Proposal sent."
      : leads.proposalNames.join(", ") + (leads.proposalsOut > leads.proposalNames.length ? "…" : "");
  const wonNote = !leads
    ? "Leads could not be read."
    : leads.winRate === null
      ? "No closed leads yet. Won is not revenue."
      : `Win rate ${leads.winRate}% · ${leads.won + leads.lost} closed. Not revenue.`;
  const followNote = !leads ? "Leads could not be read." : leads.followUpsDueToday > 0 ? `${leads.followUpsDueToday} due today` : "None due today";
  const paidNote = !revenue ? "Paid payments could not be read." : revenue.undated > 0 ? `${revenue.paidCount} paid · ${revenue.undated} with no date` : `${revenue.paidCount} ${revenue.paidCount === 1 ? "payment" : "payments"}`;

  return (
    <>
      <PageTitle title="Dashboard" sub={`Weekly review · ${shortDay(dash.weekStart)}–${shortDay(dash.weekEnd)}`} />
      <div className="flex flex-col gap-5">
        <p className="m-0 text-[14px] leading-snug text-dim">
          Won means the contract is signed and the deposit is paid. Won is not revenue, and neither is open deal value. Revenue on this page is money already paid.
        </p>

        {!leads && <Notice>Leads are unavailable. The leads table or its columns could not be read, so pipeline figures are not shown as zero.</Notice>}
        {leads && !leads.pipelineAvailable && (
          <Notice>
            Next step, stale, lost reason, the client link and won-this-week are unavailable. Those columns come from migration 0011, which is not visible yet. Stage counts still use lead status.
          </Notice>
        )}
        {!clients && <Notice>Clients are unavailable. The clients table or its columns could not be read.</Notice>}
        {!revenue && <Notice>Paid revenue is unavailable. The revenue_events table or its columns could not be read. Nothing here is estimated.</Notice>}
        {clients && clients.paying === null && <Notice>Paying clients are unavailable because paid payments could not be read. Active clients are still counted.</Notice>}
        {(leads?.truncated || clients?.truncated || revenue?.truncated) && (
          <Notice>A list was cut off while reading, so the totals on this page are incomplete.</Notice>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="New this week" value={countText(leads?.newThisWeek)} note={leads ? "Created this week" : "Leads could not be read."} />
          <Stat
            label="Open deal value"
            value={moneyText(leads?.openValue)}
            note={!leads ? "Leads could not be read." : leads.openUnvalued > 0 ? `Not revenue · ${leads.openUnvalued} with no value` : "Deal value, not revenue"}
          />
          <Stat label="Proposals" value={countText(leads?.proposalsOut)} note={proposalNote} />
          <Stat label="Won" value={countText(leads?.won)} note={wonNote} />
          <Stat label="Follow-ups overdue" value={countText(leads?.followUpsOverdue)} note={followNote} tone={leads && leads.followUpsOverdue > 0 ? "text-red" : "text-ink"} />
          <Stat label="Paid this month" value={moneyText(revenue?.collectedThisMonth)} note={paidNote} />
          <Stat label="Active clients" value={countText(clients?.active)} note={!clients ? "Clients could not be read." : `${clients.archived} archived`} />
          <Stat
            label="Paying clients"
            value={countText(clients?.paying)}
            note={clients?.paying === null || !clients ? "Needs paid payments" : `${clients.activeNotPaying} active and not paying`}
          />
        </div>

        <section aria-label="Pipeline by stage" className="rounded-[14px] border border-line bg-surface px-4 py-3.5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="m-0 text-[12px] font-semibold uppercase tracking-[.1em] text-dim">Pipeline</h2>
            {leads?.pipelineAvailable && (leads.won > 0 || (leads.wonThisWeek ?? 0) > 0) && (
              <span className="text-[12px] text-dim">{leads.wonThisWeek} won this week{leads.wonWithoutStageTime ? ` · ${leads.wonWithoutStageTime} won with no stage time` : ""}</span>
            )}
          </div>
          {!leads ? (
            <p className="m-0 text-[14px] text-dim">Pipeline is unavailable.</p>
          ) : leads.openCount === 0 && leads.won === 0 && leads.lost === 0 ? (
            <p className="m-0 text-[14px] text-dim">No leads yet.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {leads.stages.map(({ stage, count, changedThisWeek }) => (
                <div key={stage} className="flex items-center gap-3 text-[14px]">
                  <span className="w-[124px] flex-none">{STAGE_LABEL[stage]}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-chip">
                    <span className={`block h-full rounded-full ${stage === "won" ? "bg-green" : stage === "lost" ? "bg-dim" : "bg-blue"}`} style={{ width: count === 0 ? "0%" : `${Math.max(6, Math.round((count / maxStage) * 100))}%` }} />
                  </span>
                  <span className="w-[88px] flex-none text-right font-mono text-[12px] text-dim">
                    {count}
                    {changedThisWeek ? ` · ${changedThisWeek}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
          {leads && <p className="mb-0 mt-3 text-[12px] text-dim">A number after the count is how many in that stage last changed this week. Won deal value {formatMoney(leads.wonValue)} is not revenue.</p>}
        </section>

        <div className="flex flex-wrap items-start gap-5">
          <section className="min-w-0 flex-[1_1_320px]">
            <SectionHead title="Sources this week" count={countText(leads?.newThisWeek)} />
            <Group>
              {!leads ? (
                <EmptyNote>Sources are unavailable.</EmptyNote>
              ) : leads.newBySource.length === 0 ? (
                <EmptyNote>No new leads this week.</EmptyNote>
              ) : (
                leads.newBySource.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-3 border-t border-line px-3.5 py-2.5 text-[14px] first:border-t-0">
                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{row.label}</span>
                    <span className="font-mono text-[13px] text-dim">{row.count}</span>
                  </div>
                ))
              )}
            </Group>
            {leads?.newByKind && leads.newThisWeek > 0 && (
              <p className="mx-0.5 mt-2 text-[12px] text-dim">
                Inbound {leads.newByKind.inbound} · Outbound {leads.newByKind.outbound} · Kind not set {leads.newByKind.unset}
              </p>
            )}
          </section>

          <section className="min-w-0 flex-[1_1_320px]">
            <SectionHead title="Lost reasons" count={leads ? String(leads.lost) : "—"} />
            <Group>
              {!leads ? (
                <EmptyNote>Lost reasons are unavailable.</EmptyNote>
              ) : leads.lostReasons === null ? (
                <EmptyNote>Lost reasons are unavailable until migration 0011 is applied. {leads.lost} {leads.lost === 1 ? "lead is" : "leads are"} lost.</EmptyNote>
              ) : leads.lostReasons.length === 0 ? (
                <EmptyNote>No lost leads, so there are no lost reasons.</EmptyNote>
              ) : (
                leads.lostReasons.map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-3 border-t border-line px-3.5 py-2.5 text-[14px] first:border-t-0">
                    <span>{row.label}</span>
                    <span className="font-mono text-[13px] text-dim">{row.count}</span>
                  </div>
                ))
              )}
            </Group>
          </section>
        </div>

        <LeadList
          title="Follow-ups due"
          count={leads?.followUpTotal ?? null}
          rows={leads?.followUps ?? null}
          total={leads?.followUpTotal ?? null}
          empty="No follow-ups are due."
          unavailable="Follow-ups are unavailable."
        />

        <LeadList
          title="Next steps due"
          count={leads?.nextStepTotal ?? null}
          rows={leads?.nextSteps ?? null}
          total={leads?.nextStepTotal ?? null}
          empty="No next step is due."
          unavailable="Next steps are unavailable until migration 0011 is applied."
        />

        <LeadList
          title="Stale leads"
          count={leads?.staleCount ?? null}
          rows={leads?.staleLeads ?? null}
          total={leads?.staleCount ?? null}
          empty="No open lead is stale. A lead goes stale after 30 days without a touch, and it stays open."
          unavailable="Stale leads are unavailable until migration 0011 is applied."
        />

        <section>
          <SectionHead title="Linked to a client" count={countText(leads?.linked)} />
          <Group>
            {!leads ? (
              <EmptyNote>Links are unavailable.</EmptyNote>
            ) : leads.linked === null ? (
              <EmptyNote>Client links are unavailable until migration 0011 is applied.</EmptyNote>
            ) : leads.openCount + leads.won + leads.lost === 0 ? (
              <EmptyNote>No leads yet, so none are linked to a client.</EmptyNote>
            ) : (
              <div className="px-4 py-[18px] text-[14px] leading-normal text-ink">
                {leads.linked} {leads.linked === 1 ? "lead is" : "leads are"} linked to a client. {leads.wonLinked} of {leads.won} won {leads.won === 1 ? "lead is" : "leads are"} linked.
                {leads.won > 0 && leads.wonUnlinkedTotal === 0 && " Every won lead has a client."}
              </div>
            )}
          </Group>
          {leads?.wonUnlinked && leads.wonUnlinked.length > 0 && (
            <div className="mt-2">
              <Group>
                {leads.wonUnlinked.map((row) => (
                  <ListRow key={row.id} href={row.href} icon="person_search" tone="amber" title={row.businessName} sub={row.detail} pill="No client" pillTone="amber" />
                ))}
              </Group>
              {leads.wonUnlinkedTotal !== null && leads.wonUnlinkedTotal > leads.wonUnlinked.length && (
                <p className="mx-0.5 mt-2 text-[12px] text-dim">Showing {leads.wonUnlinked.length} of {leads.wonUnlinkedTotal}.</p>
              )}
            </div>
          )}
        </section>

        <section aria-label="Clients and revenue" className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-[14px] border border-line bg-surface px-4 py-3.5">
            <h2 className="m-0 text-[12px] font-semibold uppercase tracking-[.1em] text-dim">Clients</h2>
            {!clients ? (
              <p className="mb-0 mt-2 text-[14px] text-dim">Clients are unavailable.</p>
            ) : clients.active === 0 && clients.archived === 0 ? (
              <p className="mb-0 mt-2 text-[14px] text-dim">No clients yet.</p>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[12px] text-dim">Active</div>
                  <div className="text-[22px] font-semibold [font-variant-numeric:tabular-nums]">{clients.active}</div>
                  <div className="text-[12px] text-dim">Not archived</div>
                </div>
                <div>
                  <div className="text-[12px] text-dim">Paying</div>
                  <div className="text-[22px] font-semibold [font-variant-numeric:tabular-nums]">{countText(clients.paying)}</div>
                  <div className="text-[12px] text-dim">{clients.paying === null ? "Payments unavailable" : "Have already paid"}</div>
                </div>
                <div>
                  <div className="text-[12px] text-dim">Active, not paying</div>
                  <div className="text-[22px] font-semibold [font-variant-numeric:tabular-nums]">{countText(clients.activeNotPaying)}</div>
                </div>
                <div>
                  <div className="text-[12px] text-dim">Archived</div>
                  <div className="text-[22px] font-semibold [font-variant-numeric:tabular-nums]">{clients.archived}</div>
                </div>
              </div>
            )}
          </div>
          <div className="rounded-[14px] border border-line bg-surface px-4 py-3.5">
            <div className="flex items-center gap-2">
              <h2 className="m-0 flex-1 text-[12px] font-semibold uppercase tracking-[.1em] text-dim">Revenue</h2>
              <Link href="/money" className="text-[13px] font-medium text-blue">Money</Link>
            </div>
            {!revenue ? (
              <p className="mb-0 mt-2 text-[14px] text-dim">No paid total is shown, because payments could not be read.</p>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[12px] text-dim">This week</div>
                    <div className="text-[22px] font-semibold [font-variant-numeric:tabular-nums]">{formatMoney(revenue.collectedThisWeek)}</div>
                  </div>
                  <div>
                    <div className="text-[12px] text-dim">This month</div>
                    <div className="text-[22px] font-semibold [font-variant-numeric:tabular-nums]">{formatMoney(revenue.collectedThisMonth)}</div>
                  </div>
                  <div>
                    <div className="text-[12px] text-dim">All paid</div>
                    <div className="text-[22px] font-semibold [font-variant-numeric:tabular-nums]">{formatMoney(revenue.collectedAllTime)}</div>
                  </div>
                </div>
                <p className="mb-0 mt-3 text-[12px] leading-[1.45] text-dim">
                  {revenue.paidCount === 0 ? "No paid payments recorded." : `${revenue.paidCount} paid ${revenue.paidCount === 1 ? "payment" : "payments"}.`} Pending and failed payments are not included. This page does not call Stripe.{" "}
                  <Link href="/money" className="font-medium text-blue">Money</Link> shows paid-only MRR from Stripe, which is a different figure.
                </p>
              </>
            )}
          </div>
        </section>

        <details className="rounded-[14px] border border-line bg-surface px-4 py-3">
          <summary className="cursor-pointer text-[14px] font-medium text-ink">Where each number comes from</summary>
          <dl className="mt-3 flex flex-col gap-2.5">
            {SOURCES.map((row) => (
              <div key={row.term}>
                <dt className="text-[13px] font-medium text-ink">{row.term}</dt>
                <dd className="m-0 text-[13px] leading-snug text-dim">{row.detail}</dd>
              </div>
            ))}
          </dl>
        </details>

        <p className="m-0 text-[12px] text-dim">
          As of {asOf(dash.generatedAt, dash.timeZone)} · {dash.timeZone}.{" "}
          <Link href="/growth" className="font-medium text-blue">Open Growth</Link>
          {" · "}
          <Link href="/" className="font-medium text-blue">Today</Link>
        </p>
      </div>
    </>
  );
}
