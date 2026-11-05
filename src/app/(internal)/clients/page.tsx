import Link from "next/link";
import { requireOwner } from "@/platform/auth/actor";
import { listClients } from "@/domains/clients/service";
import { phoneHref, safeUrl, statusLabel, statusTone } from "@/domains/clients/rules";
import type { ClientListItem } from "@/domains/clients/types";
import { Icon } from "@/ui/Icon";
import { Flag, StatusBadge } from "@/ui/StatusBadge";
import { ActionTile, EmptyNote, Group, Initials } from "@/ui/kit";
import { Panel } from "@/ui/Panel";
import { ChipLink } from "@/ui/records";
import { ClientRequestTile } from "@/ui/shell/QuickAddButtons";
import { PageTitle } from "@/ui/shell/PageTitle";

export const metadata = { title: "Clients" };

const FILTERS = ["all", "active", "past_due", "onboarding", "paused", "on_hold", "archived"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  active: "Active",
  past_due: "Past due",
  onboarding: "Onboarding",
  paused: "Paused",
  on_hold: "On hold",
  archived: "Archived",
};

type SearchParams = Promise<{ q?: string | string[]; f?: string | string[]; client?: string | string[] }>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function inFilter(c: ClientListItem, f: Filter): boolean {
  switch (f) {
    case "all":
      return !c.archived;
    case "archived":
      return c.archived;
    case "on_hold":
      return c.onHold && !c.archived;
    default:
      return c.status === f && !c.archived;
  }
}

const flagsOf = (c: ClientListItem) => [c.onHold ? "On hold" : null, c.archived ? "Archived" : null].filter((x): x is string => x !== null);

