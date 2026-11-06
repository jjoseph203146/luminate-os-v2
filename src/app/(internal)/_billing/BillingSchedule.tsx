// The client Billing tab's billing section: the renewal schedule (set up, edit, pause, resume, cancel), open billing
// tasks, and past renewals with how each was settled.
import type { ClientBilling, InvoiceSender } from "@/domains/renewals/types";
import { formatCents, shortDay } from "@/domains/renewals/rules";
import { ActionForm } from "@/ui/ActionForm";
import { BTN_PRIMARY, BTN_SMALL, INPUT, Stack } from "@/ui/forms";
import { EmptyNote, Group, ListRow, SectionHead, type KitTone } from "@/ui/kit";
import { BillingTaskRow } from "./BillingTasks";
import { followStripeAction, saveScheduleAction, scheduleStatusAction } from "./actions";

const SENDER_SHORT: Record<InvoiceSender, string> = {
  luminate: "you send the invoice",
  stripe_invoice: "Stripe emails the invoice",
  stripe_autopay: "Stripe autopay",
};

const SENDER_LABEL: Record<InvoiceSender, string> = {
  luminate: "You, from Luminate OS (a Day -5 task reminds you)",
  stripe_invoice: "Stripe emails the invoice",
  stripe_autopay: "Stripe autopay (card charged)",
};

