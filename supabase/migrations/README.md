# Migrations

Numbered migrations applied **only** by the Supabase CLI, staging first, and
in production only with the owner's approval for that specific migration
(docs/architecture/05 §4, 07 §4).

`0000_baseline.sql` will record the live production schema exactly, taken
from a read-only schema dump. It has not been created yet.

Never copy or run the old repo's `supabase/schema.sql`, `supabase/seed.sql`,
`supabase-rls.sql` or `scripts/_verify_scratch_schema.sql`.
