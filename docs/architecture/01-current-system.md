# 01 — Current System

**Source:** the read-only audit of `jjoseph203146/LuminateOS` at commit `f77aa69` (full package on branch `claude/optimistic-edison-9qme6q`, folder `docs/rebuild-handoff/`). The live-database check was run by the owner on 2026-11-04.

## In short

The current app is a real, working console in daily use. Its **data**, its **Stripe webhook logic**, its **website checks** and its **portal and AI-access patterns** are worth keeping. Its structure is not: business rules run in the browser, three different revenue formulas exist, the schema was managed by hand, and scheduling is unreliable. The worst security gaps were closed on 2026-11-04 (see §4).

## 1. What it does today

| Area | Today | State |
|---|---|---|
| Clients | Created **only** from Stripe customers. Statuses: onboarding / active / past_due / paused, plus archive, on-hold and stop-monitoring flags | Works; Stripe-only creation conflicts with SOP2/SOP3 |
| Projects | One per client (database rule). Contract PDF, URLs, hosting facts, blocker note | Works; no stages, checklists or approvals |
| Requests | Portal and console requests with comments, revisions and a quota toggle | Works; the extra-revision charge never triggers (bug L1) |
| Leads | interested → contacted → quoted → won/lost; public form intake | Works; not linked to clients |
| Internal work | `internal_work_items` with priority and status | Works |
| Money | Payments from the Stripe webhook; manual expenses; business tool subscriptions | Works; MRR calculated 3 ways (L2) |
| Monitoring | Uptime, 8 header/security checks, SSL, domain expiry, broken links, Sentry errors, Playwright screenshots | Works; scheduler unreliable (runs every 3–7 h instead of 10 min) |
| Reports | Monthly report per client on the 1st; emails off | Works; timing doesn't match SOP4 |
| Notifications | Web push (broadcast to all devices) | Works |
| AI access | Read-only MCP server with strong redaction | Works |
| Client portal | Static page on the marketing site calling `/api/portal/*` | Works |
| Tests, lint, CI | None | — |

## 2. Live database facts (read-only check, 2026-11-04)

- PostgreSQL 17.6 on Supabase. **No migration history table**, which confirms the schema was managed by hand.
- 31 public tables, all with RLS enabled. The schema matches the repository closely, with three differences:
  - `security_findings` exists in the database but in no repository file. It has 0 rows and is admin-only. Its origin is unknown; see 09.
  - `report-email-tracking.sql` was **never applied** (there is no `reports.emailed_at` column).
  - `close-request-comments.sql` was **never applied**: clients can comment on completed requests.
- Row counts (approximate scale, not a business report):

| Table | Rows | Table | Rows |
|---|---|---|---|
| clients | 13 | revenue_events | 64 |
| projects | 11 | reports | 28 |
| leads | 10 | requests | 3 |
| internal_work_items | 10 | site_monitor_checks | 11,936 (growing) |
| accounts | 12 | sync_log | 2,096 (growing) |
| auth users | 3 (1 admin, 2 client) | storage files | 17 across 4 buckets |

- The request-number sequence is at `1785548092180`. It was most likely pushed up by a long number inside an old request ID. This is harmless but ugly; the new app should reset numbering above the real maximum (see 05).
- One client login has no linked client record, so it can see nothing. It needs cleaning up.

## 3. What we keep, refactor or drop

| Keep (port with changes) | Refactor heavily | Drop |
|---|---|---|
| Stripe webhook race-safe logic (PRs #21–22) | Scan orchestration (parallel, real job runner) | Three schedulers (GitHub cron, cron-job.org, Vercel cron) → one |
| Monitoring checkers (`checkSite`, `checkSsl`, `checkDomainExpiry`, `checkBrokenLinks`) | Report generator (keep the "every line from stored data" rule) | Hourly metrics snapshot committed to git |
| Sentry ingest | Push notifications (per-user targeting) | Capacitor iOS shell (unless the owner wants it) |
| MCP redaction layer | Portal API (rate limits, private notes) | Dead routes and helpers; 27 unused npm packages |
| UI primitives, money/privacy blur, form sheets, theme, command palette | Billing summary (cache and concurrency limit) | `seed.sql`, `schema.sql`, `supabase-rls.sql`, `_verify_scratch_schema.sql` (never run) |
| `sync_log` job ledger and System status view | Business rules now in browser hooks → server services | Hand-written database types → generated |

## 4. Already fixed (Phase 0, 2026-11-04)

Merged as old-repo PR #23, with the database change applied and verified:

- The site-accounts table (`project_services`) is admin-only. It had been open to anyone holding the public key; the table was empty, so nothing leaked.
- The public (anon) key has no table access at all.
- Clients see only their own request comments; the owner's comments are private.
- Clients can't download hidden documents or contracts directly.
- Request numbers can only be issued by the server.
- The middleware header bypass is closed; console pages re-check admin on the server.
- Scan routes require an admin.
- A Stripe "customer deleted" event archives the client instead of deleting its history.
- Stripe test-mode events are ignored in production.
- Public sign-ups are turned off.

**Still open in the old app:**
- The hourly workflow that commits business data to git (S7).
- No rate limiting on the public lead form or the portal login link (S8).
- No security headers (S11).
- Clients can read some internal columns through direct database queries (S6).
- The unreliable scheduler.

See 09 for decisions and 08 for when each is handled.
