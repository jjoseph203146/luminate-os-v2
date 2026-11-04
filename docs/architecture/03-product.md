# 03 — Product: Modules and Screens

## In short

There are twelve modules in the sidebar. The **client workspace** is the hub: every project, site, care plan, request, document and payment for a client is reachable from one page. v1 builds the internal app first; the client portal comes later and reuses the same records.

## 1. Navigation

| Module | v1 (M1) | Later |
|---|---|---|
| **Overview** | Today's priorities, overdue tasks, blocked projects, follow-ups due, care work due, site incidents, payment status with source and freshness | Pending approvals, automation status |
| **Clients** | Directory, client workspace, contacts, sites | Health indicator |
| **Sales** | Pipeline board, lead record, follow-ups, proposals, won/lost | Fit scoring, attribution reports |
| **Projects** | Stages, gates, checklists, revision rounds, change orders, approvals, launch | Intake via portal |
| **Care** | Care agreements with effective terms, monthly cycle, allowance used | Monthly review checklist, reports due, quarterly check-ins, late-payment ladder |
| **Tasks** | Unified task list with due dates, related record, source | Recurring templates UI |
| **Money** | Stripe-derived payments, paid-only MRR plus unpaid/late/paused buckets, open invoices | Zoho figures, budget, forecast |
| **Websites** | Status from the current monitoring data | Incidents, SSL/domain renewals, maintenance history |
| **Documents** | Upload and link per record; signed agreements | Drive transfer, templates |
| **Reports** | — | Care reports (draft → approve → send), sales and agency KPIs |
| **Automations** | Job run history (read-only) | Registry UI, approvals queue |
| **Settings** | Business profile, catalog and care templates, business calendar, users, audit log, system status | Integrations, notification preferences, registers |

## 2. Client workspace (the hub)

The header shows the business name, status, care tier, health (later), primary contact and quick actions.

| Tab | Shows |
|---|---|
| Overview | Open tasks, active project stage, care cycle (allowance used / included, next report due), latest payment status, site status |
| Projects | All projects with stage and gates |
| Websites | Each site with hosting, monitoring status, backups and access notes (no secrets) |
| Care | Agreement terms (price, tier, allowance, anniversary), cycles, maintenance history |
| Requests | Requests with type, severity, status and internal notes |
| Billing | Stripe-derived invoices and payments, each with its source link and "last synced" time |
| Documents | Agreements, intake, reports, uploads, with visibility flags |
| Activity | The audit log for this client |

## 3. Core user stories (v1)

Owner = the only user in v1.

**Sales**
- As owner, I add a lead from any source, set the source, service, value, priority and next action, and the app creates a follow-up task.
- When I log "no response", the app schedules follow-ups at 2, 5 and 10 business days; when I log a reply, the remaining follow-ups are cancelled.
- After 30 days without engagement the lead shows a "stale" flag; it stays open until I close it with a reason.
- When I mark a lead Won, I must attach the signed agreement. The app creates the client (or links an existing one), the project in Onboarding with "Deposit pending", and the deposit task.

**Projects**
- I can't move a project to In Progress until the deposit is marked paid (with a Stripe or Zoho reference) and materials are marked ready.
- I can't start revision round 3 without an approved change order.
- I can't mark a project launched until there's a recorded written approval, a confirmed final payment and a complete launch checklist. Each missing item is named.

**Care**
- Each client's care agreement stores their actual price, tier and allowance, even when it differs from today's catalog.
- Each care month (from the client's anniversary) the app creates the monthly review task and the report due date (5 business days later), and resets the allowance.
- When I log a request I classify it. "Included update" uses the allowance; "warranty" doesn't. When the allowance is used up, the app asks for a quote instead.

**Tasks and overview**
- One list shows every task across sales, projects, care and finance, sorted by due date and priority. Each task links to its record.
- The overview answers "what needs me today?" Every number links to its records, and money figures show their source and last sync time.

## 4. Non-functional requirements

| Area | Requirement |
|---|---|
| Correctness | Business rules run only on the server. One implementation per rule (MRR, cycles, business days). |
| Honesty | Unavailable or stale data is labelled; nothing is estimated silently (SOP4 §4, SOP8 1.1) |
| Security | See 04 §3 and 07. Every action is authorized on the server, whatever the caller. |
| Performance | Pages load in under 1 s at current scale (13 clients, about 12k monitoring rows). Lists paginate; no 1,000-row silent caps. |
| Reliability | External outages degrade gracefully (SOP8 4.6). The app still works if Stripe is down; affected panels show "unavailable". |
| Accessibility | Keyboard navigation, real tab roles, visible focus, minimum 12 px text, reduced motion respected |
| Devices | Desktop-first; usable on a phone for checks and quick updates |
| Auditability | Every significant change is recorded with actor, time and before/after (SOP8 2.6) |
| Cost | Fits Supabase and Vercel plans appropriate to a solo agency; no always-on AI process |
