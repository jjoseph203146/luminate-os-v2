import Link from "next/link";
import type { ReactNode } from "react";
import { requireOwner } from "@/platform/auth/actor";
import { getGrowthOverview } from "@/domains/growth/service";
import { followUpNote, followUpShort, followUpState, isOpen, LEAD_SOURCES, sortOpen, STAGE_LABEL } from "@/domains/growth/rules";
import { NOT_GIVEN } from "@/domains/growth/intake";
import { STAGES, type Lead, type Stage } from "@/domains/growth/types";
import { phoneHref } from "@/domains/clients/rules";
import { ActionForm } from "@/ui/ActionForm";
import { BTN_PRIMARY, BTN_SMALL, BTN_TEXT_RED, INPUT, MONO_INPUT, Stack, TEXTAREA } from "@/ui/forms";
import { Icon } from "@/ui/Icon";
import { ActionTile, EmptyNote, Group, ListRow, Pill, SectionHead, type KitTone } from "@/ui/kit";
import { Panel } from "@/ui/Panel";
import { Kv, KvCard, PanelLabel, TextCard } from "@/ui/records";
import { PageTitle } from "@/ui/shell/PageTitle";
import { createLeadAction, deleteLeadAction, setLeadFollowUpAction, setLeadStageAction, updateLeadAction } from "./actions";

export const metadata = { title: "Growth" };

type SearchParams = Promise<{ lead?: string | string[]; add?: string | string[] }>;
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

/** Collapsed section inside the lead panel (no script needed). */
function Fold({ label, icon, children }: { label: string; icon: "edit" | "cancel"; children: ReactNode }) {
  return (
    <details className="group rounded-[14px] border border-line bg-surface">
      <summary className="flex min-h-[46px] cursor-pointer list-none items-center gap-2 px-3.5 text-[14px] font-medium text-ink [&::-webkit-details-marker]:hidden">
        <Icon name={icon} size={18} className="text-dim" />
        <span className="flex-1">{label}</span>
        <Icon name="keyboard_arrow_down" size={20} className="text-dim transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-line px-3.5 pb-3.5 pt-3">{children}</div>
    </details>
  );
}

/** The fields of a lead, blank for a new one. Used by "Add lead" and "Edit details". */
function LeadFields({ lead }: { lead?: Lead }) {
  const sources: string[] = [...LEAD_SOURCES];
  if (lead?.source && !sources.includes(lead.source)) sources.unshift(lead.source);
  return (
    <div className="flex flex-col gap-3">
      <Stack label="Business name (optional)">
        <input name="businessName" maxLength={150} defaultValue={lead && lead.businessName !== NOT_GIVEN ? lead.businessName : ""} placeholder="Nova Barbershop" className={INPUT} />
      </Stack>
      <Stack label="Contact name">
        <input name="name" required maxLength={100} defaultValue={lead?.name ?? ""} placeholder="Marcus Rowe" className={INPUT} />
      </Stack>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stack label="Email (optional)">
          <input name="email" type="email" maxLength={254} defaultValue={lead?.email ?? ""} autoComplete="off" className={INPUT} />
        </Stack>
        <Stack label="Phone (optional)">
          <input name="phone" type="tel" maxLength={40} defaultValue={lead?.phone ?? ""} autoComplete="off" className={INPUT} />
        </Stack>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stack label="Came in by (optional)">
          <select name="source" defaultValue={lead?.source ?? ""} className={INPUT}>
            <option value="">Not set</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Stack>
        <Stack label="Deal value, USD (optional)">
          <input name="value" inputMode="decimal" maxLength={14} defaultValue={lead?.value ?? ""} placeholder="2500" className={MONO_INPUT} />
        </Stack>
      </div>
      <Stack label="Follow-up date (optional)">
        <input name="followUpDate" type="date" defaultValue={lead?.followUpDate ?? ""} className={INPUT} />
      </Stack>
      <Stack label="Notes (optional)">
        <textarea name="notes" rows={3} maxLength={5000} defaultValue={lead?.notes ?? ""} className={TEXTAREA} />
      </Stack>
    </div>
  );
}

