# 02 — SOP Requirements Traceability

## In short

This document maps every SOP rule that affects the app to:
- the module that implements it,
- the data it needs,
- how it's enforced,
- who may act,
- the test that proves it,
- the phase it ships in.

Phases are defined in 08 (P2 = foundation, P3 = M1 core, P4 = care, P5 = portal, P6 = integrations, P7 = AI, marketing and registers).

**Enforcement types:**
- **Gate**: the server refuses the action until conditions are met.
- **Auto**: a routine internal action the system performs itself, such as creating a task (allowed by SOP8 3.1).
- **Approval**: needs explicit owner approval (SOP8 3.2).
- **Manual**: the owner does it; the app records it.
- **Display**: shown and computed only.

**Global rules (apply everywhere):**
- SOP8 1.2: one source of truth per domain.
- SOP8 2.6: append-only audit log.
- SOP8 3.2: owner approval for external messages, financial, legal and permission changes.
- SOP8 4.1: server-side authorization with client isolation.

These are tested once, centrally (07), rather than per row.

## SOP1: Service catalog, pricing and policies

| # | Requirement | Cite | Module | Data | Enforcement | Test | Phase |
|---|---|---|---|---|---|---|---|
| 1.1 | Starter site $500, up to 4 pages; add-on price list; custom quotes | §1, §2 | Settings → Catalog; Proposals | `catalog_items` | Display; prices are snapshotted onto proposals | A proposal keeps its price after a catalog change | P3 |
| 1.2 | Estimate benchmark (hours × $40 + direct costs) × 1.15; exceptions recorded | §2; SOP2 §4 | Proposals | `proposals.estimate_*` | Display (calculator) | Formula unit test | P3 |
| 1.3 | Track estimated vs actual effort, especially the 4 under-priced add-ons | §2, §9 | Projects; Reports | `projects.estimated_hours`, `actual_hours` | Manual + report | — | P4 |
| 1.4 | Care tiers Essential $35 / Professional $49 / Growth $99; updates 2/3/5; response targets 2/1/1 business days | §3 | Care | `care_plan_templates`, `care_agreements` (terms snapshot) | Display; allowance is a Gate on "included" | Allowance and target derived from agreement terms, not the catalog | P3 |
| 1.5 | Unused updates don't roll over; a response target means acknowledgment, not a fix | §3 | Care | `care_cycles` | Auto (new cycle resets) | Cycle rollover test | P4 |
| 1.6 | 60-day notice before a care price change | §3 | Care | `care_price_changes` | Gate (effective date ≥ notice + 60 days) | Early effective date rejected | P4 |
| 1.7 | 50% deposit before work; 50% after approval, before launch | §4 | Projects | `payment_milestones` | Gate | See 3.3 and 3.9 | P3 |
| 1.8 | Project invoice late: reminder day 3, follow-up day 7, may pause after day 7 with notice | §4 | Projects; Tasks | `payment_milestones` | Auto tasks; pause is Manual | Tasks on days 3 and 7 | P4 |
| 1.9 | Care late-payment ladder (−5, 0, +3, +7, +14, +28, +30; restore with no fee) | §5 | Care; Money | `care_agreements.billing_state` | Auto tasks; suspension and deactivation are Approval | Ladder test (06 §6) | P4 |
| 1.10 | Paying MRR tracked separately from overdue and paused | §5 | Money | Stripe-derived view | Display ([DECIDED] paid-only) | MRR excludes unpaid and paused | P3 |
| 1.11 | 30-day post-launch warranty for reproducible defects | §7 | Requests | `requests.type = warranty` | Gate (within launch + 30 days) | Warranty rejected on day 31 | P4 |
| 1.12 | Per site: hosting, access ownership, backups, restore, migration method | §8, §9 | Websites | `websites`, `website_services` | Manual; no secrets stored | No credential fields exist | P3 |

## SOP2: Sales and leads

