# 14. Stripe webhook (2026-11-06)

v2's own Stripe webhook at `POST /api/webhooks/stripe`. It is a port of the old app's webhook
(`LuminateOS/src/app/api/webhooks/stripe/route.ts`) with the **same business behaviour**, so the live Stripe
endpoint can be moved from the old app to v2 in one step. Code: `src/app/api/webhooks/stripe/route.ts`
(signature check), `src/domains/billing/service.ts` (what each event changes), `rules.ts` (pure rules, unit
tested), `repo.ts` (database), `src/platform/stripe/` (client and the read-only Stripe calls).

## What it records (same tables and values as the old app)

| Event | What changes |
|---|---|
| `customer.created` | A new client (status `onboarding`; placeholders `Unnamed` / `Unknown` / `no-email` for missing values) and its `accounts` parent. A retried delivery creates no second client. |
| `customer.updated` | Fills only blank or placeholder name, contact, email and phone. Never overwrites a value entered by hand. |
| `customer.deleted` | **Archives** the client (`archived_at`); never deletes anything. An earlier archive date is kept. |
| `invoice.payment_succeeded`, `invoice.paid` | One `revenue_events` row per invoice (`paid`, `subscription` or `one_time`, Stripe's own paid time). Lifetime value grows once, any hold is lifted, `past_due` goes back to `active`, `paused` goes back to `active` only if the subscription is live right now, `onboarding` becomes `active` only with a signed or exempt contract, and the billing date is refreshed from the live subscription. A payment for a customer never seen creates the client on the spot. |
| `invoice.payment_failed` | A `failed` row and the client marked `past_due`. A stale failure for an invoice already paid (by our record or by Stripe) is ignored, and a leftover `past_due` is cleared when no failed invoice remains. |
| `charge.succeeded` | A standalone payment (not tied to an invoice: the legacy `charge.invoice` field and InvoicePayments are both checked) recorded once, adding to lifetime value and lifting a hold. |
| `customer.subscription.created`, `.updated` | Monthly price and next billing date. A `paused` client resumes only when the subscription is live according to Stripe right now. |
| `customer.subscription.deleted` | Client `paused`, but only when this was their last live subscription. |
| `subscription_schedule.created`, `.updated` | For a subscription with a future start date: the price (fetched from Stripe if needed) and the start date. A finished or released schedule changes nothing. |

Every other event type is answered 200 and ignored. The live endpoint currently sends 23 types (the 12 above plus these 11:
`invoice.created`, `.deleted`, `.sent`, `.updated`, `.voided`, `.upcoming`, `.payment_action_required`,
`.payment_attempt_required`, `customer.source.updated`, `customer.card.updated`, `customer.bank_account.updated`,
which the old app ignored too).

All of the old race-safety is kept, with a test for each: conditional updates that lose a race cleanly, the
unique `stripe_invoice_id` and `stripe_customer_id` conflicts (23505), the re-checks around a failed payment that
races a paid one, and no double counting when Stripe sends `payment_succeeded` and `paid` together.

## The event ledger (`integration_events`, migration 0007)

One row per Stripe event id: `processing`, `processed`, `failed` or `ignored`, with attempts and a short error.

- A repeated delivery of a processed or ignored event answers `200 {duplicate: true}` and changes nothing.
- An event being processed right now answers `409`; Stripe retries later.
- A failed event, or one stuck in `processing` for over 5 minutes, is taken over (compare-and-set) and processed again.
- A processing error marks the row `failed` and answers `500`, so Stripe retries with backoff (as the old app did).
- Error text in the ledger is generic ("Could not update the client", "Unexpected Error"): never customer data.

Owners can read the ledger (RLS); only the server writes it.

## Deliberate differences from the old app

- **No push notifications.** v2's `activity_alerts` job announces payments and failed payments from
  `revenue_events` within 5 minutes. (The old "Initial build invoice paid" and "taken off hold" wordings are gone.)
- **No `sync_log` rows.** The ledger replaces them. The old app's System status will show its webhook as idle
  after the cutover; that is expected.
- **Test-mode events in production** are ignored when `APP_ENV=production` **or** `VERCEL_ENV=production` (the old app used `VERCEL_ENV` only). Vercel always sets `VERCEL_ENV`, so a missing `APP_ENV` can never let Stripe test data into the real database.
- **Retries repair the client.** If an attempt saved a payment and then failed before updating the client, Stripe's retry of the same event re-applies the client changes (status back to active, hold lifted, billing date). It does not add the amount to the lifetime value a second time, because the failed attempt may already have added it; in that rare case the lifetime value can be one payment short.
- **Body limit 2 MB** (large invoices make large events), `405` for anything but POST, and `503` when Stripe is not configured.

## Settings (Vercel, v2 project)

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | Recommended: a **restricted key** with **read** access only to: Customers, Invoices, Subscriptions (includes subscription items), Prices, and Invoice payments. The webhook never creates or changes anything in Stripe. A full secret key also works. The "Invoice payments" permission name is unverified: if Stripe's restricted-key screen has no such entry, check `charge.succeeded` in the test plan, which is the call most likely to be refused. |
| `STRIPE_WEBHOOK_SECRET` | The **existing live endpoint's signing secret** (Stripe → Developers → Webhooks → the endpoint → Reveal signing secret). It does **not** change when the endpoint's URL is edited. |
| `STRIPE_WEBHOOK_SECRET_TEST` | Optional: the signing secret of a test-mode endpoint. Both secrets are tried, live first. |
| `APP_ENV` | `production` on the production deployment, so test-mode events are ignored there. |

Apply migration `0007_integration_events.sql` before the endpoint points at v2 (without the table every event
answers 500 and Stripe keeps retrying).

## Test plan (Stripe TEST mode, never production data)

1. Use a non-production deployment connected to the **staging** database, or run locally with the staging
   variables and `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (put the `whsec_...` it prints in
   `STRIPE_WEBHOOK_SECRET_TEST`). `STRIPE_SECRET_KEY` there must be a **test-mode** key (`sk_test_...` or a
   restricted `rk_test_...`): with a live key every Stripe lookup fails on test objects and each event answers 500.
2. `stripe trigger customer.created`, `invoice.paid`, `invoice.payment_failed`, `charge.succeeded`,
   `customer.subscription.deleted` (use the same restricted-key permissions you plan for production).
3. Check: a client appears (onboarding), a paid row, `past_due` after the failure, `active` again after a payment,
   `paused` after the last subscription is deleted, and one `integration_events` row per event (`processed`).
4. Re-send an event from the Stripe dashboard: the answer is `200 {duplicate: true}` and nothing changes.

## Cutover (one step, owner approval)

Only one system may receive Stripe events at a time, so the move is a single edit of the **existing** endpoint:

1. v2 deployed with the variables above, and migration 0007 applied to production.
2. Stripe (live) → Developers → Webhooks → the `luminate-os` endpoint → Update details → change the URL from
   `https://luminate-os.vercel.app/api/webhooks/stripe` to `https://www.luminateos.app/api/webhooks/stripe`.
   Keep the events and the signing secret as they are.
3. Watch the endpoint's Recent deliveries (all `2xx`) and `integration_events` rows arriving
   (`select id, type, status, attempts, error from integration_events order by received_at desc limit 20;`).
4. Rollback: edit the URL back. Events Stripe could not deliver are retried for up to 3 days, and the ledger makes
   a retried event safe to apply once.

## Resend invoice (owner button)

On a client's page, each payment that came from a Stripe invoice has a **Resend invoice** button. It asks Stripe to
email that invoice to the client again (`invoices.sendInvoice`); nothing about the invoice itself changes.

- **Key:** a separate restricted key in `STRIPE_INVOICE_KEY` with **Invoices: Write** only. `STRIPE_SECRET_KEY`
  stays read-only for the webhook, so a leak of either key is contained.
- **Checks before sending:** owner only; the invoice must be recorded for that client, and Stripe's invoice must
  belong to that client's Stripe customer; drafts, void and uncollectible invoices are refused; at most 5 sends a
  minute per owner. Every send writes an `invoice.resent` audit row.
- **When Stripe refuses** (for example some automatically charged subscription invoices cannot be emailed by
  hand), the button shows Stripe's reason and the invoice's payment page link to send yourself.
- Not tested against live Stripe: try it first on an invoice you are happy to re-send.

## Unassigned payments (added 2026-11-06)

A successful `charge.succeeded` that has **no Stripe customer** (for example a Payment Link or Checkout set to create a
customer only "if required"), or whose customer is not one of our clients, used to be dropped (the old app did the
same). It is now recorded once as an **unassigned payment**: a `revenue_events` row with `client_id` null, status
`paid`, type `one_time`, keyed by the charge id. No client is created or changed. Charges that belong to an invoice
are still left to `invoice.paid`.

The `activity_alerts` job announces it as "Payment received: $X (no client attached)". It counts in v2's "paid this
month"; the old app's Payments screen skips rows without a client. Stripe shows who paid (the alert does not include
the payer's name or email).
