import Link from "next/link";
import { requireOwner } from "@/platform/auth/actor";
import { getToday } from "@/domains/today/service";
import { getBillingToday } from "@/domains/renewals/service";
import type { BillingHealth } from "@/domains/renewals/types";
import { BillingTaskRow } from "./_billing/BillingTasks";
import { ageLabel, formatMoney } from "@/domains/clients/rules";
import type { AttentionKind } from "@/domains/today/types";
import { Icon, type IconName } from "@/ui/Icon";
import { EmptyNote, Group, ListRow, SectionHead, type KitTone } from "@/ui/kit";
import { AddTaskLink } from "@/ui/shell/QuickAddButtons";
import { PageTitle } from "@/ui/shell/PageTitle";

export const metadata = { title: "Today" };

const SEVERITY: Record<1 | 2 | 3 | 4, { tone: KitTone; label: string }> = {
  1: { tone: "red", label: "Urgent" },
  2: { tone: "amber", label: "Soon" },
  3: { tone: "blue", label: "Check" },
  4: { tone: "gray", label: "Later" },
};

const KIND_ICON: Record<AttentionKind, IconName> = {
  payment_failed: "credit_card_off",
  past_due: "payments",
  site_down: "error",
  site_slow: "monitor_heart",
  site_stale: "sync_problem",
  request: "inbox",
  task: "task_alt",
  blocker: "block",
};