| # | Requirement | Cite | Module | Data | Enforcement | Test | Phase |
|---|---|---|---|---|---|---|---|
| 2.1 | Stages New Lead → In Discussion → Proposal Sent → Won/Lost | §1 | Sales | `leads.stage` | Gate (valid transitions) | Invalid transition rejected | P3 |
| 2.2 | Won = agreement signed (deposit may be pending); then create onboarding + deposit invoice | §1, §5 | Sales → Projects | `agreements`, `projects` | Auto (project + tasks on signing) | Signing creates exactly one project | P3 |
| 2.3 | One CRM for all sources; outbound prospects labelled | §2; SOP7 3.2 | Sales | `leads.kind`, `source` | Display; duplicate check | Duplicate email or domain warns | P3 |
| 2.4 | Lead fields incl. owner, priority H/M/L, next action and date, lost reason (enumerated) | §2, §3 | Sales | `leads.*` | Gate (lost needs a reason) | Lost without reason rejected | P3 |
| 2.5 | Reply to inquiries within 1 business day | §3 | Sales; Overview | `leads.response_due_at` | Auto (task) | Due time uses the business calendar | P3 |
| 2.6 | Follow-ups at 2, 5, 10 business days; a reply resets | §6 | Sales; Tasks | `tasks` (source = lead) | Auto, idempotent | Re-running creates no duplicates; a reply cancels pending ones | P3 |
| 2.7 | Stale after 30 calendar days without engagement: flag, never auto-close | §7 | Sales | `leads.last_engaged_at` | Display flag | Stale lead stays open | P3 |
| 2.8 | Proposals have no expiry; the quoted price is honoured if scope is unchanged | §5 | Proposals | `proposals` | Display | — | P3 |
| 2.9 | Weekly review dashboard: new leads, sources, open value, proposals, won, conversion, overdue follow-ups; deal value ≠ revenue | §8 | Sales | view | Display | Pipeline value never appears as revenue | P3 |
| 2.10 | AI drafts follow-ups; the owner approves before sending | §6, §9 | AI | `approvals` | Approval | Send blocked without approval | P7 |

## SOP3: Onboarding and delivery

| # | Requirement | Cite | Module | Data | Enforcement | Test | Phase |
|---|---|---|---|---|---|---|---|
| 3.1 | Stages Onboarding → In Progress → Client Review → Launch → Completed | §1 | Projects | `projects.stage` | Gate | Transition matrix test | P3 |
| 3.2 | Workspace and checklist on signing, "Deposit Pending" | §2 | Projects | `projects.deposit_status`, `checklist_items` | Auto | — | P3 |
| 3.3 | Production starts only after deposit + materials | §2, §3 | Projects | `deposit_status`, `assets_ready_at` | **Gate** on → In Progress | Blocked while deposit pending | P3 |
| 3.4 | Welcome email automatically after signing + deposit | §2, §11 | Projects; Email | `email_outbox` | Auto, **standing approval [OPEN]** | Sent once only | P6 |
| 3.5 | Custom intake per project | §2 | Projects | `intake_forms` | Manual | — | P3 (form) / P5 (portal) |
| 3.6 | Assets due 5 business days after the intake request; hold possible after 10 business days with reminders + notice; a hold is not approval | §3 | Projects; Tasks | `assets_due_at`, `on_hold` | Auto tasks; hold is Manual | Due-date maths | P3 |
| 3.7 | No passwords in uploads or email | §3; SOP6 §4 | Documents | — | Display warning; no secret fields | — | P3 |
| 3.8 | QA before preview; unresolved issues recorded | §4 | Projects | `checklist_items` (QA template) | Gate on → Client Review | Blocked with open QA items | P3 |
| 3.9 | Two consolidated revision rounds (starter); others per signed terms | §5; SOP1 §1 | Projects | `revision_rounds`, `projects.revision_rounds_included` | Gate (round 3 needs a change order) | Round 3 blocked | P3 |
| 3.10 | Out-of-scope work needs a fixed-price change order with written approval first | §5; SOP6 2.4 | Projects | `change_orders`, `approvals` | Gate | Work status blocked until approved | P3 |
| 3.11 | **Launch needs written approval + final payment + launch checklist; never automated** | §5, §6 | Projects | `approvals`, `payment_milestones`, `checklist_items` | **Gate**, owner-initiated | All three missing combinations rejected (release-blocking) | P3 |
| 3.12 | Post-launch checks; handoff email; access revoked | §6 | Projects | checklist | Manual; email is Approval | — | P3 |
| 3.13 | Completed only after live verification, handoff and care setup | §7 | Projects | — | Gate | — | P3 |
| 3.14 | Warranty tickets separate; don't consume the allowance | §7 | Requests | `requests.type` | Auto exclusion | Allowance unchanged by warranty | P4 |

