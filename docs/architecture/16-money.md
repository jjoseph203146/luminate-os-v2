# 16. Money page (2026-11-06)

The Money destination (`/money`, fifth item in the sidebar and the phone's bottom bar), built from the
"Luminate OS mobile prototype 4" Money screen. Read only: it changes nothing in Stripe or the database.

Code: `src/domains/money/` (service, rules with tests, repo, types), Stripe reads in
`src/platform/stripe/money-api.ts`, layout in `src/app/(internal)/money/MoneyView.tsx`.
Permission `money.read`, owner only (the AI connector does not have it).

## Where each figure comes from (doc 06 §7)

| Figure | Source | Rule |
| --- | --- | --- |
| Collected · month | Stored payments (`revenue_events`, status paid) | Sum of payments whose `paid_at` falls in this month in the business time zone. Unassigned payments count. **Refunds are not subtracted yet** (not recorded until P6); the page says so. |
| Active MRR | Stripe, live | [DECIDED] paid-only: monthly fee of every subscription that is not paused, in a live status, whose **latest (current-period) invoice is paid** with money. Yearly prices are divided by 12. This reads the current-period invoice from Stripe directly, so the `paid_at`-window approximation in 06 §7 is not needed. |
| Past due | Stripe open invoices | Amount still owed on open invoices more than 7 days past due. |
| In grace period | Stripe open invoices | Open invoices 0–7 days past due (a failed autopay counts as unpaid). The card shows "day X of 7" when one account is in grace. |
| Paused | Stripe + clients | Subscriptions paused in Stripe (`pause_collection`), plus clients the webhook marked paused (subscription ended) with no live subscription. Never in MRR or collected. |
| Monthly goal | Code constant | $10K a month (`MONTHLY_GOAL_CENTS`, from the design). The bar is this month's collected amount against it; the line under it gives last month's total and the share of the goal MRR covers. |
| Upcoming payments | Stripe | Renewals of live subscriptions in the next 14 days (Autopay = `charge_automatically`, Invoice = `send_invoice`; none for subscriptions set to cancel at period end) and open invoices not yet due. Amounts are the price before discounts and tax. |
| Needs attention | Stripe + clients | Past due first, then grace, then paused. |

Due date of an open invoice: its `due_date` (sent invoices), else when it was finalized (autopay is charged then).
Days are counted in the business time zone. Day 0 is the due date; days 1–7 grace; day 8 on past due (06 §6).

Rows open the client's Billing tab when the Stripe customer is a client; otherwise the row shows Stripe's
customer name, or "Stripe customer (no client)".

## When Stripe is not available

Two Stripe calls per visit (subscriptions with their customer and latest invoice expanded; open invoices with
their customer), never cached. If either fails, or `STRIPE_SECRET_KEY` is not set, every Stripe figure shows
**Unavailable** with the reason; Collected and last month still show (they come from stored payments). Nothing is
estimated. The header shows the source and when the webhook last processed an event.

Key permissions: the same read-only `STRIPE_SECRET_KEY` (Subscriptions, Invoices, Customers read). Unverified
against the production key until the page is opened there.

## Not built (from the same prototype)

The client Billing tab states (billing settings with "invoice sent by", held invoices, the Day +14/+28 notices and
"Record approval & deactivate") need care agreements and the late-payment ladder (P4); not part of this page.
