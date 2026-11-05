# 10 — Phase 2 (Foundation): decisions and setup

## Decisions (owner, 2026-11-04)

| Topic | Decision |
|---|---|
| Role mapping | `profiles.role = 'admin'` is the **owner**. `client` users have no access to this app yet. No role changes in the UI. |
| Business calendar | Every day is a working day **except Saturday**. Time zone `America/New_York` and an **empty holiday list** are assumptions, not confirmed. Edit in Settings → Business calendar. |
| MFA | Built, **off by default** (`AUTH_REQUIRE_MFA=false`). ~~Always on when `APP_ENV=production`~~ **Changed 2026-11-05 (owner decision): off everywhere, including production, until `AUTH_REQUIRE_MFA=true` is set.** This departs from SOP 8 §4.1 and risk R3; turn it back on before any contractor or client has access. Authenticator-app (TOTP) MFA is available on Supabase's free tier; phone MFA is not used. Owners are encouraged to enroll two authenticators for recovery. |
| Follow-up reminders | Tasks in the app **and** Google Calendar events. Calendar sync is the integrations phase; Phase 2 stores nothing for it. |
| Jobs trigger | Undecided. `POST/GET /api/jobs/tick` with `Authorization: Bearer $CRON_SECRET` works with Vercel Cron or any scheduler. |
| Libraries | `@supabase/supabase-js`, `@supabase/ssr`, `zod` (pinned). No Tailwind/shadcn: pages are unstyled until the owner's design arrives. |
| Seed data | Catalog and care plans come from the Business Playbook and Monthly Client Care SOP. |

## SOP wording to confirm

The Business Playbook lists "deployment" under Essential and "a concise monthly performance report" for Professional. The Care SOP lists a brief monthly summary for Essential and a **full** monthly report for Professional. The seed uses the Care SOP. Nothing in either SOP was changed.

## Known limits

- A settings change and its audit entry are two writes. If the audit write fails the owner sees an error although the change was saved. A single database function can make them atomic later.
- Login rate limiting is Supabase's built-in limit.
- Types in `src/types/database.ts` for the 8 new tables were written by hand to match the migration. Regenerate them after applying the migration to staging and review the diff.

## Setup required outside the code

1. Apply `supabase/migrations/0001_platform_foundation.sql` to **staging** with the Supabase CLI, then regenerate types.
2. Supabase Auth → URL configuration: set Site URL to the app URL. Turn public sign-ups **off**.
3. Supabase Auth → Email templates: set the link in **Invite user** to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/reset-password`
   and in **Reset password** to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`.
4. Set the variables in `.env.example` on the host. Never put values in git or chat.
5. Point the scheduler at `/api/jobs/tick` with the `CRON_SECRET` bearer header.
6. Before production: `APP_ENV=production` (forces MFA) and enroll two authenticators per owner.
