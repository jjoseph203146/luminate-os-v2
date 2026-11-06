-- 0006_site_checks_job.sql
-- Registers the scheduled job that checks every client website (up/down, response time, security headers,
-- SSL and domain expiry, broken links) and records the result.
--
-- ADDITIVE ONLY: one new row in the v2 `jobs` table. No table, column, policy or grant is created or
-- changed. The job writes the SAME tables the old app's checker wrote (site_monitors, site_monitor_checks),
-- which the service role can already write, so the old client portal keeps working.
-- Safe to run twice.
--
-- Run order: 0005 first, then this file. Staging first, then production with the owner's approval.
-- Until this row exists the job never runs, so deploying the code first is harmless.
--
-- ONE OWNER PER JOB (CLAUDE.md): enable this only in the same step that stops the old scanner
-- (disable .github/workflows/site-check.yml in the old repo and any cron-job.org site-check job).
-- See docs/architecture/13-site-monitoring.md.
--
-- ROLLBACK: update public.jobs set enabled = false where key = 'site_checks';

insert into public.jobs (key, name, description, interval_minutes)
values ('site_checks', 'Site checks',
        'Checks every client website that is not archived or paused: whether it is up, how fast it answers, eight security checks, SSL and domain expiry, and broken links on the homepage. Records the result and a history row for each check.', 10)
on conflict (key) do nothing;