export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireOwner();
  const params = await searchParams;
  const q = first(params.q) ?? "";
  const rawFilter = first(params.f);
  const filter: Filter = (FILTERS as readonly string[]).includes(rawFilter ?? "") ? (rawFilter as Filter) : "all";
  const all = await listClients(actor, { search: q, status: null, includeArchived: true });
  const clients = all.filter((c) => inFilter(c, filter));
  const counts = Object.fromEntries(FILTERS.map((f) => [f, all.filter((c) => inFilter(c, f)).length])) as Record<Filter, number>;
  const open = first(params.client) ? all.find((c) => c.id === first(params.client)) : undefined;
  // With the record panel docked (lg+), drop Contact/Website so the table never squeezes.
  const COLS = open
    ? "grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.5fr)_104px_170px_52px] lg:grid-cols-[minmax(0,1fr)_104px_150px_44px]"
    : "grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.5fr)_104px_170px_52px]";
  const HIDE = open ? "lg:hidden" : "";

  const href = (f: Filter, extra?: Record<string, string>) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (f !== "all") sp.set("f", f);
    for (const [k, v] of Object.entries(extra ?? {})) sp.set(k, v);
    const s = sp.toString();
    return s ? `/clients?${s}` : "/clients";
  };
  const closeHref = href(filter);
  const clearHref = filter === "all" ? "/clients" : `/clients?f=${filter}`;
  const tel = open ? phoneHref(open.phone) : null;
  const site = open?.websites[0] ? safeUrl(open.websites[0].url) : null;

  return (
    <>
      <PageTitle title="Clients" sub={`${counts.active} active · ${counts.all} total`} />
      <div className="flex flex-col gap-2.5">
        <div className="sticky top-0 z-[5] flex flex-col gap-2.5 bg-canvas pb-2 pt-1.5 md:top-[60px]">
          <form action="/clients" method="get" role="search" className="relative">
            <Icon name="search" size={20} className="pointer-events-none absolute left-[13px] top-[13px] text-dim" />
            <input
              type="search"
              name="q"
              defaultValue={q}
              enterKeyHint="search"
              maxLength={60}
              placeholder="Search name, contact or website"
              aria-label="Search clients"
              className="h-[46px] w-full rounded-xl border border-line2 bg-field pl-[42px] pr-11 text-[16px] text-ink outline-none focus:border-blue focus:shadow-[0_0_0_3px_var(--blue-soft)]"
            />
            {filter !== "all" && <input type="hidden" name="f" value={filter} />}
            {q && (
              <Link href={clearHref} aria-label="Clear search" className="absolute right-[3px] top-[3px] grid h-10 w-10 place-items-center text-dim">
                <Icon name="cancel" size={20} filled />
              </Link>
            )}
          </form>
          <nav aria-label="Filter by status" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
            {FILTERS.map((f) => (
              <ChipLink key={f} href={href(f)} on={filter === f} count={counts[f]}>{FILTER_LABEL[f]}</ChipLink>
            ))}
          </nav>
        </div>

        <div className="mx-0.5 text-[13px] text-dim" role="status">
          {clients.length} {clients.length === 1 ? "client" : "clients"}
          {q ? ` matching “${q}”` : ""}
        </div>

        <Group>
          {clients.length === 0 ? (
            <EmptyNote>{q ? `No clients match “${q}”. Try a contact name, a website, or fewer words.` : "No clients here."}</EmptyNote>
          ) : (
            <>
              {/* Wide screens: table */}
              <div className="hidden md:block">
                <div className={`grid h-[38px] ${COLS} items-center gap-3 border-b border-line bg-side px-4 text-[12px] font-semibold uppercase tracking-[.06em] text-dim`}>
                  <span>Business</span>
                  <span className={HIDE}>Contact</span>
                  <span className={HIDE}>Website</span>
                  <span>Care plan</span>
                  <span>Status</span>
                  <span className="text-right">Open</span>
                </div>
                {clients.map((c) => (
                  <Link
                    key={c.id}
                    href={href(filter, { client: c.id })}
                    scroll={false}
                    className={`grid h-14 ${COLS} items-center gap-3 border-t border-line px-4 text-[14px] first:border-t-0 hover:bg-hover`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Initials name={c.businessName} size={30} radius={9} text={11} />
                      <span className="truncate font-medium">{c.businessName}</span>
                    </span>
                    <span className={`truncate text-dim ${HIDE}`}>{c.contactName}</span>
                    <span className={`truncate font-mono text-[12px] text-dim ${HIDE}`}>{c.websites[0]?.url ?? "—"}</span>
                    <span>{c.planName ?? "—"}</span>
                    <span className="flex flex-wrap items-center gap-1">
                      <StatusBadge tone={statusTone(c.status)}>{statusLabel(c.status)}</StatusBadge>
                      {flagsOf(c).map((f) => <Flag key={f}>{f}</Flag>)}
                    </span>
                    <span className={`text-right font-mono text-[13px] ${c.monitor.state === "down" ? "text-red" : "text-dim"}`}>
                      {c.openRequests > 0 ? c.openRequests : "—"}
                    </span>
                  </Link>
                ))}
              </div>
              {/* Phones: list */}
              <div className="md:hidden">
                {clients.map((c) => (
                  <Link
                    key={c.id}
                    href={href(filter, { client: c.id })}
                    scroll={false}
                    className="flex min-h-16 items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0 hover:bg-hover"
                  >
                    <Initials name={c.businessName} size={40} radius={12} text={13} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{c.businessName}</div>
                      <div className="mt-0.5 truncate text-[13px] text-dim">{c.contactName} · {c.planName ?? "No plan"}</div>
                    </div>
                    <div className="flex flex-none flex-col items-end gap-1">
                      <span className="flex items-center gap-1">
                        {flagsOf(c).map((f) => <Flag key={f}>{f}</Flag>)}
                        <StatusBadge tone={statusTone(c.status)}>{statusLabel(c.status)}</StatusBadge>
                      </span>
                      {c.openRequests > 0 && (
                        <span className={`text-[12px] ${c.monitor.state === "down" ? "text-red" : "text-dim"}`}>{c.openRequests} open</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </Group>
      </div>

      {open && (
        <Panel
          label="Client"
          closeHref={closeHref}
          footer={
            <Link href={`/clients/${open.id}`} className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-primary bg-primary text-[15px] font-semibold text-on-primary">
              Open workspace
            </Link>
          }
        >
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center gap-3.5">
              <Initials name={open.businessName} size={56} radius={16} text={19} />
              <div className="min-w-0">
                <div className="text-[21px] font-semibold leading-[1.2] tracking-[-.01em]">{open.businessName}</div>
                <div className="mt-[3px] text-[13px] text-dim">{open.contactName}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge tone={statusTone(open.status)}>{statusLabel(open.status)}</StatusBadge>
              <span className="rounded-full bg-chip px-2 py-1 text-[12px] font-medium">
                {open.planName ?? "No care plan"}
              </span>
              {flagsOf(open).map((f) => <Flag key={f}>{f}</Flag>)}
            </div>
            <div className="grid grid-cols-4 gap-2">
              <ActionTile href={tel ? `tel:${tel}` : undefined} icon="call" label="Call" />
              <ActionTile href={`mailto:${open.email}`} icon="mail" label="Email" />
              <ActionTile href={site ?? undefined} icon="language" label="Website" external />
              <ClientRequestTile clientId={open.id} />
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 text-[13px]">
              <span className={open.monitor.tone === "ok" ? "text-green" : open.monitor.tone === "bad" ? "text-red" : open.monitor.tone === "warn" ? "text-amber" : "text-dim"}>
                <Icon name={open.monitor.tone === "ok" ? "check_circle" : open.monitor.tone === "bad" ? "error" : open.monitor.tone === "warn" ? "sync_problem" : "help"} size={20} filled />
              </span>
              <span className="min-w-0 flex-1">Site check: {open.monitor.label}</span>
              <span className="text-[11px] text-dim">Client-level</span>
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}
