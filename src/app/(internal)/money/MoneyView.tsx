// The Money page layout, from the figures alone (no data fetching), so it can be shown with any data.
import Link from "next/link";
import { accountsLabel, GRACE_DAYS, money, shortDate } from "@/domains/money/rules";
import type { AttentionItem, MoneyOverview, UpcomingPayment } from "@/domains/money/types";
import { ageLabel } from "@/domains/clients/rules";
import type { IconName } from "@/ui/Icon";
import { EmptyNote, Group, IconTile, Pill, SectionHead, type KitTone } from "@/ui/kit";
import { PageTitle } from "@/ui/shell/PageTitle";

function sourceLine(o: MoneyOverview, now: Date): string {
  const last = o.lastEventAt ? `last payment event ${ageLabel(o.lastEventAt, now)}` : "no payment event received yet";
  if (o.stripe === "live") return `Stripe · live · ${last}`;
  if (o.stripe === "not_set_up") return "Stripe not set up · recorded payments only";
  return `Stripe unavailable · recorded payments only · ${last}`;
}

const UNAVAILABLE: Record<Exclude<MoneyOverview["stripe"], "live">, string> = {
  unavailable: "Stripe did not answer",
  not_set_up: "Stripe not set up",
};

function Stat({ label, value, sub, tone }: { label: string; value: string | null; sub: string; tone?: "red" | "amber" }) {
  const color = value === null ? "text-dim" : tone === "red" ? "text-red" : tone === "amber" ? "text-amber" : "text-ink";
  return (
    <div className="min-w-0 rounded-[14px] border border-line bg-surface px-4 py-3.5">
      <div className="truncate text-[13px] text-dim">{label}</div>
      <div className={`mt-0.5 truncate text-[26px] font-semibold leading-[1.2] tracking-[-.02em] ${color}`}>{value ?? "Unavailable"}</div>
      <div className="mt-0.5 truncate text-[13px] text-dim">{sub}</div>
    </div>
  );
}