## SOP4: Monthly care and reporting

| # | Requirement | Cite | Module | Data | Enforcement | Test | Phase |
|---|---|---|---|---|---|---|---|
| 4.1 | Automated uptime, performance and error monitoring with low noise | §2 | Monitoring | `incidents`, `site_monitors` | Auto | Confirm-before-alert | P4 |
| 4.2 | Manual review of every site monthly, using the checklist | §2 | Care | `care_cycles`, checklist | Auto task each care month | One review per cycle | P4 |
| 4.3 | Severity before tier (outage > performance/usability > cosmetic) | §2, §3 | Requests; Monitoring | `severity` | Display (queue order) | Queue order test | P4 |
| 4.4 | One dated maintenance history per client | §2 | Care | `maintenance_events` | Manual + Auto | — | P4 |
| 4.5 | Requests via portal, email as fallback, recorded centrally | §3; SOP8 2.4 | Requests | `requests.channel` | Manual entry for email | — | P3 |
| 4.6 | Classify: maintenance / warranty / included update / billable change; queue severity → tier → date | §3 | Requests | `requests.type`, `severity` | Gate (billable needs a quote + approval) | — | P4 |
| 4.7 | Portal shows status, allowance used, completed changes and message history | §3 | Portal | — | Display ([DECIDED] simple status; owner notes private) | Client never sees internal notes | P5 |
| 4.8 | SEO by tier; never present estimates as measurements | §4 | Care; Reports | — | Display ("unavailable" labels) | — | P4 |
| 4.9 | Report or summary within 5 business days of each client's anniversary; owner approves; no auto-send; gaps labelled | §5 | Reports | `reports.status`, `due_on` | Auto draft; sending is Approval | Due date maths; no send without approval | P4 |
| 4.10 | Email summary + portal link (Essential: summary may be the whole email) | §5 | Reports | — | [DECIDED] | — | P4/P5 |
| 4.11 | Quarterly check-in with satisfaction question | §6 | Care; Tasks | `checkins` | Auto task | — | P4 |
| 4.12 | Cancellation: written confirmation, reason, end dates, stop billing, handoff | §6 | Care | `care_agreements.cancel_*` | Manual workflow | — | P4 |
| 4.13 | Client-health indicator as a prompt only | §6 | Clients | computed | Display | — | P4 |

## SOP5: Finance

| # | Requirement | Cite | Module | Data | Enforcement | Test | Phase |
|---|---|---|---|---|---|---|---|
| 5.1 | Zoho Books is the system of record; Stripe owns payments; no second ledger | 2.1; SOP8 1.2 | Money | `external_refs`, sync timestamps | Display only | No write path to accounting | P3 (Stripe) / P6 (Zoho) |
| 5.2 | Distinguish gross, fees, refunds, chargebacks and payouts; transfers aren't revenue | §1 rules | Money | `integration_events` | Display | Refund reduces collected | P6 |
| 5.3 | Separate earned revenue, collections, profit, cash, A/R and MRR; paused or unpaid ≠ collected MRR | §4 | Money | views | Display | — | P3 |
| 5.4 | Company-level profitability only (no project P&L) | 3.4, 3.5 | — | — | Not built (by design) | — | — |
| 5.5 | Weekly review, month-end close, quarterly reviews | §7 cadence | Tasks | recurring tasks | Auto tasks | — | P3 |
| 5.6 | Dashboard incl. cash, budget variance, 90-day forecast | 4.2, 5.6 | Money | Zoho-derived | Display | — | P6+ |
| 5.7 | AI changes nothing financial without approval | §6 | AI | — | Approval | — | P7 |

