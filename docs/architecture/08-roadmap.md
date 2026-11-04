# 08 — Roadmap

## In short

We build in small, tested phases. **M1**, the first usable version, gives one reliable internal view of clients, projects, care obligations, tasks and verified payment status. While each phase is built, the old app keeps running and keeps owning its webhooks and scheduled jobs; each one moves over in a single, checked step. Time estimates are rough, assume part-time solo development, and are not deadlines.

## 1. Phases

| Phase | Goal | Main items | Depends on | Rough effort |
|---|---|---|---|---|
| **P0** ✅ | Close live security gaps (old app) | Done 2026-11-04 (01 §4) | — | Done |
| **P1** | Baseline and safety net | Repo scaffold (Next.js, TS strict, lint, Vitest); **staging Supabase project**; Supabase CLI with `0000_baseline` capturing the live schema; generated types; CI (typecheck, lint, tests, RLS lint, secret scan); confirm backup capabilities; Node LTS pinned | Owner creates the staging project and approves the baseline | 1 week |
| **P2** | Foundation | Auth with MFA, roles (owner active), `requireActor`; service-layer skeleton; `audit_log`; business calendar; jobs and `job_runs` with a single tick; app shell and design system (ported primitives); Settings (profile, catalog, care templates, calendar, users, audit, system status) | P1 | 2–3 weeks |
| **P3 → M1** | Core operations | Clients workspace, contacts, websites; Sales (stages, follow-ups, stale, proposals, won → project); Projects (stages, gates, checklists, revision rounds, change orders, approvals, payment milestones); unified tasks; care agreements with effective terms; Overview; Money panel (paid-only MRR + buckets from existing Stripe data, with freshness) | P2; owner confirms care terms and the lead mapping | 4–6 weeks |
| **P4** | Recurring care | Care cycles and allowance; monthly review checklists; request classification and queue; warranty; maintenance history; report drafting → approval → send; quarterly check-ins; late-payment ladder tasks; incidents from monitoring; **scheduler cutover** for monitoring and expiry jobs | M1 | 3–4 weeks |
| **P5** | Client portal (minimal first) | 5a: login, status, outstanding actions, structured requests, uploads. 5b: feedback and revision rounds, approvals, reports, allowance used. Then retire the static portal page. | P4 | 3–5 weeks |
| **P6** | Integrations and cutovers | Stripe webhook port (event ledger, refunds, billing periods) and **cutover**; Sentry; email outbox (welcome email); Zoho read-only; Drive references; reconciliation job | P3 (can partly overlap P4/P5) | 2–4 weeks |
| **P7** | AI, marketing, registers | MCP and AI read tools over services, then approval-gated actions; marketing workspace (fit scoring, attribution, experiments); compliance, incident and access registers; Search Console | P6 | 3–5 weeks |
| **Retire** | Old app off | Old console read-only, then removed; old workflows deleted; Capacitor decision; old repo archived | All cutovers done | 1 week |

The order follows SOP8 §8. The one difference: the Stripe webhook port (P6) can move earlier if you want the old app retired sooner, because M1 reads the payment data the old webhook already writes.

## 2. M1: first production release

**In scope:**
- Owner login with MFA
- Database permissions and audit log
- Clients, contacts and sites
- Sales CRM with follow-up tasks
- Projects with stages, gates and checklists
- Unified tasks
- Care agreements with effective terms
- Overview with actionable priorities
- Money panel (Stripe-derived, paid-only MRR)
- Search and filters
- Works on desktop and phone

**Not in scope:**
- Client portal changes
- Zoho and Drive
- Automated emails
- AI assistant
- Marketing analytics
- Webhook and scheduler cutover (the old app keeps those)

**Acceptance criteria (all must pass on staging, then on a production smoke test):**
1. Only the owner can sign in to the internal app, and MFA is enforced.
2. Isolation tests pass: no client or anonymous caller can read internal data via API, database or storage.
3. Every one of the 13 existing clients appears with correct contacts, sites and care terms, as confirmed by the owner.
4. A lead can go New → In Discussion → Proposal Sent → Won. Won requires a signed agreement and creates exactly one project, a deposit milestone and onboarding tasks.
5. Follow-up tasks appear at 2, 5 and 10 business days, never duplicate on re-runs, and cancel on reply. Leads go stale after 30 days without auto-closing.
6. A project can't start production without a paid deposit and ready assets, can't open revision round 3 without an approved change order, and **can't launch without written approval, final payment and a complete checklist**. Each refusal names what's missing.
7. Collected MRR matches a manual calculation from Stripe for the current month. Unpaid and paused amounts are shown separately, and the panel shows its last-synced time.
8. The Overview lists overdue tasks, blocked projects, follow-ups due and care work due, each linking to its record.
9. Every create, update, stage change and approval appears in the audit log with actor and time.
10. The old app keeps working unchanged against the same database (regression check).
11. A backup restore has been tested on staging.

## 3. Release gates (every phase)

- All release-blocking tests in 07 §3 pass.
- Migrations are additive (until retirement), reviewed, backed up and owner-approved.
- Owner sign-off on staging.
- For phases with cutovers, the cutover checklist (§4) is complete.

## 4. Cutover checklist (one owner per job)

| Responsibility | Old owner today | Cutover step | Check after |
|---|---|---|---|
| Stripe webhook | Old app `/api/webhooks/stripe` | In the Stripe dashboard, point the endpoint at the new app and disable the old one **in the same change**; replay a test event on staging first | New `integration_events` rows; no old-app `sync_log` rows |
| Site checks and expiry alerts | GitHub Actions + (documented) cron-job.org | Enable the new tick job; disable the old workflows and cron-job.org in the same session | Exactly one scan per interval |
| Maintenance reminder | Vercel Cron in the old repo | Remove from old `vercel.json` when the P4 care cycles go live | — |
| Monthly reports | GitHub Actions (1st of month) | Replace with care-cycle report drafting (P4) | No reports generated on the 1st by the old job |
| Metrics snapshot to git | GitHub Actions hourly | **Disable now** (owner decision, 09) | No new snapshot commits |
| Sentry webhook | Old app | Re-point the Sentry integration URL | — |
| Portal API | Old app `/api/portal/*` | New portal or a compatible API; static page updated in the same release | — |
| MCP | Old app `/api/mcp` | New endpoint; rotate the key | — |
| Push notifications | Old app | Re-subscribe devices in the new app | — |