const CYCLE: Record<string, { label: string; tone: KitTone }> = {
  open: { label: "Unpaid", tone: "amber" },
  paid: { label: "Paid", tone: "green" },
  paid_manual: { label: "Paid (recorded)", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
};

const METHOD: Record<string, string> = { cash: "cash", check: "cheque", bank_transfer: "bank transfer", stripe: "Stripe", other: "other" };

export function BillingSchedule({ clientId, billing, archived }: { clientId: string; billing: ClientBilling; archived: boolean }) {
  if (!billing.available) {
    return (
      <section className="rounded-[14px] border border-line bg-surface px-4 py-3.5 text-[13px] text-dim">
        Billing schedule unavailable: the billing tables could not be read (database migration 0009 may not be applied).
      </section>
    );
  }
  const a = billing.agreement;
  const s = billing.suggestion;
  const followsStripe = a?.source === "stripe";
  const renews = a ? `renews on day ${a.anniversaryDay}${a.anniversaryDay > 28 ? " (the last day in shorter months)" : ""}` : "";
  const state = !a
    ? billing.hasStripeCustomer
      ? "No live Stripe subscription found for this client, so there are no billing tasks. The billing job checks Stripe every hour; a new subscription is picked up by itself."
      : "This client has no Stripe customer, so there are no billing tasks. If they pay another way, set up a schedule by hand below."
    : followsStripe
      ? `Follows the Stripe subscription: ${formatCents(a.monthlyPriceCents)} a month, ${renews}, ${SENDER_SHORT[a.invoiceSender]}${a.status === "paused" ? ", paused in Stripe" : `, next renewal ${billing.nextRenewal ? shortDay(billing.nextRenewal) : "unknown"}`}. Changes made in Stripe (price, pause, cancel) apply here within the hour.`
      : `Managed by hand: ${formatCents(a.monthlyPriceCents)} a month, ${renews}, ${SENDER_SHORT[a.invoiceSender]}${a.status === "paused" ? ", paused" : `, next renewal ${billing.nextRenewal ? shortDay(billing.nextRenewal) : "unknown"}`}.`;

  const form = (
    <ActionForm action={saveScheduleAction} submitLabel={a && !followsStripe ? "Save schedule" : "Save and manage by hand"} className="flex flex-col gap-3" buttonClassName={BTN_PRIMARY}>
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Stack label="Plan">
          <input name="planName" defaultValue={a?.planName ?? s.planName ?? ""} placeholder="Essential" maxLength={80} className={INPUT} autoComplete="off" />
        </Stack>
        <Stack label="Monthly price ($)">
          <input name="monthlyPrice" inputMode="decimal" required defaultValue={((a?.monthlyPriceCents ?? s.monthlyPriceCents) / 100 || "").toString()} className={INPUT} autoComplete="off" />
        </Stack>
        <Stack label="Renews on day (1-31; short months use the last day)">
          <input name="anniversaryDay" type="number" min={1} max={31} required defaultValue={a?.anniversaryDay ?? s.anniversaryDay ?? ""} className={INPUT} />
        </Stack>
        <Stack label="Plan started">
          <input name="startsOn" type="date" required defaultValue={a?.startsOn ?? s.startsOn ?? ""} className={INPUT} />
        </Stack>
      </div>
      <Stack label="Who sends the renewal invoice (one sender only)">
        <select name="invoiceSender" defaultValue={a?.invoiceSender ?? "luminate"} className={INPUT}>
          {(Object.keys(SENDER_LABEL) as InvoiceSender[]).map((k) => (
            <option key={k} value={k}>
              {SENDER_LABEL[k]}
            </option>
          ))}
        </select>
      </Stack>
      <Stack label="Payment link (optional, https; opened by “Open invoice/payment link”)">
        <input name="paymentLinkUrl" type="url" defaultValue={a?.paymentLinkUrl ?? ""} placeholder="https://buy.stripe.com/..." maxLength={500} className={INPUT} autoComplete="off" />
      </Stack>
      <p className="m-0 text-[12px] text-dim">
        {followsStripe || !a ? "Saving takes this schedule over by hand: the billing job then stops changing it from Stripe. " : ""}Changes apply from the next renewal created. Renewals already created keep their amount and date.
      </p>
    </ActionForm>
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-line bg-surface px-4 py-3.5">
        <div>
          <h3 className="m-0 text-[14px] font-semibold">Billing schedule</h3>
          <p className="m-0 mt-1 text-[13px] leading-normal text-dim">{state}</p>
          <p className="m-0 mt-1 text-[12px] leading-normal text-dim">
            Tasks follow the SOP: Day -5 send the renewal invoice (only when you send it), Day 0 verify payment, Day +3 friendly reminder, Day +7 review the grace period (no suspension). Nothing is sent automatically.
          </p>
        </div>
        {archived ? (
          <p className="m-0 text-[13px] text-dim">This client is archived. Restore the client to set up billing.</p>
        ) : a && !followsStripe ? (
          form
        ) : (
          <details>
            <summary className={`${BTN_SMALL} inline-flex cursor-pointer list-none items-center`}>{a ? "Manage by hand instead…" : "Set up by hand…"}</summary>
            <div className="mt-3">{form}</div>
          </details>
        )}
        {a && !followsStripe && (
          <div className="flex flex-wrap items-start gap-2 border-t border-line pt-3">
            {billing.hasStripeCustomer && (
              <ActionForm action={followStripeAction} submitLabel="Follow Stripe again" buttonClassName={BTN_SMALL}>
                <input type="hidden" name="clientId" value={clientId} />
              </ActionForm>
            )}
            <ActionForm action={scheduleStatusAction} submitLabel={a.status === "paused" ? "Resume billing" : "Pause billing"} buttonClassName={BTN_SMALL}>
              <input type="hidden" name="clientId" value={clientId} />
              <input type="hidden" name="change" value={a.status === "paused" ? "resume" : "pause"} />
            </ActionForm>
            <details>
              <summary className={`${BTN_SMALL} inline-flex cursor-pointer list-none items-center text-red`}>Cancel billing…</summary>
              <ActionForm action={scheduleStatusAction} submitLabel="Cancel billing" className="mt-2 flex flex-col gap-2 rounded-xl bg-canvas p-3" buttonClassName={BTN_SMALL}>
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="change" value="cancel" />
                <p className="m-0 text-[12px] text-dim">Stops billing tasks for good. Renewals already due stay as owed; history is kept.</p>
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" name="confirm" value="yes" required /> Yes, cancel billing for this client
                </label>
              </ActionForm>
            </details>
          </div>
        )}
      </section>

      <section>
        <SectionHead title="Billing tasks" count={billing.tasks.length} />
        <Group>
          {billing.tasks.length === 0 ? <EmptyNote>No open billing tasks.</EmptyNote> : billing.tasks.map((t) => <BillingTaskRow key={t.actionId} task={t} showClient={false} />)}
        </Group>
      </section>

      <section>
        <SectionHead title="Renewals" />
        <Group>
          {billing.cycles.length === 0 ? (
            <EmptyNote>No renewals yet. They are created 5 days before each renewal date.</EmptyNote>
          ) : (
            billing.cycles.map((c) => {
              const look = CYCLE[c.status] ?? CYCLE.open!;
              const how =
                c.status === "paid"
                  ? `paid ${c.paidAt ? shortDay(c.paidAt.slice(0, 10)) : ""} · verified Stripe payment`
                  : c.status === "paid_manual"
                    ? `recorded ${c.manualAmountCents !== null ? formatCents(c.manualAmountCents) : ""} by ${METHOD[c.manualMethod ?? "other"] ?? "other"}${c.manualNote ? ` · ${c.manualNote}` : ""}`
                    : c.status === "cancelled"
                      ? "cancelled"
                      : [c.invoiceSentAt ? `invoice sent ${shortDay(c.invoiceSentAt.slice(0, 10))}` : null, c.reminderSentAt ? `reminder sent ${shortDay(c.reminderSentAt.slice(0, 10))}` : null].filter(Boolean).join(" · ") || "not paid yet";
              return (
                <ListRow
                  key={c.id}
                  icon={c.status === "open" ? "schedule" : c.status === "cancelled" ? "block" : "payments"}
                  tone={look.tone}
                  title={`${shortDay(c.dueOn)} ${c.dueOn.slice(0, 4)} · ${formatCents(c.amountCents)}`}
                  sub={`${c.planName ?? "Care plan"} · ${how}`}
                  pill={look.label}
                  pillTone={look.tone}
                  minH="min-h-[60px]"
                />
              );
            })
          )}
        </Group>
      </section>
    </div>
  );
}
