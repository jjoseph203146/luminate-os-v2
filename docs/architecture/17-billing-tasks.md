# 17. SOP billing tasks (2026-11-06)

Recurring billing tasks for each client's care-plan renewal, following the late-payment ladder (doc 06 §6), up to
Day +7 only. Built from the owner's "SOP-Based Billing Task Automation" brief. **Nothing is sent automatically:** the
owner sends every invoice and reminder and records it in the app. Nothing here writes to Stripe.

Code: `src/domains/renewals/` (rules with tests, service, repo, schemas, types), job `billing_tasks` in
`src/platform/jobs/registry.ts`, UI in `src/app/(internal)/_billing/` (Today's Billing group and the client Billing
tab). Migration `0009_billing_tasks.sql`. Permissions: `billing.tasks` (owner), `billing.schedule` (the job).

## The schedule

Day 0 is the renewal date. Days are calendar days in **America/New_York** (fixed for billing, whatever the business
calendar's zone).

| Day | Task | Priority | Created when |
| --- | --- | --- | --- |
| −5 | Send renewal invoice/payment link | normal | the owner sends the invoice (see "One sender") and it is not marked sent |
| 0 | Verify renewal payment | high | unpaid |
| +3 | Send friendly payment reminder | high | unpaid and no reminder marked sent |
| +7 | Review expired payment grace period | urgent | unpaid |

Day +7 is a review only: it never suspends care or takes a site offline. Later ladder steps (+14, +28, +30) are not
built in this phase.

**Anniversary and short months.** Each schedule stores the anniversary day (1–31). In a shorter month the renewal is
the month's last day (31st → Apr 30, Feb 28/29), and the next renewal goes back to the real day (Feb 28 → Mar 31).
The same rule (`monthDayClamped`) now also fixes the Stripe webhook's next billing date, which used to spill a 31st
into the next month (Feb 31 → Mar 3).

**Schedules follow Stripe (no setup).** Each run first reads every Stripe subscription (read-only key, one paged
call, the same read as the Money page) and keeps each client's schedule in step with it: the monthly price, the
renewal day (the UTC day of Stripe's billing anchor, which is how Stripe itself bills), the start date, who sends the
invoice (`charge_automatically` → Stripe autopay, `send_invoice` → Stripe emails the invoice), paused
(`pause_collection`) and ended (the schedule is cancelled, history kept). A client's schedule follows its live
subscription in the best state (active, then past due/unpaid, then trialing, then paused), newest first; canceled and
never-completed (`incomplete`) subscriptions are ignored. A new schedule creates tasks from the day it appeared, so
past renewals do not flood in. If Stripe cannot be read, the run fails visibly and the existing schedules still get
their tasks. The owner can take a schedule over by hand (Billing tab, for a client who pays another way or to
override Stripe); the job then leaves it alone until "Follow Stripe again". Pausing or cancelling a Stripe-managed
schedule is done in Stripe.

**One sender.** The schedule says who sends the renewal invoice: the owner from Luminate OS, Stripe (emailed
invoice) or Stripe autopay. Only the first gets a Day −5 "send" task, and "Mark sent" is refused for the others, so
a client is never asked to pay twice. "Mark sent" is recorded once per renewal; a second attempt is refused.

## Data (migration 0009, additive)

- `care_agreements`: the client's billing schedule (a subset of the doc 05 design): plan name, monthly price,
  anniversary day, start date, status (active / paused / cancelled), invoice sender, optional payment link,
  `source` (`stripe`: kept in step by the job; `manual`: set by the owner), `stripe_subscription_id`, and
  `tasks_from` (the date the schedule was created or resumed). At most one not-cancelled schedule per client.
- `billing_cycles`: one per client per renewal date (unique). Amount, plan and sender are **copied** at creation, so
  later price or date changes never rewrite history. Holds payment state (`open` / `paid` / `paid_manual` /
  `cancelled`), the verified payment it was matched to, sent and reminder timestamps (and who), and manual payments.
- `billing_actions`: one per cycle per milestone, with the stable key `billing:<client>:<renewal date>:<milestone>`
  (unique), the linked task, status (`open` / `done` / `resolved` / `cancelled`), outcome, and who closed it and when.
- Tasks are ordinary `internal_work_items` (source `internal`, `source_reference` = the billing key), so they show on
  Work too. A new partial unique index on `source_reference` for billing keys makes a duplicate task impossible.
- Row-level security: owner only, like every other owner table. Nobody can delete these rows. Every owner action
  also writes an `audit_log` row (no notes or contact details in it).

## The job (`billing_tasks`)

Runs from the existing authenticated scheduler (`/api/jobs/tick`, `CRON_SECRET`) **every 60 minutes**. Each step is
idempotent, so the hourly pass is effectively a daily schedule: a milestone is created once, on its New York date
(soon after midnight there). A once-a-day window would line up with midnight UTC (evening in New York).

Each run:
0. brings Stripe-managed schedules in step with Stripe (above);
1. creates the cycles due by today (Day −5 or later): renewals on or after the plan's start whose Day +7 is not
   before `tasks_from`, within 75 days back (so missed runs catch up);
2. settles open cycles from **verified payments** (`revenue_events` with status paid, written only by the signed Stripe
   webhook or Sync from Stripe): the earliest unused payment paid from 7 days before the renewal up to 7 days before
   the next one that is a subscription payment or exactly the renewal amount. A sent invoice is never proof of payment;
3. closes tasks that no longer apply: `resolved` when paid, `cancelled` when the plan is paused or cancelled or the
   client archived (or the Stripe subscription ended: client status paused); a task ticked off on Work becomes `done`;
4. creates the milestone tasks that are due for unpaid cycles (all of them after missed runs; overdue ones stay open
   until resolved);
5. repairs half-done links (an action without its task, or a closed action whose task is still open).

A failing step does not stop the others; the run then fails as a whole (stored in `job_runs`, shown in Automations,
retried up to three times with backoff, and again next hour). Today shows a red notice when the job is failing, has
not succeeded for 3 hours, has never run, or is switched off.

## Owner actions

On Today (Billing group) and in the client's Billing tab:
- **Open client**, **Open invoice/payment link** (the link recorded when sent, else the schedule's payment link, else
  the client's Stripe customer page);
- **Mark sent** (optional link), **Mark reminder sent**, **Mark checked / Mark reviewed** (Day 0 / +7; does not mark
  paid);
- **Record payment** (amount, date, method, note, confirmation): for money received outside Stripe, or a Stripe
  payment the app did not match. It settles the renewal and closes its tasks. It is kept on the renewal and is
  **not** added to `revenue_events` (Stripe-derived records stay Stripe's; SOP 5.1 "no second ledger"), so it is not
  in the Money page's Collected figure.
- Billing tab: shows the schedule Stripe implies. **Manage by hand** (a form prefilled from the schedule or the
  client record) takes it over; a hand-managed schedule can be **paused** (cancels open tasks at once), **resumed**
  (tasks restart from today), **cancelled** (with a tick; renewals not reached are cancelled, ones already due stay
  owed) or handed back with **Follow Stripe again**.

## Before it does anything (owner)

Apply migration 0009 (staging first, then production with approval). Until then Today and the Billing tab say billing
tasks are unavailable, and the job fails visibly. Nothing else: within the hour the job creates each client's schedule
from their Stripe subscription. Today lists paying clients for whom no live Stripe subscription was found (set those
up by hand if they pay another way).

## Tests

`src/domains/renewals/rules.test.ts` and `service.test.ts`: anniversaries, short months and leap years, year
boundaries, Day −5 creation, paid / unpaid transitions, payment matching windows and New York dates, missed runs,
idempotent retries and a failed step, Work-page completion, price changes keeping history, pause / resume / cancel,
Mark sent once, one-sender refusal, manual payments and validation, and Today's task fields.
