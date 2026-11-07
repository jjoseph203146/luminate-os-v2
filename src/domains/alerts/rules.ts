// Pure rules for the activity alerts: payments, and client requests and comments from the portal.
// No database, no clock: `now` is always passed in.
import { clip } from "@/domains/notifications/rules";
import type { PushPayload } from "@/platform/push/send";
import type { AlertStateRow, ClientInfo, NoticeRow, PaymentRow, RequestInfo } from "./types";

/** Only rows this recent are looked at. Anything older was either announced long ago or is old news. */
export const WINDOW_DAYS = 14;
/** At most this many pushes in one run, so a bulk import can never flood the phone. The rest wait for the next run. */
export const MAX_SENDS_PER_RUN = 10;
/** Marks that the first run has recorded what already existed (silently). */
export const SEEDED_KEY = "activity:seeded";

export const paymentKey = (id: string) => `payment:${id}`;
export const noticeKey = (id: string) => `notif:${id}`;

export interface PlannedAlert {
  /** alert_state key. */
  key: string;
  /** State to store after the alert is sent (or after silently recording it). */
  state: string;
  /** Null: record without telling the owner. */
  payload: PushPayload | null;
  /** Sort key: oldest first. */
  at: string;
}

export interface ActivityInput {
  payments: PaymentRow[];
  notices: NoticeRow[];
  clients: Record<string, ClientInfo>;
  requests: Record<string, RequestInfo>;
  previous: AlertStateRow[];
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatMoney = (amount: number) => money.format(amount);

const stateOf = (rows: AlertStateRow[], key: string) => rows.find((r) => r.key === key)?.state ?? null;
const nameOf = (clients: Record<string, ClientInfo>, id: string | null) => (id ? (clients[id]?.name ?? "A client") : "A client");

function paymentAlert(p: PaymentRow, clients: Record<string, ClientInfo>): PushPayload | null {
  if (p.clientId === null) {
    // An unassigned payment (no Stripe customer, e.g. a Payment Link): say so plainly; Stripe shows who paid.
    if (p.status !== "paid") return null;
    return {
      title: clip(`Payment received: ${formatMoney(p.amount)} (no client attached)`, 70),
      body: clip("Paid through a payment link or checkout without a Stripe customer. Open Stripe to see who paid.", 120),
      url: "/",
      tag: `payment-${p.id}`,
    };
  }
  const who = nameOf(clients, p.clientId);
  const link = p.clientId ? `/clients/${p.clientId}` : "/";
  if (p.status === "paid") {
    return { title: clip(`Payment received: ${who}`, 70), body: formatMoney(p.amount), url: link, tag: `payment-${p.id}` };
  }
  // A client on hold (you are letting Stripe keep retrying) or archived gets no failed-payment alert, as in the old app.
  const client = p.clientId ? clients[p.clientId] : undefined;
  if (client && (client.archived || client.onHold)) return null;
  return { title: clip(`Payment failed: ${who}`, 70), body: clip(`${formatMoney(p.amount)} did not go through. Follow up.`, 120), url: link, tag: `payment-${p.id}` };
}

function noticeAlert(n: NoticeRow, clients: Record<string, ClientInfo>, requests: Record<string, RequestInfo>): PushPayload | null {
  const who = nameOf(clients, n.clientId);
  const req = n.requestId ? requests[n.requestId] : undefined;
  const link = n.requestId ? `/work?view=requests&request=${n.requestId}` : "/work?view=requests";
  const what = req ? `${req.displayId} ${req.title}` : "a request";
  if (n.type === "new_request") return { title: clip(`New request: ${who}`, 70), body: clip(what, 120), url: link, tag: `request-${n.requestId ?? n.id}` };
  if (n.type === "new_comment") return { title: clip(`New comment: ${who}`, 70), body: clip(`On ${what}`, 120), url: link, tag: `comment-${n.id}` };
  return null;
}

/**
 * Decides what to tell the owner.
 * - A payment is announced once per status: "paid" and "failed" each once (a failed payment that is
 *   later paid announces both).
 * - A client request or comment (portal notification row) is announced once. Rows already marked read
 *   in the old console are recorded without a push.
 * - The very first run records everything that already exists silently, so turning this on never replays history.
 * - A payment paid more than WINDOW_DAYS ago (an old payment Sync from Stripe just filled in) is recorded silently:
 *   it is not news.
 * - Capped at MAX_SENDS_PER_RUN pushes; extras are left for the next run.
 */
export function planActivityAlerts(input: ActivityInput, now: Date): PlannedAlert[] {
  const oldPaid = (paidAt: string | null) => paidAt !== null && now.getTime() - Date.parse(paidAt) > WINDOW_DAYS * 86_400_000;
  const seeded = stateOf(input.previous, SEEDED_KEY) !== null;
  const out: PlannedAlert[] = [];

  for (const p of input.payments) {
    if (p.status !== "paid" && p.status !== "failed") continue;
    const key = paymentKey(p.id);
    if (stateOf(input.previous, key) === p.status) continue;
    const silent = !seeded || (p.status === "paid" && oldPaid(p.paidAt));
    out.push({ key, state: p.status, payload: silent ? null : paymentAlert(p, input.clients), at: p.status === "paid" ? (p.paidAt ?? p.createdAt) : p.createdAt });
  }

  for (const n of input.notices) {
    if (n.type !== "new_request" && n.type !== "new_comment") continue;
    const key = noticeKey(n.id);
    if (stateOf(input.previous, key) !== null) continue;
    const payload = seeded && !n.read ? noticeAlert(n, input.clients, input.requests) : null;
    out.push({ key, state: "sent", payload, at: n.createdAt });
  }

  out.sort((a, b) => a.at.localeCompare(b.at));

  // Cap the pushes: later ones are left out entirely (no state saved), so the next run picks them up.
  let sends = 0;
  const capped = out.filter((a) => {
    if (!a.payload) return true;
    sends += 1;
    return sends <= MAX_SENDS_PER_RUN;
  });

  if (!seeded) capped.push({ key: SEEDED_KEY, state: "yes", payload: null, at: "" });
  return capped;
}