## SOP6: Legal and risk

| # | Requirement | Cite | Module | Data | Enforcement | Test | Phase |
|---|---|---|---|---|---|---|---|
| 6.1 | One agreement per project with care terms; e-signature and audit trail kept | 2.1, 2.2, 2.5 | Projects; Documents | `agreements` | Manual (upload signed copy + evidence) | — | P3 |
| 6.2 | Email-approved change orders naming the approver | 2.4 | Projects | `approvals.approver`, `channel`, `evidence` | Gate | — | P3 |
| 6.3 | Negotiated exceptions linked to the client | 2.6 | Clients | `agreements.exceptions` | Display | — | P3 |
| 6.4 | Restricted dispute records | 3.6 | Legal | `disputes` | Owner-only | — | P7 |
| 6.5 | Data minimization, least privilege, no secrets in notes | 4.2, 4.3 | All | — | No secret fields | — | P2 |
| 6.6 | Retention schedules per record class (financial: 7 years) | 4.6; SOP5 4.6 | All | `retention_class` | Soft delete; schedules [OPEN] | Nothing hard-deleted by routine actions | P2 |
| 6.7 | Compliance register, incident response, continuity, backup verification | 1.6, 5.1–5.5 | Settings → Registers | `compliance_items`, `incidents` | Manual + reminders | — | P7 (interim register in Drive) |

## SOP7: Marketing

| # | Requirement | Cite | Module | Data | Enforcement | Test | Phase |
|---|---|---|---|---|---|---|---|
| 7.1 | 5-factor fit score 0–5 each; thresholds not yet approved; unknown stays unknown | 1.6, §3.1 | Sales | `leads.fit_*` | Display; priority stays manual | — | P3 |
| 7.2 | Original source kept through conversion; later touchpoints separate | 4.2, §4 | Sales → Clients | `leads.source`, `clients.acquisition_source` | Auto copy on Won | — | P3 |
| 7.3 | Funnel metrics with defined formulas; CAC N/A when 0 | 4.1, §4 | Reports | views | Display | Division-by-zero shows N/A | P7 |
| 7.4 | Experiments, content calendar, contractor approvals | 3.3, 4.5, 5.3 | Marketing | later | — | — | P7 |

## SOP8: OS and automation

| # | Requirement | Cite | Module | Enforcement | Phase |
|---|---|---|---|---|---|
| 8.1 | One source of truth per domain; provider IDs, last sync, provenance | 1.2, 2.5 | `external_refs`, freshness labels | P2 |
| 8.2 | Canonical client; immutable IDs; several projects and sites per client | 1.4, 2.1 | Schema (05) | P3 |
| 8.3 | Owner / contractor / client roles; contractor access scoped by assignment; AI admin-only | 1.5 | Auth (04 §3) | P2 |
| 8.4 | Automation registry: trigger, approvals, logs, retries, fallback | 1.6, 3.5, §10 | `automations`, `job_runs` | P2 |
| 8.5 | Versioned migrations, validated states, RLS | 2.1, 5.4 | Supabase CLI migrations | P1 |
| 8.6 | Private uploads; metadata in the OS; verified transfer to Drive | 2.2 | `documents` | P3 / P6 |
| 8.7 | Minimal portal first (login, status, uploads, structured requests) | 2.3 | Portal | P5 |
| 8.8 | Verified webhooks, dedupe by event ID, sync freshness | 2.5 | `integration_events` | P6 |
| 8.9 | Append-only audit log with actor, before/after, approval references | 2.6 | `audit_log` | P2 |
| 8.10 | Urgent alerts immediately; routine items in a digest | 3.6 | Notifications | P4 |
| 8.11 | Privileged MFA; cross-client denial tests at API, database and file layers | 4.1, 5.3 | Auth; tests | P2 |
| 8.12 | Backups documented and restore tested | 4.3 | Runbook | P1 |
| 8.13 | Staging and production separated; small releases | 5.2 | Environments | P1 |