const PRIORITY_TONE: Record<string, KitTone> = { urgent: "red", high: "amber", normal: "gray", low: "gray" };

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function dueLabel(iso: string | null): string {
  if (!iso) return "No date";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Why billing tasks may be missing or late. Shown on Today, never hidden. */
function healthMessage(h: BillingHealth, available: boolean): string {
  if (!available) return "Billing tasks are unavailable: the billing tables could not be read (database migration 0009 may not be applied).";
  if (h.state === "not_set_up") return "The billing job is not set up or is switched off, so no billing tasks are being created.";
  if (h.state === "never") return "The billing job has not run yet, so billing tasks may be missing.";
  if (h.state === "failing") return "The billing job's last run failed. It retries by itself; billing tasks may be missing until it succeeds.";
  return "The billing job has not run for over 3 hours, so billing tasks may be out of date.";
}

export default async function TodayPage() {
  const actor = await requireOwner();
  const [data, billing] = await Promise.all([getToday(actor), getBillingToday(actor)]);
  const now = new Date(data.generatedAt);
  const r = data.revenue;

  return (
    <>
      <PageTitle title="Today" sub={longDate(data.today)} />
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[1.5_1_360px] flex-col gap-5">
          {/* Next payment: there is no verified payment source in this app yet, so it says so. */}
          <section
            aria-label="Next payment"
            className="flex flex-col gap-3 rounded-2xl border border-transparent bg-hero p-4 text-white"
          >
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[11px] font-semibold uppercase tracking-[.12em] text-white/[.72]">Next payment</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/[.12] py-1 pl-1.5 pr-[9px] text-[12px] font-semibold text-white/[.88]">
                <Icon name="help" size={15} filled />
                Not verified
              </span>
            </div>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[24px] font-semibold leading-[1.05] tracking-[-.02em]">Not available</div>
                <div className="mt-1.5 text-[14px]">No verified payment source yet</div>
              </div>
              {r.latestPaidAt && (
                <div className="flex-none whitespace-nowrap text-right">
                  <div className="text-[15px] font-semibold">{ageLabel(r.latestPaidAt, now)}</div>
                  <div className="text-[13px] text-white/[.72]">last payment recorded</div>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-white/[.14] pt-2.5 text-[12px] text-white/[.72]">
              <span className="inline-flex items-center gap-1.5">
                <Icon name="credit_card_off" size={16} />
                Not checked against Stripe
              </span>
              <span className="font-mono text-[11px]">Existing app records</span>
            </div>
          </section>

          <section>
            <SectionHead title="Needs attention" count={data.attentionTotal} countTone="text-red">
              <Link href="/work" className="ml-auto whitespace-nowrap px-1 py-2 text-[13px] font-medium text-blue">See all</Link>
            </SectionHead>
            <Group>
              {data.attention.length === 0 ? (
                <EmptyNote>
                  Nothing needs you right now. New requests, site incidents and overdue tasks will appear here.
                </EmptyNote>
              ) : (
                data.attention.map((item) => {
                  const sev = SEVERITY[item.severity];
                  return (
                    <ListRow
                      key={item.key}
                      href={item.href}
                      icon={KIND_ICON[item.kind]}
                      tone={sev.tone}
                      title={item.title}
                      sub={`${item.clientName ?? "No client"} · ${item.detail}`}
                      pill={sev.label}
                      pillTone={sev.tone}
                      meta={item.asOf ? ageLabel(item.asOf, now) : undefined}
                    />
                  );
                })
              )}
            </Group>
            {data.attentionTotal > data.attention.length && (
              <p className="mx-0.5 mt-2 text-[12px] text-dim">Showing the {data.attention.length} most urgent of {data.attentionTotal}.</p>
            )}
          </section>

          <section>
            <SectionHead title="Billing" count={billing.tasks.length} countTone={billing.tasks.some((t) => t.overdue) ? "text-red" : "text-dim"} />
            {billing.health.state !== "ok" && (
              <div role="alert" className="mb-2 flex items-start gap-2.5 rounded-xl bg-red-soft px-3.5 py-3 text-[13px] leading-[1.45] text-red">
                <Icon name="sync_problem" size={18} />
                <span>
                  {healthMessage(billing.health, billing.available)}{" "}
                  <Link href="/automations" className="font-semibold underline">Open Automations</Link>
                </span>
              </div>
            )}
            <Group>
              {billing.tasks.length === 0 ? (
                <EmptyNote>{billing.available ? "No billing tasks due. Renewal tasks appear 5 days before each client's renewal date." : "Billing tasks are unavailable."}</EmptyNote>
              ) : (
                billing.tasks.map((t) => <BillingTaskRow key={t.actionId} task={t} />)
              )}
            </Group>
            {billing.missingSchedules.length > 0 && (
              <p className="mx-0.5 mt-2 text-[12px] leading-[1.5] text-dim">
                No billing schedule yet, so no billing tasks for:{" "}
                {billing.missingSchedules.map((c, i) => (
                  <span key={c.clientId}>
                    {i > 0 && ", "}
                    <Link href={`/clients/${c.clientId}?tab=billing`} className="font-medium text-blue">{c.clientName}</Link>
                  </span>
                ))}
                .
              </p>
            )}
          </section>

          <section>
            <SectionHead title="Waiting on others" count={data.waiting.length} />
            <Group>
              {data.waiting.length === 0 ? (
                <EmptyNote>Nothing is blocked on clients or vendors.</EmptyNote>
              ) : (
                data.waiting.slice(0, 8).map((w) => (
                  <ListRow
                    key={w.key}
                    href={w.href}
                    icon="hourglass_top"
                    tone="gray"
                    title={w.title}
                    code={w.code ?? undefined}
                    sub={w.clientName ?? "Business to-do"}
                    meta={ageLabel(w.since, now)}
                    metaMono
                    minH="min-h-[60px]"
                  />
                ))
              )}
            </Group>
          </section>
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
          <section>
            <SectionHead title="Business to-dos">
              <AddTaskLink />
            </SectionHead>
            <Group>
              {data.todos.length === 0 ? (
                <EmptyNote>No business to-dos. Add one with Quick add.</EmptyNote>
              ) : (
                data.todos.slice(0, 8).map((t) => (
                  <ListRow
                    key={t.id}
                    href={`/work?view=tasks&task=${t.id}`}
                    check={{ id: t.id, done: false, title: t.title }}
                    title={t.title}
                    sub="Business to-do"
                    pill={t.priority === "urgent" || t.priority === "high" ? t.priority[0]!.toUpperCase() + t.priority.slice(1) : undefined}
                    pillTone={PRIORITY_TONE[t.priority] ?? "gray"}
                    meta={t.overdue ? `Overdue · ${dueLabel(t.dueDate)}` : dueLabel(t.dueDate)}
                    metaBad={t.overdue}
                    minH="min-h-[60px]"
                  />
                ))
              )}
            </Group>
            {data.todos.length > 8 && (
              <Link href="/work?view=tasks" className="mx-0.5 mt-2 inline-block text-[13px] font-medium text-blue">All {data.todos.length} tasks</Link>
            )}
          </section>

          <section aria-labelledby="rev-h" className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface px-4 py-3.5">
            <div className="flex items-center gap-2">
              <h2 id="rev-h" className="m-0 flex-1 text-[12px] font-semibold uppercase tracking-[.1em] text-dim">Revenue</h2>
              <span className="font-mono text-[11px] text-dim">Existing app records</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[12px] text-dim">Paid this month</div>
                <div className="text-[22px] font-semibold tracking-[-.01em] [font-variant-numeric:tabular-nums]">{formatMoney(r.paidThisMonth)}</div>
                <div className="text-[12px] text-dim">{r.paidThisMonthCount} {r.paidThisMonthCount === 1 ? "payment" : "payments"}</div>
              </div>
              <div>
                <div className="text-[12px] text-dim">Plan prices · active</div>
                <div className="text-[22px] font-semibold tracking-[-.01em] [font-variant-numeric:tabular-nums]">{formatMoney(r.planTotal)}</div>
                <div className="text-[12px] text-dim">per month</div>
              </div>
              <div>
                <div className="text-[12px] text-dim">Failed · last 30 days</div>
                <div className="text-[22px] font-semibold tracking-[-.01em] [font-variant-numeric:tabular-nums]">{r.failedLast30Days}</div>
              </div>
              <div>
                <div className="text-[12px] text-dim">Pending</div>
                <div className="text-[22px] font-semibold tracking-[-.01em] [font-variant-numeric:tabular-nums]">{r.pendingCount}</div>
              </div>
            </div>
            <div className="text-[12px] text-dim">
              Not checked against Stripe. Plan prices are what clients are set to pay, not money collected.
            </div>
          </section>
          <p className="mx-0.5 text-[12px] text-dim">Updated {ageLabel(data.generatedAt, now)}</p>
        </div>
      </div>
    </>
  );
}
