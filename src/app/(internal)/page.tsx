import Link from "next/link";
import { requireOwner } from "@/platform/auth/actor";
import { getToday } from "@/domains/today/service";
import { ageLabel, formatMoney, statusLabel } from "@/domains/clients/rules";
import { StatusBadge, type Tone } from "@/ui/StatusBadge";

export const metadata = { title: "Today" };

const SEVERITY: Record<1 | 2 | 3 | 4, { tone: Tone; label: string }> = {
  1: { tone: "bad", label: "Urgent" },
  2: { tone: "warn", label: "Soon" },
  3: { tone: "info", label: "Check" },
  4: { tone: "neutral", label: "Later" },
};

const PRIORITY_TONE: Record<string, Tone> = { urgent: "bad", high: "warn", normal: "neutral", low: "neutral" };

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function TodayPage() {
  const actor = await requireOwner();
  const data = await getToday(actor);
  const now = new Date(data.generatedAt);
  const r = data.revenue;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold">Today</h1>
        <p className="text-sm text-muted">{longDate(data.today)} · updated {ageLabel(data.generatedAt, now)}</p>
      </header>

      <section aria-labelledby="pay-h" className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id="pay-h" className="text-lg font-semibold">Next payment</h2>
          <StatusBadge tone="warn">Not verified</StatusBadge>
        </div>
        <p className="mt-2 text-sm text-muted">
          There is no verified payment source in this app yet, so a next payment date is not shown.
          {r.latestPaidAt ? ` The last payment recorded by the existing app was ${ageLabel(r.latestPaidAt, now)}.` : ""}
        </p>
      </section>

      <section aria-labelledby="att-h" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="att-h" className="text-lg font-semibold">Needs attention</h2>
          <span className="text-sm text-muted">{data.attentionTotal}</span>
        </div>
        {data.attention.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
            Nothing needs attention in the records this app can read. Website checks and payments are only as current as the existing app.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.attention.map((item) => {
              const sev = SEVERITY[item.severity];
              return (
                <li key={item.key}>
                  <Link href={item.href} className="flex min-h-16 flex-col gap-1 rounded-xl border border-line bg-surface p-3">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{item.title}</span>
                      <StatusBadge tone={sev.tone}>{sev.label}</StatusBadge>
                    </span>
                    <span className="text-sm">{item.detail}</span>
                    <span className="text-xs text-muted">
                      {item.clientName ?? "No client"}
                      {item.asOf ? ` · ${ageLabel(item.asOf, now)}` : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {data.attentionTotal > data.attention.length && (
          <p className="text-sm text-muted">Showing the {data.attention.length} most urgent of {data.attentionTotal}.</p>
        )}
      </section>

      <section aria-labelledby="todo-h" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="todo-h" className="text-lg font-semibold">Business to-dos</h2>
          <Link href="/work" className="inline-flex min-h-11 items-center text-sm text-brand underline">All work</Link>
        </div>
        {data.todos.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">No open business to-dos.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.todos.slice(0, 8).map((t) => (
              <li key={t.id}>
                <Link href={`/work#task-${t.id}`} className="flex min-h-14 items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t.title}</span>
                    <span className="text-xs text-muted">
                      {statusLabel(t.status)}
                      {t.dueDate ? ` · due ${t.dueDate}` : ""}
                      {t.overdue ? " · overdue" : ""}
                    </span>
                  </span>
                  <StatusBadge tone={t.overdue ? "bad" : (PRIORITY_TONE[t.priority] ?? "neutral")}>{statusLabel(t.priority)}</StatusBadge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="rev-h" className="rounded-xl border border-line bg-surface p-4">
        <h2 id="rev-h" className="mb-2 text-lg font-semibold">Revenue</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted">Plan prices, active clients</dt>
            <dd className="text-lg font-semibold">{formatMoney(r.planTotal)}<span className="text-sm font-normal text-muted">/mo</span></dd>
          </div>
          <div>
            <dt className="text-muted">Paid this month</dt>
            <dd className="text-lg font-semibold">{formatMoney(r.paidThisMonth)}</dd>
            <dd className="text-xs text-muted">{r.paidThisMonthCount} {r.paidThisMonthCount === 1 ? "payment" : "payments"}</dd>
          </div>
          <div>
            <dt className="text-muted">Failed, last 30 days</dt>
            <dd className="font-semibold">{r.failedLast30Days}</dd>
          </div>
          <div>
            <dt className="text-muted">Pending</dt>
            <dd className="font-semibold">{r.pendingCount}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted">
          Source: payment records kept by the existing app, not checked against Stripe. Plan prices are what clients are set to pay, not money collected.
        </p>
      </section>
    </div>
  );
}
