// Money domain: the Money page. Read only: stored payments plus Stripe's live subscriptions and open invoices
// (docs/architecture/16-money.md). Nothing here changes Stripe or the database.
import { assertCan } from "@/platform/auth/permissions";
import type { Actor } from "@/platform/auth/types";
import { readDb } from "@/platform/db/server";
import { getStripeConfig } from "@/platform/env";
import { getStripe } from "@/platform/stripe/client";
import { createStripeMoneyReads, type MoneyInvoice, type MoneySubscription, type StripeMoneyReads } from "@/platform/stripe/money-api";
import { getCalendar } from "@/domains/admin/service";
import { buildMoneyOverview } from "./rules";
import * as repo from "./repo";
import type { MoneyOverview, StripeState } from "./types";

export interface MoneyDeps {
  /** null when Stripe is not set up. */
  stripe: StripeMoneyReads | null;
  now: () => Date;
}

/** 70 days back always covers the start of last month. */
const LOOKBACK_MS = 70 * 86_400_000;

export async function getMoneyOverview(actor: Actor, deps?: Partial<MoneyDeps>): Promise<MoneyOverview> {
  assertCan(actor, "money.read");
  const now = (deps?.now ?? (() => new Date()))();
  let stripe: StripeMoneyReads | null;
  if (deps && "stripe" in deps) stripe = deps.stripe ?? null;
  else {
    const config = getStripeConfig();
    stripe = config ? createStripeMoneyReads(getStripe(config.secretKey)) : null;
  }

  const db = await readDb(actor);
  const [calendar, payments, clients, lastEventAt, live] = await Promise.all([
    getCalendar(actor),
    repo.paidPaymentsSince(db, new Date(now.getTime() - LOOKBACK_MS).toISOString()),
    repo.listMoneyClients(db),
    repo.lastStripeEventAt(db),
    readStripe(stripe),
  ]);

  return buildMoneyOverview({ now, timeZone: calendar.timeZone, payments, clients, lastEventAt, ...live });
}

/** Both Stripe lists, or "unavailable" when either fails (a half answer would understate what is owed). */
async function readStripe(stripe: StripeMoneyReads | null): Promise<{ stripeState: StripeState; subscriptions: MoneySubscription[]; invoices: MoneyInvoice[] }> {
  if (!stripe) return { stripeState: "not_set_up", subscriptions: [], invoices: [] };
  try {
    const [subscriptions, invoices] = await Promise.all([stripe.listSubscriptions(), stripe.listOpenInvoices()]);
    return { stripeState: "live", subscriptions, invoices };
  } catch (e) {
    // No Stripe message in the log: it can name a customer. The error's type is enough to tell a key problem.
    console.warn("money: Stripe read failed", { kind: (e as { type?: string })?.type ?? (e as { name?: string })?.name ?? "error" });
    return { stripeState: "unavailable", subscriptions: [], invoices: [] };
  }
}
