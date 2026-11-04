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
