-- 0008_visual_checks_job.sql
-- Registers the scheduled speed and visual check: for each client website (not archived, not paused) a Google
-- PageSpeed Insights run (Lighthouse, mobile): speed score, LCP, CLS, TBT and a screenshot, compared with the
-- previous screenshot to show how much of the page changed.
--
-- ADDITIVE ONLY: one new row in the v2 `jobs` table. No table, column, policy or grant is created or
-- changed. The job writes the SAME table and bucket the old app's visual check wrote (site_visual_checks, and
-- the private 'site-screenshots' bucket), so the old console and the client portal keep working.
-- Safe to run twice.
--
-- Run order: 0006 first, then this file. Staging first, then production with the owner's approval.
-- Until this row exists the job never runs, so deploying the code first is harmless.
--
-- ONE OWNER PER JOB (CLAUDE.md): enable this only in the same step that stops the old visual check
-- (remove the schedule from .github/workflows/visual-check.yml in the old repo).
-- See docs/architecture/13-site-monitoring.md.
--
-- ROLLBACK: update public.jobs set enabled = false where key = 'visual_checks';

insert into public.jobs (key, name, description, interval_minutes)
values ('visual_checks', 'Speed and visual checks',
        'Runs Google PageSpeed Insights (mobile) on each client website once every 12 hours, at most two sites per run: speed score, largest contentful paint, layout shift, blocking time, and a screenshot compared with the previous one.', 15)
on conflict (key) do nothing;
