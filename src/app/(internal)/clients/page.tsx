import Link from "next/link";
import { requireOwner } from "@/platform/auth/actor";
import { listClients } from "@/domains/clients/service";
import { CLIENT_STATUS_FILTERS, parseStatusFilter, statusLabel } from "@/domains/clients/rules";
import { ClientList } from "./ClientList";

export const metadata = { title: "Clients" };

type SearchParams = Promise<{ q?: string | string[]; status?: string | string[]; archived?: string | string[] }>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireOwner();
  const params = await searchParams;
  const q = first(params.q) ?? "";
  const status = parseStatusFilter(first(params.status));
  const includeArchived = first(params.archived) === "1";
  const clients = await listClients(actor, { search: q, status, includeArchived });

  const chipHref = (s: string | null) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (s) sp.set("status", s);
    if (includeArchived) sp.set("archived", "1");
    const qs = sp.toString();
    return qs ? `/clients?${qs}` : "/clients";
  };
  const chip = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${active ? "border-brand bg-surface-muted text-brand" : "border-line text-muted"}`;

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Clients</h1>

      <form action="/clients" method="get" role="search" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Business, contact, email, phone or website"
          aria-label="Search clients"
          maxLength={60}
          className="min-h-12 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3"
        />
        {status && <input type="hidden" name="status" value={status} />}
        {includeArchived && <input type="hidden" name="archived" value="1" />}
        <button type="submit" className="min-h-12 rounded-lg bg-brand px-4 font-semibold text-brand-ink">Search</button>
      </form>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Filter by status">
        <Link href={chipHref(null)} className={chip(status === null)}>All</Link>
        {CLIENT_STATUS_FILTERS.map((s) => (
          <Link key={s} href={chipHref(s)} className={chip(status === s)}>{statusLabel(s)}</Link>
        ))}
      </div>

      <p className="text-sm text-muted" role="status">
        {clients.length} {clients.length === 1 ? "client" : "clients"}
        {q ? ` matching "${q}"` : ""}
        {includeArchived ? " (including archived)" : ""}
      </p>

      {clients.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
          No clients match. Try fewer words, or clear the filter.
        </p>
      ) : (
        <ClientList clients={clients} />
      )}

      {!includeArchived && (
        <Link
          href={(() => {
            const sp = new URLSearchParams();
            if (q) sp.set("q", q);
            if (status) sp.set("status", status);
            sp.set("archived", "1");
            return `/clients?${sp.toString()}`;
          })()}
          className="text-sm text-muted underline"
        >
          Show archived clients
        </Link>
      )}
    </section>
  );
}