function MoneyRow({ href, icon, tone, title, sub, pill, pillTone, amount }: { href: string | null; icon: IconName; tone: KitTone; title: string; sub: string; pill: string; pillTone: KitTone; amount: string }) {
  const body = (
    <>
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium leading-[1.3] text-ink">{title}</div>
        <div className="mt-0.5 truncate text-[13px] leading-[1.35] text-dim">{sub}</div>
      </div>
      <div className="flex flex-none flex-col items-end gap-1">
        <Pill tone={pillTone}>{pill}</Pill>
        <span className="whitespace-nowrap text-[14px] font-medium tabular-nums text-ink">{amount}</span>
      </div>
    </>
  );
  const cls = "flex min-h-[62px] items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0";
  return href ? (
    <Link href={href} className={`${cls} hover:bg-hover`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const clientHref = (id: string | null) => (id ? `/clients/${id}?tab=billing` : null);

function UpcomingRow({ p }: { p: UpcomingPayment }) {
  const autopay = p.kind === "autopay";
  return (
    <MoneyRow
      href={clientHref(p.clientId)}
      icon={autopay ? "autorenew" : "receipt_long"}
      tone={autopay ? "green" : "blue"}
      title={p.name}
      sub={`${shortDate(p.date)} · ${autopay ? "Autopay" : "Invoice"}`}
      pill={autopay ? "Autopay" : "Invoice"}
      pillTone={autopay ? "green" : "blue"}
      amount={money(p.cents, true)}
    />
  );
}

const ATTENTION: Record<AttentionItem["kind"], { icon: IconName; tone: KitTone; pill: string }> = {
  past_due: { icon: "error", tone: "red", pill: "Past due" },
  grace: { icon: "schedule", tone: "blue", pill: "In grace period" },
  paused: { icon: "pause_circle", tone: "amber", pill: "Paused" },
};

function AttentionRow({ a }: { a: AttentionItem }) {
  const k = ATTENTION[a.kind];
  return <MoneyRow href={clientHref(a.clientId)} icon={k.icon} tone={k.tone} title={a.name} sub={a.detail} pill={k.pill} pillTone={k.tone} amount={money(a.cents, true)} />;
}

export function MoneyView({ o, now }: { o: MoneyOverview; now: Date }) {
  const off = o.stripe === "live" ? null : UNAVAILABLE[o.stripe];
  const goalWidth = Math.min(100, Math.max(0, o.goal.percent));

  return (
    <>
      <PageTitle title="Money" sub={sourceLine(o, now)} />
      <div className="flex flex-col gap-5">
        <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label={`Collected · ${o.collected.monthShort}`} value={money(o.collected.cents)} sub={o.collected.range} />
          <Stat label="Active MRR" value={o.mrr ? money(o.mrr.cents) : null} sub={o.mrr ? "Paid subscriptions only" : (off ?? "")} />
          <Stat label="Past due" value={o.pastDue ? money(o.pastDue.cents) : null} tone="red" sub={o.pastDue ? `${accountsLabel(o.pastDue.accounts)} · after grace` : (off ?? "")} />
          <Stat
            label="In grace period"
            value={o.grace ? money(o.grace.cents) : null}
            sub={o.grace ? `${accountsLabel(o.grace.accounts)}${o.grace.day !== null ? ` · day ${o.grace.day} of ${GRACE_DAYS}` : ""}` : (off ?? "")}
          />
          <Stat label="Paused" value={o.paused ? money(o.paused.cents) : null} tone="amber" sub={o.paused ? `${accountsLabel(o.paused.accounts)} · not counted` : (off ?? "")} />
        </section>

        <section aria-label="Monthly goal" className="rounded-[14px] border border-line bg-surface px-4 py-4">
          <div className="flex items-center gap-2">
            <h2 className="m-0 flex-1 text-[12px] font-semibold uppercase tracking-[.1em] text-dim">{money(o.goal.cents).replace(",000", "K")} monthly goal</h2>
            <span className="text-[14px] font-medium tabular-nums">{o.goal.percent}%</span>
          </div>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-chip"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={goalWidth}
            aria-label={`${o.collected.monthShort} collected, ${o.goal.percent}% of the goal`}
          >
            <div className="h-full rounded-full bg-blue" style={{ width: `${goalWidth}%` }} />
          </div>
          <p className="m-0 mt-3 text-[14px] text-dim">
            {o.lastMonth.monthName} total {money(o.lastMonth.cents)}
            {o.goal.mrrPercent !== null ? ` · MRR covers ${o.goal.mrrPercent}% of goal` : ""}
          </p>
        </section>

        <section>
          <SectionHead title="Upcoming payments" />
          <Group>
            {o.upcoming === null ? (
              <EmptyNote>Unavailable: {off}. Upcoming payments come from Stripe.</EmptyNote>
            ) : o.upcoming.length === 0 ? (
              <EmptyNote>No payments due in the next 14 days.</EmptyNote>
            ) : (
              o.upcoming.map((p) => <UpcomingRow key={p.key} p={p} />)
            )}
          </Group>
        </section>

        <section>
          <SectionHead title="Needs attention" />
          <Group>
            {o.attention === null ? (
              <EmptyNote>Unavailable: {off}. Overdue and paused accounts come from Stripe.</EmptyNote>
            ) : o.attention.length === 0 ? (
              <EmptyNote>Nothing overdue or paused.</EmptyNote>
            ) : (
              o.attention.map((a) => <AttentionRow key={a.key} a={a} />)
            )}
          </Group>
        </section>

        <p className="m-0 text-[13px] leading-[1.5] text-dim">
          Overdue schedule: Day 0 unpaid (a failed autopay counts) · days 1–{GRACE_DAYS} grace period · then past due. Delinquent and paused accounts never
          count as collected revenue. Collected is payments recorded this month; refunds are not subtracted yet. Upcoming amounts are the Stripe price
          before any discount or tax.
        </p>
      </div>
    </>
  );
}
