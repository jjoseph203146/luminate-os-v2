import { requireOwner } from "@/platform/auth/actor";
import { getGrowthOverview } from "@/domains/growth/service";
import { followUpNote, followUpShort, followUpState, sortOpen, STAGE_LABEL } from "@/domains/growth/rules";
import type { Lead, Stage } from "@/domains/growth/types";
import { phoneHref } from "@/domains/clients/rules";
import { Icon } from "@/ui/Icon";
import { ActionTile, EmptyNote, Group, ListRow, Pill, SectionHead, type KitTone } from "@/ui/kit";
import { Panel } from "@/ui/Panel";
import { Kv, KvCard, PanelLabel, TextCard } from "@/ui/records";
import { PageTitle } from "@/ui/shell/PageTitle";

export const metadata = { title: "Growth" };

type SearchParams = Promise<{ lead?: string | string[] }>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const STAGE_TONE: Record<Stage, KitTone> = { new_lead: "blue", in_discussion: "amber", proposal_sent: "blue", won: "green", lost: "gray" };
const STATE_TONE: Record<string, KitTone> = { overdue: "red", today: "amber", upcoming: "blue", none: "gray" };

function dayLabel(iso: string | null): string {
  if (!iso) return "Not set";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function leadRow(l: Lead, today: string) {
  const state = followUpState(l, today);
  return (
    <ListRow
      key={l.id}
      href={`/growth?lead=${l.id}`}
      icon="person_search"
      tone={state === "overdue" ? "red" : state === "today" ? "amber" : STAGE_TONE[l.stage]}
      title={l.businessName}
      sub={[STAGE_LABEL[l.stage], followUpShort(l, today)].filter(Boolean).join(" · ")}
      pill={state === "overdue" ? "Overdue" : state === "today" ? "Due today" : undefined}
      pillTone={STATE_TONE[state]}
      meta={l.value === null ? "No value" : money(l.value)}
    />
  );
}

function Tile({ label, value, note, tone = "text-ink" }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[14px] border border-line bg-surface px-3.5 py-3">
      <div className="text-[12px] font-semibold uppercase tracking-[.08em] text-dim">{label}</div>
      <div className={`text-[26px] font-semibold leading-[1.1] tracking-[-.02em] ${tone}`}>{value}</div>
      <div className="text-[12.5px] leading-snug text-dim">{note}</div>
    </div>
  );
}

export default async function GrowthPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireOwner();
  const params = await searchParams;
  const { today, leads, summary: s, dueNow } = await getGrowthOverview(actor);
  const open = sortOpen(leads);
  const leadId = first(params.lead);
  const selected = leadId ? leads.find((l) => l.id === leadId) : undefined;
  const maxStage = Math.max(1, ...s.stages.map((x) => x.count));
  const tel = selected ? phoneHref(selected.phone) : null;

  return (
    <>
      <PageTitle title="Growth" sub="Leads, outreach and follow-ups" />
      <div className="flex flex-col gap-5">
        <div className="flex gap-2.5 rounded-xl bg-blue-soft px-3.5 py-3 text-[13px] leading-[1.45] text-blue">
          <Icon name="info" size={18} />
          <span className="flex-1">Growth is read-only for now. Add and edit leads in the existing app; they show up here.</span>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile
            label="Open pipeline"
            value={money(s.pipelineValue)}
            note={s.unvalued > 0 ? `Deal value, not revenue · ${s.unvalued} with no value` : "Deal value, not revenue"}
          />
          <Tile
            label="Follow-ups due"
            value={String(s.followUpsDue)}
            note={s.followUpsOverdue > 0 ? `${s.followUpsOverdue} overdue` : "None overdue"}
            tone={s.followUpsOverdue > 0 ? "text-red" : "text-ink"}
          />
          <Tile
            label="Proposals out"
            value={String(s.proposalsOut)}
            note={s.proposalNames.length > 0 ? s.proposalNames.slice(0, 2).join(", ") + (s.proposalNames.length > 2 ? "…" : "") : "None sent"}
          />
          <Tile
            label="Won"
            value={String(s.won)}
            note={s.winRate === null ? "No closed leads yet" : `Win rate ${s.winRate}% · ${s.won + s.lost} closed`}
          />
        </div>

        <section aria-label="Pipeline by stage" className="rounded-[14px] border border-line bg-surface px-4 py-3.5">
          <div className="mb-3 text-[12px] font-semibold uppercase tracking-[.1em] text-dim">Pipeline</div>
          <div className="flex flex-col gap-2.5">
            {s.stages.map(({ stage, count }) => (
              <div key={stage} className="flex items-center gap-3 text-[14px]">
                <span className="w-[116px] flex-none">{STAGE_LABEL[stage]}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-chip">
                  <span
                    className={`block h-full rounded-full ${stage === "won" ? "bg-green" : "bg-blue"}`}
                    style={{ width: count === 0 ? "0%" : `${Math.max(6, Math.round((count / maxStage) * 100))}%` }}
                  />
                </span>
                <span className="w-6 flex-none text-right font-mono text-[13px] text-dim">{count}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap items-start gap-5">
          <section className="min-w-0 flex-[1_1_360px]">
            <SectionHead title="Follow-ups due" count={dueNow.length} countTone={dueNow.length > 0 ? "text-red" : "text-dim"} />
            <Group>
              {dueNow.length === 0 ? <EmptyNote>No follow-ups due. Nice.</EmptyNote> : dueNow.map((l) => leadRow(l, today))}
            </Group>
          </section>
          <section className="min-w-0 flex-[1_1_360px]">
            <SectionHead title="Open leads" count={open.length} />
            <Group>
              {open.length === 0 ? <EmptyNote>No open leads yet.</EmptyNote> : open.map((l) => leadRow(l, today))}
            </Group>
          </section>
        </div>
      </div>

      {selected && (
        <Panel label="Lead" closeHref="/growth">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1.5">
              <Pill tone={STAGE_TONE[selected.stage]}>{STAGE_LABEL[selected.stage]}</Pill>
              {followUpState(selected, today) === "overdue" && <Pill tone="red">Follow-up overdue</Pill>}
            </div>
            <div>
              <div className="text-[21px] font-semibold leading-tight tracking-[-.01em]">{selected.businessName}</div>
              <div className="mt-0.5 text-[14px] text-dim">{selected.name}</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ActionTile href={tel ? `tel:${tel}` : undefined} icon="call" label="Call" />
              <ActionTile href={selected.email ? `mailto:${selected.email}` : undefined} icon="mail" label="Email" />
            </div>
          </div>
          <KvCard>
            <Kv label="Deal value">{selected.value === null ? "Not set" : money(selected.value)}</Kv>
            <Kv label="Follow-up">{followUpNote(selected, today)}</Kv>
            <Kv label="Follow-up date">{dayLabel(selected.followUpDate)}</Kv>
            <Kv label="Came in by">{selected.source ?? "Not recorded"}</Kv>
            <Kv label="Added">{dayLabel(selected.createdAt.slice(0, 10))}</Kv>
          </KvCard>
          {selected.notes && (
            <>
              <PanelLabel>Notes</PanelLabel>
              <TextCard>{selected.notes}</TextCard>
            </>
          )}
          <div className="flex gap-1.5 text-[12px] leading-[1.45] text-dim">
            <Icon name="lock" size={15} />
            Leads are edited in the existing app for now.
          </div>
        </Panel>
      )}
    </>
  );
}