export default async function GrowthPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireOwner();
  const params = await searchParams;
  const { today, leads, summary: s, dueNow } = await getGrowthOverview(actor);
  const open = sortOpen(leads);
  const closed = leads.filter((l) => !isOpen(l));
  const adding = first(params.add) === "1";
  const leadId = first(params.lead);
  const selected = leadId ? leads.find((l) => l.id === leadId) : undefined;
  const maxStage = Math.max(1, ...s.stages.map((x) => x.count));
  const tel = selected ? phoneHref(selected.phone) : null;

  return (
    <>
      <PageTitle title="Growth" sub="Leads, outreach and follow-ups" />
      <div className="flex flex-col gap-5">
        <div className="flex">
          <Link href="/growth?add=1" scroll={false} className={`${BTN_PRIMARY} inline-flex items-center gap-1.5`}>
            <Icon name="add" size={20} />
            Add lead
          </Link>
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

        {closed.length > 0 && (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
              <SectionHead title="Won and lost" count={closed.length} />
              <Icon name="keyboard_arrow_down" size={20} className="mb-2 text-dim transition-transform group-open:rotate-180" />
            </summary>
            <Group>{closed.map((l) => leadRow(l, today))}</Group>
          </details>
        )}
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

          <PanelLabel>Stage</PanelLabel>
          <div className="flex flex-wrap gap-2">
            {STAGES.filter((st) => st !== selected.stage).map((st) => (
              <ActionForm key={st} action={setLeadStageAction} submitLabel={STAGE_LABEL[st]} className="contents" buttonClassName={BTN_SMALL}>
                <input type="hidden" name="id" value={selected.id} />
                <input type="hidden" name="stage" value={st} />
              </ActionForm>
            ))}
          </div>

          <PanelLabel>Follow-up date</PanelLabel>
          <ActionForm key={`fu-${selected.id}-${selected.followUpDate ?? ""}`} action={setLeadFollowUpAction} submitLabel="Save date" className="flex flex-col gap-2" buttonClassName={BTN_SMALL} note="Clear the date and save to remove it.">
            <input type="hidden" name="id" value={selected.id} />
            <input name="followUpDate" type="date" defaultValue={selected.followUpDate ?? ""} aria-label="Follow-up date" className={INPUT} />
          </ActionForm>

          <Fold label="Edit details" icon="edit">
            <ActionForm key={`edit-${selected.id}`} action={updateLeadAction} submitLabel="Save lead" className="flex flex-col gap-3" buttonClassName={BTN_PRIMARY}>
              <input type="hidden" name="id" value={selected.id} />
              <LeadFields lead={selected} />
            </ActionForm>
          </Fold>

          <Fold label="Delete lead" icon="cancel">
            <ActionForm key={`del-${selected.id}`} action={deleteLeadAction} submitLabel="Delete lead" className="flex flex-col gap-3" buttonClassName={BTN_TEXT_RED}>
              <input type="hidden" name="id" value={selected.id} />
              <p className="m-0 text-[13px] leading-[1.45] text-dim">
                This removes the lead for good. To keep a record, move it to Lost instead.
              </p>
              <label className="flex items-center gap-2 text-[14px]">
                <input type="checkbox" name="confirm" value="yes" required className="h-5 w-5" />
                Yes, delete {selected.businessName !== NOT_GIVEN ? selected.businessName : selected.name}
              </label>
            </ActionForm>
          </Fold>
        </Panel>
      )}

      {adding && !selected && (
        <Panel label="New lead" closeHref="/growth">
          <div className="text-[21px] font-semibold leading-tight tracking-[-.01em]">Add lead</div>
          <ActionForm action={createLeadAction} submitLabel="Add lead" className="flex flex-col gap-3" buttonClassName={BTN_PRIMARY}>
            <LeadFields />
          </ActionForm>
          <p className="m-0 text-[12px] leading-[1.45] text-dim">
            New leads start at New lead. A won lead does not become a client by itself; clients come from Stripe.
          </p>
        </Panel>
      )}
    </>
  );
}
