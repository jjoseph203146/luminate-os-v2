import Link from "next/link";
import { requireOwner } from "@/platform/auth/actor";
import { formatInTimeZone } from "@/platform/calendar/business-days";
import { listAuditLog } from "@/domains/admin/service";

export const metadata = { title: "Audit log" };

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireOwner();
  const params = await searchParams;
  const result = await listAuditLog(actor, { page: params.page, entityType: params.entityType, action: params.action });
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const link = (page: number) => {
    const q = new URLSearchParams();
    if (params.entityType) q.set("entityType", params.entityType);
    if (params.action) q.set("action", params.action);
    q.set("page", String(page));
    return `/settings/audit-log?${q.toString()}`;
  };
  return (
    <section>
      <h1>Audit log</h1>
      <p>Read-only and insert-only: entries cannot be edited or deleted. Times are shown in {result.timeZone}.</p>
      <form method="get">
        <label>Entity type <input name="entityType" defaultValue={params.entityType ?? ""} /></label>{" "}
        <label>Action starts with <input name="action" defaultValue={params.action ?? ""} /></label>{" "}
        <button type="submit">Filter</button>
      </form>
      {result.rows.length === 0 ? (
        <p>No entries match.</p>
      ) : (
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.id}>
                <td>{formatInTimeZone(r.occurredAt, result.timeZone)}</td>
                <td>{r.actorType}{r.requestIp ? ` (${r.requestIp})` : ""}</td>
                <td>{r.action}</td>
                <td>{r.entityType}{r.entityId ? ` ${r.entityId}` : ""}</td>
                <td>
                  <details>
                    <summary>Before / after</summary>
                    <pre>{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>
        Page {result.page} of {pages} ({result.total} entries){" "}
        {result.page > 1 && <Link href={link(result.page - 1)}>Previous</Link>}{" "}
        {result.page < pages && <Link href={link(result.page + 1)}>Next</Link>}
      </p>
    </section>
  );
}
