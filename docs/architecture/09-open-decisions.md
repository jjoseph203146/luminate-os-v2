# 09 — Open Decisions

## In short

These are the questions only the owner can answer. Each has a recommendation. They're grouped by when they're needed, so nothing blocks work earlier than necessary. Answered items move to the decision log in 00.

## Needed before Phase 1

| # | Question | Recommendation |
|---|---|---|
| D1 | Create a **staging Supabase project** (free tier is fine for staging [U]) and give the app its keys via environment settings, not chat. | Yes; name it `luminate-os-staging` |
| D2 | **Old metrics snapshot workflow** (`dashboard-metrics-snapshot.yml`) still commits business data to git every hour. Turn it off now? Who reads that file? | Turn it off now; use the authenticated API instead |
| ~~D3~~ | ~~Purge the metrics file from the old repo's git history?~~ **Decided 2026-11-04:** the old repo is private, so no purge. | — |

## Needed before M1 (Phase 3)

| # | Question | Recommendation |
|---|---|---|
| D4 | **Lead stage mapping** for the 10 existing leads: `interested` → ?, `contacted` → ?, `quoted` → ? | interested → New Lead; contacted → In Discussion; quoted → Proposal Sent |
| D5 | **Business calendar:** Monday–Friday, Eastern time? Which holidays count as non-business days? | Mon–Fri, America/New_York; US federal holidays you actually take off |
| D6 | **Existing clients' care terms:** (2026-11-06: entered per client in the Billing tab's billing schedule, prefilled from the client record; doc 17) for each active client, their tier (Essential / Professional / Growth), actual monthly price (grandfathered?), and anniversary day | I prepare a pre-filled list from Stripe for you to confirm |
| D7 | **Follow-up reminders:** tasks in Luminate OS only, or also Google Calendar events? (SOP2 §6 mentions your calendar) | OS tasks only for M1; calendar sync later |
| D8 | **E-signature provider** for agreements (SOP6 2.2). Which one do you use, if any? | For M1, upload the signed PDF plus its audit certificate; integrate the provider later |
| D9 | **Which system issues project invoices** (deposit and final): Stripe or Zoho? | Stripe invoices (Zoho imports them), so payment status is verifiable |
| D10 | **Existing project stages:** for the 11 projects, which are completed and which are in progress? | I'll list them for you to mark |
| D11 | The `security_findings` table (empty, origin unknown) | Leave it untouched; drop it after the old app is retired if nothing uses it |
| D12 | The one client login that isn't linked to any client | Remove it, or link it to the right client; I can't tell which from here |

## Needed before Phase 4 (care)

| # | Question | Recommendation |
|---|---|---|
| D13 | **Welcome email:** does SOP3 §2 count as a standing approval to send it automatically once signed + deposit paid? | Yes, for that one template only |
| D14 | **Stripe-sent renewal invoices and reminders:** standing approval? (2026-11-06, owner brief: Luminate OS never sends; per client either the owner sends or Stripe does, one sender only; doc 17) | Yes (Stripe sends them; the OS only tracks) |
| D15 | Quarterly check-ins: every 3rd care month from each client's start, or fixed calendar quarters? | Every 3rd care month per client |
| D16 | Notification channels: push + in-app + daily digest email? | Push for urgent, in-app for all, digest email optional |
| D17 | Old monthly report job: stop it when P4 report drafting goes live? | Yes |

## Needed before Phase 5–7

| # | Question | Recommendation |
|---|---|---|
| D18 | Portal: rebuild inside the new app and retire the static page on the marketing site? | Yes |
| D19 | **Zoho Books** read-only integration timing; freeze the app's manual expenses table? Keep a business-tools list for the quarterly subscription audit? | Freeze expenses; take expenses from Zoho; keep the tools list as reference data |
| D20 | Google Drive: OAuth as you, or a service account with access to a dedicated folder? | Dedicated folder + service account [U on feasibility] |
| D21 | **Retention schedules** (SOP6 4.6) for client files, monitoring history, legal records and departed clients (only financial = 7 years is set) | Monitoring raw checks 90 days then daily rollups; client files for agreement term + 7 years; legal records per attorney advice |
| D22 | The iOS app (Capacitor/TestFlight): keep, or retire in favour of the installable web app? | Retire |
| D23 | AI assistant: which model provider, and a monthly cost cap? | Decide at P7 |
| D24 | Recovery targets: RPO 24 h, RTO 1 business day acceptable? | Yes |
| D25 | Prospect fit-score thresholds for High / Medium / Low (SOP7 §8 open item) | Keep priority manual until you set them |
