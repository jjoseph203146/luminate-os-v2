import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireOwner } from "@/platform/auth/actor";
import { getClientWorkspace } from "@/domains/clients/service";
import { ageLabel, formatMoney, phoneHref, safeUrl, statusLabel, statusTone } from "@/domains/clients/rules";
import type { ClientProject, ClientWorkspace } from "@/domains/clients/types";
import { Icon, type IconName } from "@/ui/Icon";
import { Flag, StatusBadge } from "@/ui/StatusBadge";
import { ActionTile, EmptyNote, Group, Initials, ListRow, Pill, SectionHead, type KitTone } from "@/ui/kit";
import { PageTitle } from "@/ui/shell/PageTitle";
import { AddRequestLink, ClientRequestTile } from "@/ui/shell/QuickAddButtons";

export const metadata = { title: "Client" };

const TABS = ["overview", "projects", "websites", "care", "requests", "billing", "documents", "activity"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  projects: "Projects",
  websites: "Websites",
  care: "Care",
  requests: "Requests",
  billing: "Billing",
  documents: "Documents",
  activity: "Activity",
};

type SearchParams = Promise<{ tab?: string | string[] }>;

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "Not recorded");
const REQUEST_TONE: Record<string, KitTone> = { new: "blue", in_review: "blue", in_progress: "amber", waiting_on_client: "gray", completed: "green" };
const MONITOR_TONE: Record<string, string> = { ok: "text-green", warn: "text-amber", bad: "text-red", neutral: "text-dim" };

/** Label/value row inside a card. */
function Kv({ label, children, mono, className = "" }: { label: string; children: ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3.5 border-t border-line py-2 text-[14px]">
      <span className="flex-none text-dim">{label}</span>
      <span className={`min-w-0 text-right [overflow-wrap:anywhere] ${mono ? "font-mono text-[12px]" : ""} ${className}`}>{children}</span>
    </div>
  );
}

function ExternalLink({ url }: { url: string | null }) {
  if (!url) return <span className="text-dim">Not recorded</span>;
  const href = safeUrl(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue">{url}</a>
  ) : (
    <span>{url}</span>
  );
}

function Card({ icon, title, tag, children, note, noteClass = "text-dim" }: { icon: IconName; title: string; tag?: string; children?: ReactNode; note?: string; noteClass?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[14px] border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className="text-dim"><Icon name={icon} size={19} /></span>
        <h3 className="m-0 min-w-0 flex-1 truncate text-[14px] font-semibold">{title}</h3>
        {tag && <span className="rounded-full bg-chip px-[7px] py-[3px] text-[11px] font-medium text-dim">{tag}</span>}
      </div>
      {children && <div>{children}</div>}
      {note && <div className={`text-[13px] leading-normal ${noteClass}`}>{note}</div>}
    </div>
  );
}

