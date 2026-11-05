import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireOwner } from "@/platform/auth/actor";
import { getClientWorkspace } from "@/domains/clients/service";
import { ageLabel, formatMoney, phoneHref, safeUrl, statusLabel, statusTone } from "@/domains/clients/rules";
import { StatusBadge } from "@/ui/StatusBadge";

export const metadata = { title: "Client" };

const SECTIONS = [
  ["summary", "Summary"],
  ["websites", "Websites & access"],
  ["projects", "Projects"],
  ["care", "Care & requests"],
  ["billing", "Billing"],
  ["history", "Files & history"],
] as const;

const action = "inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-line px-3 text-sm font-medium";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-32 rounded-xl border border-line bg-surface p-4">
      <h2 id={`${id}-h`} className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ExternalLink({ url }: { url: string | null }) {
  if (!url) return <span className="text-muted">Not recorded</span>;
  const href = safeUrl(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-brand underline">{url}</a>
  ) : (
    <span className="break-all">{url}</span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "Not recorded");

export default async function ClientWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireOwner();
  const { id } = await params;
  const ws = await getClientWorkspace(actor, id);
  if (!ws) notFound();

  const now = new Date();
  const { client, monitor } = ws;
  const tel = phoneHref(client.phone);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/clients" className="inline-flex min-h-11 items-center text-sm text-muted">← Clients</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{client.businessName}</h1>
          <StatusBadge tone={statusTone(client.status)}>{statusLabel(client.status)}</StatusBadge>
          {client.archivedAt && <StatusBadge tone="neutral">Archived</StatusBadge>}
        </div>
        <p className="text-sm text-muted">{client.contactName}</p>
      </div>

      <div className="flex gap-2">
        {tel ? <a className={action} href={`tel:${tel}`}>Call</a> : null}
        {tel ? <a className={action} href={`sms:${tel}`}>Text</a> : null}
        <a className={action} href={`mailto:${client.email}`}>Email</a>
      </div>

      <nav aria-label="Sections" className="sticky top-14 z-10 -mx-4 flex gap-2 overflow-x-auto border-b border-line bg-canvas px-4 py-2">
        {SECTIONS.map(([key, label]) => (
          <a key={key} href={`#${key}`} className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-line px-4 text-sm text-muted">
            {label}
          </a>
        ))}
      </nav>

      <Section id="summary" title="Summary">
        <dl className="divide-y divide-line">
          <Row label="Plan">{client.planName ? `${client.planName} · ${formatMoney(client.subscriptionPrice)}/mo` : "No plan recorded"}</Row>
          <Row label="Client since">{date(client.clientSince)}</Row>
          <Row label="Open requests">{ws.openRequests}</Row>
          <Row label="Revisions this cycle">{client.revisionsUsed} of {client.revisionsIncluded} used</Row>
          <Row label="Website check">
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={monitor.tone}>{monitor.label}</StatusBadge>
              <span className="text-muted">last checked {ageLabel(monitor.lastCheckedAt, now)}</span>
            </span>
          </Row>
          {client.onHoldSince && <Row label="On hold since">{date(client.onHoldSince)}</Row>}
          <Row label="Email">{[client.email, ...ws.emails.filter((e) => e !== client.email)].join(", ")}</Row>
          <Row label="Phone">{[client.phone, ...ws.phones.filter((p) => p !== client.phone)].filter(Boolean).join(", ") || "Not recorded"}</Row>
        </dl>
      </Section>

      <Section id="websites" title="Websites & access">
        {ws.websites.length === 0 && ws.projects.length === 0 ? (
          <p className="text-sm text-muted">No websites or projects recorded.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {ws.websites.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {ws.websites.map((w) => (
                  <li key={w.id}><span className="text-muted">{w.label}: </span><ExternalLink url={w.url} /></li>
                ))}
              </ul>
            )}
            {ws.projects.map((p) => (
              <dl key={p.id} className="divide-y divide-line rounded-lg border border-line px-3">
                <Row label="Project">{p.name ?? "Unnamed project"}</Row>
                <Row label="Live site"><ExternalLink url={p.productionUrl} /></Row>
                <Row label="Staging site"><ExternalLink url={p.stagingUrl} /></Row>
                <Row label="Code repository"><ExternalLink url={p.githubUrl} /></Row>
                <Row label="Hosting">{statusLabel(p.hostingPlatform)}</Row>
                <Row label="Database project">{p.supabaseProjectId ?? "Not recorded"}</Row>
                <Row label="Error tracking project">{p.sentryProject ?? "Not recorded"}</Row>
              </dl>
            ))}
            <p className="rounded-lg bg-surface-muted p-3 text-sm text-muted">
              Logins and passwords are not stored here. Keep them in your password manager.
            </p>
            <p className="text-xs text-muted">
              Monitoring is recorded once per client, not per website. The status above applies to {monitor.url ?? "no recorded address"}.
            </p>
          </div>
        )}
      </Section>

      <Section id="projects" title="Projects">
        {ws.projects.length === 0 ? (
          <p className="text-sm text-muted">No projects.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {ws.projects.map((p) => (
              <li key={p.id} className="rounded-lg border border-line p-3">
                <p className="font-medium">{p.name ?? "Unnamed project"}</p>
                <dl className="mt-1 divide-y divide-line">
                  <Row label="Contract">{statusLabel(p.contractStatus)}</Row>
                  <Row label="Build value">{p.buildValue === null ? "Not recorded" : formatMoney(p.buildValue)}</Row>
                  <Row label="Target date">{date(p.targetDate)}</Row>
                  <Row label="Launched">{date(p.launchedAt)}</Row>
                  <Row label="Last deployed">{p.lastDeployedAt ? `${date(p.lastDeployedAt)} (${ageLabel(p.lastDeployedAt, now)})` : "Not recorded"}</Row>
                  {p.blockerNote && <Row label="Blocker">{p.blockerNote}</Row>}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="care" title="Care & requests">
        {ws.requests.length === 0 ? (
          <p className="text-sm text-muted">No requests yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {ws.requests.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 rounded-lg border border-line p-3">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted">#{r.displayId}</span>
                  <StatusBadge tone={r.status === "completed" ? "ok" : r.status === "waiting_on_client" ? "warn" : "info"}>{statusLabel(r.status)}</StatusBadge>
                </span>
                <span className="font-medium">{r.title}</span>
                <span className="text-xs text-muted">
                  {r.category ?? "Uncategorised"} · {r.billable ? "Billable" : "Not billable"} · opened {ageLabel(r.createdAt, now)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="billing" title="Billing">
        <p className="mb-3 rounded-lg bg-warn-bg p-3 text-sm text-warn">
          Payment status: not verified. The figures below are records kept by the existing app. They are not checked against Stripe here.
        </p>
        <dl className="divide-y divide-line">
          <Row label="Plan price">{client.planName ? `${formatMoney(client.subscriptionPrice)}/mo` : "No plan recorded"}</Row>
          <Row label="Stripe customer">{client.hasStripeCustomer ? "Linked" : "Not linked"}</Row>
        </dl>
        {ws.payments.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No payment records.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {ws.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-line p-3 text-sm">
                <span>
                  <span className="font-medium">{formatMoney(p.amount)}</span>
                  <span className="block text-xs text-muted">{p.paidAt ? `paid ${ageLabel(p.paidAt, now)}` : `recorded ${ageLabel(p.createdAt, now)}`}</span>
                </span>
                <StatusBadge tone={p.status === "paid" ? "ok" : p.status === "failed" ? "bad" : "warn"}>{statusLabel(p.status)}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="history" title="Files & history">
        <h3 className="mb-1 text-sm font-semibold">Files</h3>
        {ws.documents.length === 0 ? (
          <p className="mb-3 text-sm text-muted">No files recorded.</p>
        ) : (
          <ul className="mb-3 flex flex-col gap-1 text-sm">
            {ws.documents.map((d) => (
              <li key={d.id}>{d.fileName} <span className="text-muted">· {d.category ?? "uncategorised"} · {ageLabel(d.createdAt, now)}</span></li>
            ))}
          </ul>
        )}
        <h3 className="mb-1 text-sm font-semibold">Recent activity</h3>
        {ws.activity.length === 0 ? (
          <p className="text-sm text-muted">No activity recorded.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {ws.activity.map((a) => (
              <li key={a.id}>{a.action.replace(/_/g, " ")} <span className="text-muted">· {a.entityType} · {ageLabel(a.createdAt, now)}</span></li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
