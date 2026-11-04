# Luminate OS v2: working rules

Read `docs/architecture/00-overview.md` first. The eight approved SOPs govern
business behaviour. If a change conflicts with an SOP, raise it; never change
policy silently.

## Hard rules
- Never touch production Supabase, Stripe, Resend, Vercel or GitHub Actions for
  QA. Use the staging Supabase project and Stripe test mode with made-up data.
- No deploys, production migrations, key rotations, webhook changes or pushes
  to `main` without the owner's explicit approval for that specific action.
- Only one system may process Stripe webhooks or run each scheduled job at a
  time (docs/architecture/08 §4).
- Never print or commit secrets, keys or client personal data.
- Never copy or run the old repo's `supabase/schema.sql`, `supabase/seed.sql`,
  `supabase-rls.sql` or `scripts/_verify_scratch_schema.sql`.
- Mark anything unverified as unverified. Show unavailable data as unavailable.

## Code rules (docs/architecture/04 §2)
- Pages and route handlers call `src/domains/*/service.ts`; they never query
  the database directly.
- Every service function takes an actor and checks permission first.
- Business rules live in `rules.ts` with unit tests, one implementation each.
- Database changes: additive only while the old app shares the database.

## Before pushing
`npm run check` (typecheck, lint, tests, policy check) and `npm run build`.