function Banner({ tone, icon, children }: { tone: "red" | "amber"; icon: IconName; children: ReactNode }) {
  return (
    <div role="status" className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[14px] leading-[1.45] ${tone === "red" ? "bg-red-soft text-red" : "bg-amber-soft text-amber"}`}>
      <Icon name={icon} size={20} />
      <span className="flex-1 text-ink">{children}</span>
    </div>
  );
}

function ProjectCard({ p, now }: { p: ClientProject; now: Date }) {
  const launched = p.launchedAt !== null;
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface px-4 py-3.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">{p.name ?? "Unnamed project"}</div>
          <div className="mt-0.5 text-[13px] text-dim">Contract · {statusLabel(p.contractStatus)}</div>
        </div>
        <Pill tone={launched ? "green" : p.blockerNote ? "amber" : "blue"}>{launched ? "Launched" : "In progress"}</Pill>
      </div>
      <div>
        <Kv label="Build value">{p.buildValue === null ? "Not recorded" : formatMoney(p.buildValue)}</Kv>
        <Kv label="Target date">{date(p.targetDate)}</Kv>
        <Kv label="Launched">{date(p.launchedAt)}</Kv>
        <Kv label="Last deployed">{p.lastDeployedAt ? `${date(p.lastDeployedAt)} (${ageLabel(p.lastDeployedAt, now)})` : "Not recorded"}</Kv>
      </div>
      {p.blockerNote && (
        <div className="flex gap-1.5 text-[13px] leading-[1.45] text-red">
          <Icon name="error" size={16} />
          <span>{p.blockerNote}</span>
        </div>
      )}
    </div>
  );
}

function OverviewTab({ ws, now, id }: { ws: ClientWorkspace; now: Date; id: string }) {
  const { client, monitor } = ws;
  const open = ws.requests.filter((r) => r.status !== "completed");
  const phones = [client.phone, ...ws.phones.filter((p) => p !== client.phone)].filter(Boolean).join(", ");
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-3">
        <Card icon="person" title="Contact">
          <Kv label="Primary contact">{client.contactName}</Kv>
          <Kv label="Phone" mono>{phones || "Not recorded"}</Kv>
          <Kv label="Email">{[client.email, ...ws.emails.filter((e) => e !== client.email)].join(", ")}</Kv>
          <Kv label="Client since">{date(client.clientSince)}</Kv>
        </Card>
        <Card icon="dashboard" title="At a glance" tag="Client-level">
          <Kv label="Care plan">{client.planName ? `${client.planName} · ${formatMoney(client.subscriptionPrice)}/mo` : "No care plan"}</Kv>
          <Kv label="Monitoring" className={MONITOR_TONE[monitor.tone]}>{monitor.label}{monitor.lastCheckedAt ? ` · ${ageLabel(monitor.lastCheckedAt, now)}` : ""}</Kv>
          <Kv label="Open requests">{open.length}</Kv>
          <Kv label="Projects">{ws.projects.length}</Kv>
          <Kv label="Next payment" className="text-dim">Not verified</Kv>
        </Card>
      </div>
      <section>
        <SectionHead title="Open items">
          <AddRequestLink clientId={id} />
        </SectionHead>
        <Group>
          {open.length === 0 ? (
            <EmptyNote>No open requests for this client.</EmptyNote>
          ) : (
            open.map((r) => (
              <ListRow key={r.id} href={`/work?view=requests&request=${r.id}`} icon={r.status === "waiting_on_client" ? "hourglass_top" : "inbox"} title={r.title} code={r.displayId} sub={r.category ?? "Uncategorised"} pill={statusLabel(r.status)} pillTone={REQUEST_TONE[r.status] ?? "gray"} meta={ageLabel(r.createdAt, now)} minH="min-h-[60px]" />
            ))
          )}
        </Group>
      </section>
    </>
  );
}

export default async function ClientWorkspacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const actor = await requireOwner();
  const { id } = await params;
  const sp = await searchParams;
  const rawTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "overview";
  const ws = await getClientWorkspace(actor, id);
  if (!ws) notFound();

  const now = new Date();
  const { client, monitor } = ws;
  const tel = phoneHref(client.phone);
  const mainSite = ws.websites[0] ? safeUrl(ws.websites[0].url) : null;
  const openCount = ws.requests.filter((r) => r.status !== "completed").length;
  const counts: Partial<Record<Tab, number>> = { projects: ws.projects.length, websites: ws.websites.length, requests: openCount };
  const tabHref = (t: Tab) => (t === "overview" ? `/clients/${id}` : `/clients/${id}?tab=${t}`);
  const flags = [client.onHoldSince ? "On hold" : null, client.archivedAt ? "Archived" : null].filter((x): x is string => x !== null);

  return (
    <>
      <PageTitle title={`Clients / ${client.businessName}`} sub="Client workspace" phone={false} />
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <Link href="/clients" className="-ml-1.5 inline-flex h-11 items-center self-start pr-2.5 text-[15px] font-medium text-blue">
            <Icon name="chevron_left" size={26} />
            Clients
          </Link>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3.5">
            <div className="flex min-w-0 flex-[1_1_280px] items-center gap-3.5">
              <Initials name={client.businessName} size={54} radius={15} text={18} />
              <div className="min-w-0">
                <h1 className="m-0 text-[24px] font-semibold leading-[1.15] tracking-[-.02em] md:hidden">{client.businessName}</h1>
                <div className="hidden text-[24px] font-semibold leading-[1.15] tracking-[-.02em] md:block">{client.businessName}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <StatusBadge tone={statusTone(client.status)}>{statusLabel(client.status)}</StatusBadge>
                  <span className="rounded-full bg-chip px-2 py-1 text-[12px] font-medium">{client.planName ? `${client.planName} care` : "No care plan"}</span>
                  {flags.map((f) => <Flag key={f}>{f}</Flag>)}
                </div>
                <div className="mt-1.5 text-[13px] text-dim">{client.contactName}{ws.websites[0] ? ` · ${ws.websites[0].url}` : ""}</div>
              </div>
            </div>
            <div className="grid max-w-full flex-[1_1_300px] grid-cols-4 gap-2 md:max-w-[420px]">
              <ActionTile href={tel ? `tel:${tel}` : undefined} icon="call" label="Call" height={62} />
              <ActionTile href={`mailto:${client.email}`} icon="mail" label="Email" height={62} />
              <ActionTile href={mainSite ?? undefined} icon="language" label="Website" height={62} external />
              <ClientRequestTile clientId={id} height={62} />
            </div>
          </div>
        </div>

        <div role="tablist" aria-label="Workspace sections" className="no-scrollbar sticky top-0 z-[5] -mx-4 flex gap-0.5 overflow-x-auto border-b border-line bg-canvas px-4 md:top-[60px] md:mx-0 md:px-0">
          {TABS.map((t) => {
            const on = tab === t;
            const n = counts[t];
            return (
              <Link
                key={t}
                href={tabHref(t)}
                scroll={false}
                role="tab"
                aria-selected={on}
                className={`flex h-[46px] flex-none items-center gap-1.5 border-b-2 px-3 text-[14px] ${on ? "border-ink font-semibold text-ink" : "border-transparent font-medium text-dim"}`}
              >
                {TAB_LABEL[t]}
                {n ? <span className="rounded-full bg-chip px-1.5 py-px font-mono text-[11px] text-dim">{n}</span> : null}
              </Link>
            );
          })}
        </div>

        {(tab === "overview" || tab === "websites") && monitor.state === "down" && (
          <Banner tone="red" icon="error">{monitor.url ?? "The website"} is down. Last checked {ageLabel(monitor.lastCheckedAt, now)}.</Banner>
        )}
        {(tab === "overview" || tab === "websites") && monitor.state === "stale" && (
          <Banner tone="amber" icon="sync_problem">
            Monitoring is out of date. Last check {ageLabel(monitor.lastCheckedAt, now)}. Status is not shown as healthy until a fresh check runs.
          </Banner>
        )}

        {tab === "overview" && <OverviewTab ws={ws} now={now} id={id} />}

        {tab === "projects" &&
          (ws.projects.length === 0 ? (
            <Group><EmptyNote>No projects for this client.</EmptyNote></Group>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
              {ws.projects.map((p) => <ProjectCard key={p.id} p={p} now={now} />)}
            </div>
          ))}

        {tab === "websites" && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-3">
            {ws.websites.length === 0 && ws.projects.length === 0 && (
              <Card icon="language" title="Websites" note="No websites or projects recorded." />
            )}
            {ws.websites.map((w) => (
              <Card key={w.id} icon="language" title={w.url}>
                <Kv label={w.label || "Website"} mono><ExternalLink url={w.url} /></Kv>
              </Card>
            ))}
            {ws.projects.map((p) => (
              <Card key={p.id} icon="web" title={p.name ?? "Unnamed project"} tag="Hosting">
                <Kv label="Live site" mono><ExternalLink url={p.productionUrl} /></Kv>
                <Kv label="Staging site" mono><ExternalLink url={p.stagingUrl} /></Kv>
                <Kv label="Hosting">{statusLabel(p.hostingPlatform)}</Kv>
                <Kv label="Code repository" mono><ExternalLink url={p.githubUrl} /></Kv>
                <Kv label="Database project" mono>{p.supabaseProjectId ?? "Not recorded"}</Kv>
                <Kv label="Error tracking" mono>{p.sentryProject ?? "Not recorded"}</Kv>
              </Card>
            ))}
            <Card icon="key" title="Access" tag="References only" note="Logins and passwords are not stored here. Keep them in your password manager." />
            <Card
              icon="monitor_heart"
              title="Monitoring"
              tag="Client-level"
              note={`Automated results, not a guarantee of security. Monitoring is recorded once per client, not per website. The status applies to ${monitor.url ?? "no recorded address"}.`}
            >
              <Kv label="Status" className={MONITOR_TONE[monitor.tone]}>{monitor.label}</Kv>
              <Kv label="Last checked">{monitor.lastCheckedAt ? ageLabel(monitor.lastCheckedAt, now) : "Never"}</Kv>
              <Kv label="Response time" mono>{monitor.responseTimeMs === null ? "Not available" : `${monitor.responseTimeMs.toLocaleString("en-US")} ms`}</Kv>
              <Kv label="SSL certificate">{monitor.sslExpiresAt ? `Expires ${date(monitor.sslExpiresAt)}` : "Not available"}</Kv>
              <Kv label="Domain">{monitor.domainExpiresAt ? `Renews ${date(monitor.domainExpiresAt)}` : "Not available"}</Kv>
            </Card>
          </div>
        )}

        {tab === "care" && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-3">
            {client.planName ? (
              <Card
                icon="handshake"
                title="Care agreement"
                note={client.revisionsUsed >= client.revisionsIncluded ? "Allowance used. New update requests should be quoted as billable changes." : undefined}
                noteClass="text-amber"
              >
                <Kv label="Plan">{client.planName}</Kv>
                <Kv label="Plan price">{formatMoney(client.subscriptionPrice)}/mo</Kv>
                <Kv label="Updates this cycle" className={client.revisionsUsed >= client.revisionsIncluded ? "text-amber" : ""}>{client.revisionsUsed} of {client.revisionsIncluded} used</Kv>
                {client.onHoldSince && <Kv label="On hold since">{date(client.onHoldSince)}</Kv>}
                {client.monitoringPausedAt && <Kv label="Monitoring paused">{date(client.monitoringPausedAt)}</Kv>}
              </Card>
            ) : (
              <Card icon="handshake" title="Care agreement" note="No care plan recorded for this client." />
            )}
          </div>
        )}

        {tab === "requests" && (
          <section>
            <SectionHead title="All requests">
              <AddRequestLink clientId={id} />
            </SectionHead>
            <Group>
              {ws.requests.length === 0 ? (
                <EmptyNote>No requests from this client yet.</EmptyNote>
              ) : (
                ws.requests.map((r) => (
                  <ListRow
                    key={r.id}
                    href={r.status === "completed" ? undefined : `/work?view=requests&request=${r.id}`}
                    icon={r.status === "completed" ? "task_alt" : r.status === "waiting_on_client" ? "hourglass_top" : "inbox"}
                    tone={r.status === "completed" ? "green" : "gray"}
                    title={r.title}
                    code={r.displayId}
                    sub={`${r.category ?? "Uncategorised"} · ${r.billable ? "Billable" : "Not billable"}`}
                    pill={statusLabel(r.status)}
                    pillTone={REQUEST_TONE[r.status] ?? "gray"}
                    meta={ageLabel(r.createdAt, now)}
                    minH="min-h-[60px]"
                  />
                ))
              )}
            </Group>
          </section>
        )}

        {tab === "billing" && (
          <>
            <Banner tone="amber" icon="help">
              Payment status: not verified. The figures below are records kept by the existing app. They are not checked against Stripe here.
            </Banner>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-3">
              <Card icon="credit_card" title="Subscription" tag="Not verified">
                <Kv label="Agreement">{client.planName ? `${client.planName} care · ${formatMoney(client.subscriptionPrice)}/mo` : "None"}</Kv>
                <Kv label="Stripe customer">{client.hasStripeCustomer ? "Linked" : "Not linked"}</Kv>
                <Kv label="Payment source" className="text-dim">No verified payment source yet</Kv>
              </Card>
            </div>
            <section>
              <SectionHead title="Payment history" />
              <Group>
                {ws.payments.length === 0 ? (
                  <EmptyNote>No payment records.</EmptyNote>
                ) : (
                  ws.payments.map((p) => {
                    const tone: KitTone = p.status === "paid" ? "green" : p.status === "failed" ? "red" : "amber";
                    return (
                      <ListRow
                        key={p.id}
                        icon={p.status === "failed" ? "credit_card_off" : "payments"}
                        tone={tone}
                        title={formatMoney(p.amount)}
                        sub={p.paidAt ? `Paid ${ageLabel(p.paidAt, now)} · not verified` : `Recorded ${ageLabel(p.createdAt, now)} · not verified`}
                        pill={statusLabel(p.status)}
                        pillTone={tone}
                        minH="min-h-[60px]"
                      />
                    );
                  })
                )}
              </Group>
            </section>
          </>
        )}

        {tab === "documents" && (
          <section>
            <SectionHead title="Files" />
            <Group>
              {ws.documents.length === 0 ? (
                <EmptyNote>No files recorded.</EmptyNote>
              ) : (
                ws.documents.map((d) => (
                  <ListRow key={d.id} icon="draft" title={d.fileName} sub={`${d.category ?? "Uncategorised"} · ${ageLabel(d.createdAt, now)}`} minH="min-h-[60px]" />
                ))
              )}
            </Group>
          </section>
        )}

        {tab === "activity" && (
          <section>
            <SectionHead title="History" />
            <Group>
              {ws.activity.length === 0 ? (
                <EmptyNote>No activity recorded.</EmptyNote>
              ) : (
                ws.activity.map((a) => (
                  <ListRow key={a.id} icon="history" title={a.action.replace(/_/g, " ")} sub={`${a.entityType} · ${ageLabel(a.createdAt, now)}`} minH="min-h-[60px]" />
                ))
              )}
            </Group>
          </section>
        )}
      </div>
    </>
  );
}
