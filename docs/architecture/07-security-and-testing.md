# 07 — Security, Testing and Releases

## In short

Security checks run on the server for every caller, with the database rules (RLS) as a second layer. Automated tests that try to read another client's data, skip a launch gate or double-count a payment **block a release** if they fail (SOP8 5.3). Everything is tested on a separate staging copy with made-up data; production gets only reviewed, owner-approved changes.

## 1. Risk register

| # | Risk | Likelihood | Impact | Control |
|---|---|---|---|---|
| R1 | A client sees another client's data | Low | Critical | Service-layer scoping + RLS + portal-safe views; isolation tests at API, database and file level |
| R2 | A policy mistake opens a table (as S1 did) | Medium | Critical | CI lint rejects `USING (true)` and policies with no role; anon has no grants; RLS tests per table |
| R3 | Owner account takeover | Low | Critical | Mandatory MFA; no public sign-up; login rate limit; sign-in alerts [REC] |
| R4 | Wrong payment status or MRR shown | Medium | High | One rules module; event ledger; reconciliation job; freshness labels; finance tests |
| R5 | Launch without approval or payment | Low | High | Server gate plus a release-blocking test |
| R6 | Duplicate webhook or job → duplicate records or alerts | Medium | Medium | Unique event IDs and idempotency keys; replay tests |
| R7 | Old and new app both process the same event or job | Medium | High | One-owner cutover checklist (08 §4) |
| R8 | Migration breaks the old app during coexistence | Medium | High | Additive-only migrations; old-app regression check on staging |
| R9 | Secrets leaked | Low | High | Env vars only; service key `server-only`; secret scanning in CI; no secrets in notes or uploads |
| R10 | Data loss | Low | Critical | Supabase backups (plan capabilities [U]); documented restore test; soft delete only |
| R11 | AI acts without approval or follows injected instructions | Medium (later) | High | AI uses services as an `ai` actor; approval requests; untrusted-content handling |
| R12 | Lead-form or portal-link spam and enumeration | Medium | Low | Rate limits, Turnstile [REC], constant-time responses |
| R13 | Business data in git history (old repo) | Present | Medium | Stop the snapshot workflow; purge decision in 09 |

## 2. Security controls checklist

- **Authentication:**
  - Supabase Auth.
  - MFA required for owner and contractor ([U] verify on the current plan).
  - Invite-only accounts.
  - Sessions refresh; sign-out everywhere on role change.
- **Authorization:**
  - `requireActor()` plus a role and ownership check in every service function.
  - Contractors are limited to their assigned records.
  - Clients are limited to their own client ID and client-visible fields.
- **Database:**
  - RLS on every table.
  - Client access only through views.
  - No `anon` grants.
  - Security-definer functions pinned to `search_path`, with EXECUTE granted narrowly.
- **Files:**
  - Private buckets.
  - Size and type limits; SVG blocked for uploads.
  - Short-lived signed URLs issued after a permission check.
- **Inputs:** zod validation at every route, action and job input. Generic error messages to callers; details go to server logs.
- **Webhooks and machine endpoints:**
  - Signature verification and event-ID dedupe; production rejects test-mode events.
  - Timestamp replay window.
  - Machine keys accepted in headers only, compared timing-safely.
- **HTTP:**
  - Security headers: CSP, `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy, HSTS.
  - Rate limits on login, the lead form and the portal link.
- **Secrets:**
  - Separate per environment.
  - Rotated after cutover (MCP key, cron secret).
  - Never printed or committed.
- **Audit:** append-only `audit_log`, with no UPDATE or DELETE grants to app roles.
- **Access review:** quarterly review of users, roles, contractor assignments and integration scopes (SOP8 4.5).
- **Incident response:** follow SOP6 §5 and the minimum sequence there. Incidents are logged in the incident register.

## 3. Test strategy

| Layer | Tool | What | Blocks release? |
|---|---|---|---|
| Rules (pure) | Vitest | Business days, cycle windows, allowance, ladder days, MRR and buckets, report due dates, gates | Yes |
| Services | Vitest + local Supabase | Each service with each actor type: allowed and denied; audit row written | Yes |
| **Isolation** | Vitest + Playwright | Client A can't read or modify client B via API, PostgREST, storage or portal; contractor can't see unassigned records; internal notes never reach clients | **Yes, always** |
| RLS / policies | SQL tests (pgTAP or plain SQL in CI) [REC] | Every table has RLS, no anon grants, no `USING (true)` | Yes |
| Workflows | Vitest | Lead → won → project; project gates; revision round 3 needs a change order; **launch gate (all 7 failing combinations)** | **Yes** |
| Idempotency | Vitest | Replaying a Stripe event, re-running jobs, double-clicking actions → no duplicates | **Yes** |
| Finance | Vitest + Stripe test fixtures | Paid, unpaid, refunded, paused → correct buckets; pipeline never counted as revenue | **Yes** |
| End to end | Playwright on staging | Critical paths: log in with MFA, create lead → won → project → gates → launch; care cycle; request | Yes |
| Accessibility | axe in Playwright | Key screens | Warnings at first, then blocking |
| Backup restore | Manual runbook | Restore staging from backup quarterly; record evidence (SOP8 4.3) | Before M1 go-live |

Test data is always made up. No production data is copied to staging.

## 4. Environments and release process (SOP8 5.2–5.4)

1. Branch → pull request.
2. CI runs typecheck, lint, unit, service, isolation and RLS tests, and the build.
3. The migration is reviewed: additive? old app unaffected? backup and recovery note written?
4. Deploy to **staging**; run end-to-end tests; the owner checks.
5. The owner approves the specific production release (and each migration separately).
6. Deploy; smoke test; watch errors and job runs; record the release in the release register.
7. If something breaks, roll back the app (Vercel instant rollback). Data migrations follow their written recovery note; a code rollback doesn't undo a migration.

## 5. Backups and recovery

- Confirm the production Supabase plan's backup type and retention [U] in Phase 1.
- Before each production migration: take or confirm a fresh backup.
- Recovery targets [REC, for owner approval]: RPO 24 h, RTO 1 business day for the internal app.
- Quarterly restore test into staging, logged in the backup test log.
