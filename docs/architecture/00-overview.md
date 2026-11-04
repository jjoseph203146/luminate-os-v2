# 00 — Overview

**Status:** draft for owner review · **Date:** 2026-11-04 · **Code:** none yet

## In short

Luminate OS v2 is a new web app that runs Luminate Web Design & Development day to day. It covers clients, sales, projects, client care, tasks, money and website health. It follows the eight approved SOPs and replaces the current Luminate OS console one area at a time.

- **What it is:** one Next.js app (TypeScript) on Vercel, using the **existing Supabase database**, so no data has to move.
- **What it is not:** an accounting system (Zoho Books stays the ledger), a payment system (Stripe stays), or a file archive (Google Drive keeps finished documents).
- **First usable version (M1):** one reliable internal view of active clients, projects, care obligations, upcoming tasks and verified payment status (SOP 8 §8).
- **Later:** the client portal, Stripe/Zoho/Drive integrations, then an admin-only AI assistant.

## How to read these documents

| File | Read it for |
|---|---|
| [01-current-system](01-current-system.md) | What the old app does, what we keep, and what was already fixed |
| [02-sop-requirements](02-sop-requirements.md) | Every SOP rule and the feature that enforces it |
| [03-product](03-product.md) | Modules, screens and what you can do in each |
| [04-architecture](04-architecture.md) | How the app is built: layers, logins and roles, integrations, jobs, portal, AI |
| [05-data-model](05-data-model.md) | Tables, and how today's data carries over |
| [06-business-rules](06-business-rules.md) | Stages, gates, deadlines, allowances, late payments and business days |
| [07-security-and-testing](07-security-and-testing.md) | Risks, tests, backups and release checks |
| [08-roadmap](08-roadmap.md) | Phases, the first usable version, and when each phase counts as done |
| [09-open-decisions](09-open-decisions.md) | Questions still waiting on the owner |

## Labels used in every document

- **[SOP]**: approved policy, with a citation such as `SOP4 §5`. The app must follow it. Only the owner changes it.
- **[REC]**: a technical recommendation. Open to change.
- **[DECIDED]**: an owner decision made during planning (logged below).
- **[OPEN]**: waiting on the owner (see 09).
- **[U]**: unverified. Do not rely on it until checked.

SOP references: SOP1 Service Catalog & Pricing ("Business Playbook") · SOP2 Sales & Leads · SOP3 Onboarding & Delivery · SOP4 Monthly Care & Reporting · SOP5 Finance · SOP6 Legal & Risk · SOP7 Marketing · SOP8 Luminate OS & Automation.

## Decision log

| Date | Decision | Notes |
|---|---|---|
| 2026-11-03 | Build approach: new app on the existing Supabase database, migrated area by area ("Option C") | Old app keeps running until each area is replaced |
| 2026-11-03 | New repository: `luminate-os-v2` | |
| 2026-11-04 | Phase 0 security fixes applied to the **current** app and database | Old repo PR #23. Database change verified with a read-only check. Public sign-ups turned off. |
| 2026-11-04 | **MRR counts only paid fees.** A care fee counts toward collected MRR once the invoice for the current period is paid. Unpaid, late and paused amounts are shown separately. | Matches SOP1 §5, SOP3 §9, SOP4 §7, SOP5 §4 |
| 2026-11-04 | **Clients see a simple request status** in the portal. The owner's comments stay private. | Matches SOP4 §3 |
| 2026-11-04 | **Report emails** contain a short summary plus a portal link; Essential clients may get the summary only | Matches SOP4 §5 |
| 2026-11-04 | Planning documents approved for writing (this set) | |

## Ground rules for building

1. **No production QA.** Test on a staging Supabase project and Stripe test mode with made-up data. Production holds only real business data.
2. **One owner per job.** Only one system may process Stripe webhooks or run any scheduled job at a time. Cutovers happen in a single step.
3. **Owner approval** before any deploy, database migration, key rotation, webhook change, or push to `main`.
4. **No invented facts.** Anything not verified is marked [U]. Unavailable data is shown as unavailable, never guessed.
5. **SOPs govern.** If a feature conflicts with an SOP, the conflict goes to 09. Policy is never silently changed in code.
