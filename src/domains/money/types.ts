// What the Money page shows. Amounts are in cents; dates are local (business time zone) YYYY-MM-DD.

/** "live": Stripe answered just now. "unavailable": Stripe did not answer. "not_set_up": no STRIPE_SECRET_KEY. */
export type StripeState = "live" | "unavailable" | "not_set_up";

export interface UpcomingPayment {
  key: string;
  name: string;
  clientId: string | null;
  date: string;
  kind: "autopay" | "invoice";
  cents: number;
}

export interface AttentionItem {
  key: string;
  name: string;
  clientId: string | null;
  kind: "past_due" | "grace" | "paused";
  cents: number;
  detail: string;
}

export interface MoneyOverview {
  stripe: StripeState;
  /** When the last Stripe webhook event was processed, or null if never. */
  lastEventAt: string | null;
  collected: { cents: number; monthShort: string; range: string };
  lastMonth: { cents: number; monthName: string };
  goal: { cents: number; percent: number; mrrPercent: number | null };
  /** null when Stripe is not live: these come from Stripe and are never guessed. */
  mrr: { cents: number; subscriptions: number } | null;
  pastDue: { cents: number; accounts: number } | null;
  grace: { cents: number; accounts: number; day: number | null } | null;
  paused: { cents: number; accounts: number } | null;
  upcoming: UpcomingPayment[] | null;
  attention: AttentionItem[] | null;
}

/** A client as the Money page needs it (to name Stripe customers and find paused ones). */
export interface MoneyClient {
  id: string;
  name: string;
  stripeCustomerId: string | null;
  status: string;
  subscriptionPrice: number;
  archived: boolean;
}
