# Migrations

Numbered migrations applied **only** by the Supabase CLI, staging first, and
in production only with the owner's approval for that specific migration
(docs/architecture/05 §4, 07 §4).

`0000_baseline.sql` records the live production schema as captured on
2026-11-04, built from read-only catalog queries run by the owner on
production (not a pg_dump). It needs Postgres 17+. Function bodies keep CRLF
line endings exactly as in production, so do not reformat this file.
It has not been applied to staging or production yet.

Never copy or run the old repo's `supabase/schema.sql`, `supabase/seed.sql`,
`supabase-rls.sql` or `scripts/_verify_scratch_schema.sql`.

`0010_bot_writes.sql` and `0011_lead_pipeline.sql` are in the repo and have
not been applied to staging or production. Apply them with the Supabase CLI,
staging first, and production only with the owner's approval for that
migration. 0011 does not change `leads_status_check`. The Won backfill is not
part of either migration. Run it separately, and only as a dry run until the
plan has been checked (`APP_ENV=staging npm run backfill:won -- --dry-run`).
`--apply` also needs `--confirm-url` equal to `NEXT_PUBLIC_SUPABASE_URL`, or
`BACKFILL_ALLOWED_PROJECT_REF` set to that project's ref. It refuses
`APP_ENV=production` and an unset `APP_ENV`.
