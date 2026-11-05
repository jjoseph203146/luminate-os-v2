import Link from "next/link";
import { BTN_SMALL, Card, INPUT } from "@/ui/forms";
import { Pill } from "@/ui/kit";
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
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13px] text-dim">Read-only and insert-only: entries cannot be edited or deleted. Times are shown in {result.timeZone}.</p>

      <form method="get">
        <Card className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="flex flex-col gap-1.5 text-[12px] font-medium text-dim">
            Entity type
            <input name="entityType" defaultValue={params.entityType ?? ""} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] font-medium text-dim">
            Action starts with
            <input name="action" defaultValue={params.action ?? ""} className={INPUT} />
          </label>
          <button type="submit" className="h-[42px] rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-on-primary">Filter</button>
        </Card>
      </form>

      {result.rows.length === 0 ? (
        <Card className="px-4 py-6 text-center text-[13px] text-dim">No entries match.</Card>
      ) : (
        <Card className="overflow-hidden">
          {result.rows.map((r) => (
            <div key={r.id} className="border-t border-line px-3.5 py-2.5 first:border-t-0">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="gray">{r.entityType}</Pill>
                <span className="min-w-0 flex-1 break-words text-[14px] font-medium">{r.action}</span>
              </div>
              <div className="mt-1 break-words font-mono text-[12px] text-dim">
                {formatInTimeZone(r.occurredAt, result.timeZone)} · {r.actorType}
                {r.requestIp ? ` (${r.requestIp})` : ""}
                {r.entityId ? ` · ${r.entityId}` : ""}
              </div>
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[12px] text-blue">Before / after</summary>
                <pre className="mt-1.5 overflow-x-auto rounded-[10px] bg-field p-3 font-mono text-[12px]">{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre>
              </details>
            </div>
          ))}
        </Card>
      )}

      <div className="flex items-center gap-2 text-[13px] text-dim">
        <span className="flex-1">Page {result.page} of {pages} ({result.total} entries)</span>
        {result.page > 1 && <Link href={link(result.page - 1)} className={BTN_SMALL}>Previous</Link>}
        {result.page < pages && <Link href={link(result.page + 1)} className={BTN_SMALL}>Next</Link>}
      </div>
    </div>
  );
}
