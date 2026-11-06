// Billing task rows (Today and the client Billing tab): who, how much, when, what to do, and the owner's buttons.
// Nothing here sends anything; "Mark sent" records what the owner already sent.
import Link from "next/link";
import type { BillingTask, Milestone } from "@/domains/renewals/types";
import { formatCents, shortDay } from "@/domains/renewals/rules";
import { ActionForm } from "@/ui/ActionForm";
import { BTN_SMALL, INPUT, Stack } from "@/ui/forms";
import type { IconName } from "@/ui/Icon";
import { Icon } from "@/ui/Icon";
import { IconTile, Pill, type KitTone } from "@/ui/kit";
import { markInvoiceSentAction, markReminderSentAction, markReviewedAction, recordPaymentAction } from "./actions";

const LOOK: Record<Milestone, { icon: IconName; tone: KitTone }> = {
  send_invoice: { icon: "receipt_long", tone: "blue" },
  verify_payment: { icon: "payments", tone: "amber" },
  friendly_reminder: { icon: "mail", tone: "blue" },
  grace_review: { icon: "schedule", tone: "red" },
};
const PRIORITY: Record<BillingTask["priority"], { label: string; tone: KitTone }> = {
  urgent: { label: "Urgent", tone: "red" },
  high: { label: "High", tone: "amber" },
  normal: { label: "Normal", tone: "gray" },
};
const LINK_BTN = `${BTN_SMALL} inline-flex items-center gap-1.5`;

function RecordPayment({ task }: { task: BillingTask }) {
  return (
    <details className="open:w-full">
      <summary className={`${BTN_SMALL} inline-flex cursor-pointer list-none items-center`}>Record payment</summary>
      <ActionForm action={recordPaymentAction} submitLabel="Record payment" className="mt-2 flex flex-col gap-2.5 rounded-xl bg-canvas p-3" buttonClassName={BTN_SMALL}>
        <input type="hidden" name="cycleId" value={task.cycleId} />
        <p className="m-0 text-[12px] leading-[1.45] text-dim">For a payment received outside Stripe (cash, cheque, bank transfer), or a Stripe payment the app did not match. Stripe payments are recorded by themselves.</p>
        <div className="grid grid-cols-2 gap-2.5">
          <Stack label="Amount ($)">
            <input name="amount" inputMode="decimal" defaultValue={(task.amountCents / 100).toFixed(2)} required className={INPUT} autoComplete="off" />
          </Stack>
          <Stack label="Paid on">
            <input name="paidOn" type="date" required className={INPUT} />
          </Stack>
        </div>
        <Stack label="How">
          <select name="method" defaultValue="bank_transfer" className={INPUT}>
            <option value="bank_transfer">Bank transfer</option>
            <option value="check">Cheque</option>
            <option value="cash">Cash</option>
            <option value="stripe">Stripe (not matched)</option>
            <option value="other">Other</option>
          </select>
        </Stack>
        <Stack label="Note (optional)">
          <input name="note" maxLength={500} className={INPUT} autoComplete="off" />
        </Stack>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" name="confirm" value="yes" required /> The payment was received
        </label>
      </ActionForm>
    </details>
  );
}

export function BillingTaskRow({ task, showClient = true }: { task: BillingTask; showClient?: boolean }) {
  const look = LOOK[task.milestone];
  const pr = PRIORITY[task.priority];
  const sentByStripe = task.invoiceSender !== "luminate";
  const sub = [
    showClient ? task.clientName : null,
    formatCents(task.amountCents),
    `${task.overdue ? "was due" : "due"} ${shortDay(task.dueOn)}`,
    `renews ${shortDay(task.cycleDueOn)}`,
  ].filter(Boolean);
  return (
    <div className="border-t border-line px-3.5 py-2.5 first:border-t-0">
      <div className="flex items-center gap-3">
        <IconTile icon={look.icon} tone={look.tone} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium leading-[1.3]">{task.title}</div>
          <div className={`mt-0.5 text-[13px] leading-[1.35] ${task.overdue ? "text-red" : "text-dim"}`}>{sub.join(" · ")}</div>
          {task.invoiceSentAt && <div className="mt-0.5 text-[12px] text-dim">Invoice marked sent {shortDay(task.invoiceSentAt.slice(0, 10))}. Not paid yet.</div>}
          {sentByStripe && task.milestone !== "send_invoice" && (
            <div className="mt-0.5 text-[12px] text-dim">{task.invoiceSender === "stripe_autopay" ? "Stripe autopay" : "Stripe sends the invoice"}: do not send another one.</div>
          )}
        </div>
        <Pill tone={pr.tone}>{pr.label}</Pill>
      </div>
      <div className="mt-2 flex flex-wrap items-start gap-2 pl-[46px]">
        {showClient && (
          <Link href={`/clients/${task.clientId}?tab=billing`} className={LINK_BTN}>
            Open client
          </Link>
        )}
        {task.invoiceHref && (
          <a href={task.invoiceHref} target="_blank" rel="noopener noreferrer" className={LINK_BTN}>
            Open invoice/payment link <Icon name="open_in_new" size={15} />
          </a>
        )}
        {task.milestone === "send_invoice" && !task.invoiceSentAt && (
          <details className="open:w-full">
            <summary className={`${BTN_SMALL} inline-flex cursor-pointer list-none items-center`}>Mark sent</summary>
            <ActionForm action={markInvoiceSentAction} submitLabel="I sent it" className="mt-2 flex flex-col gap-2 rounded-xl bg-canvas p-3" buttonClassName={BTN_SMALL}>
              <input type="hidden" name="cycleId" value={task.cycleId} />
              <Stack label="Link you sent (optional, https)">
                <input name="invoiceUrl" type="url" placeholder="https://invoice.stripe.com/..." maxLength={500} className={INPUT} autoComplete="off" />
              </Stack>
              <p className="m-0 text-[12px] text-dim">Records that you sent it yourself. Nothing is sent from here.</p>
            </ActionForm>
          </details>
        )}
        {task.milestone === "friendly_reminder" && !task.reminderSentAt && (
          <ActionForm action={markReminderSentAction} submitLabel="Mark reminder sent" buttonClassName={BTN_SMALL}>
            <input type="hidden" name="cycleId" value={task.cycleId} />
          </ActionForm>
        )}
        {(task.milestone === "verify_payment" || task.milestone === "grace_review") && (
          <ActionForm action={markReviewedAction} submitLabel={task.milestone === "verify_payment" ? "Mark checked" : "Mark reviewed"} buttonClassName={BTN_SMALL}>
            <input type="hidden" name="actionId" value={task.actionId} />
          </ActionForm>
        )}
        <RecordPayment task={task} />
      </div>
    </div>
  );
}
