-- 0005_activity_alerts_job.sql
-- Registers the scheduled job that tells the owner about payments and client requests and comments.
--
-- ADDITIVE ONLY: one new row in the v2 `jobs` table. No table, column, policy or grant is created or
-- changed, and the old app does not read `jobs`. It uses `alert_state` (created in 0004) to remember what
-- it has announced. Safe to run twice.
--
-- Run order: 0004 first, then this file. Staging first, then production with the owner's approval.
-- Until this row exists the job never runs, so deploying the code first is harmless.
--
-- ROLLBACK: update public.jobs set enabled = false where key = 'activity_alerts';

insert into public.jobs (key, name, description, interval_minutes)
values ('activity_alerts', 'Payment and client activity alerts',
        'Reads the payments recorded by the Stripe webhook and the requests and comments clients send from the portal, and sends a push notification once for each. The first run only records what already exists, so nothing old is announced.', 5)
on conflict (key) do nothing;
