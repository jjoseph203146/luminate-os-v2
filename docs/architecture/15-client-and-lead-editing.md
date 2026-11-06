# 15. Client and lead editing

Replaces the old console's client switches and site address editing, so the old app is not needed
for day-to-day client changes. No database migration: every column already exists.

## Clients

Where: the client workspace (`/clients/[id]`), **Manage** tab and **Websites** tab.
Code: `src/domains/clients/service.ts` (permission `clients.write`, owner only),
pure rules in `src/domains/clients/rules.ts`, input shapes in `src/domains/clients/schemas.ts`.
All writes run as the signed-in owner, so row-level security (`admin_full`) still applies.

| Change | Service function | Column | Audit action | Activity log (old app's names) |
| --- | --- | --- | --- | --- |
| Archive / restore | `setClientFlag` (`flag=archived`) | `clients.archived_at` | `client.archived` / `client.restored` | `client_archived` / `client_restored` |
| Put on hold / release | `setClientFlag` (`flag=on_hold`) | `clients.on_hold_since` | `client.on_hold` / `client.hold_released` | `client_on_hold` / `client_hold_released` |
| Stop / resume monitoring | `setClientFlag` (`flag=monitoring_paused`) | `clients.monitoring_paused_at` | `client.monitoring_paused` / `client.monitoring_resumed` | `monitoring_paused` / `monitoring_resumed` |
| Edit details | `updateClientDetails` | business name, contact, email, phone, plan name, client since, updates per cycle | `client.details_updated` (changed fields; contact values left out) | none |
| Add / edit / remove a website | `addClientWebsite`, `updateClientWebsite`, `removeClientWebsite` | `client_websites` | `client_website.added` / `.updated` / `.removed` | none |
| Set / clear a project's live address | `setProjectUrl` | `projects.production_url` | `project.production_url_updated` | none |

Rules:
- Switches are idempotent. Turning on a switch that is already on keeps its original date and writes
  nothing (the old app overwrote the date each time). Archiving needs a confirmation tick.
- Archiving deletes nothing. Archived clients stay openable at `/clients/[id]` (to restore them) and are
  listed under the Clients page's **Archived** filter.
- On hold mutes site alerts; a successful Stripe payment releases it (billing domain, unchanged).
- Details: status, plan price, lifetime value and Stripe ids are not editable here; Stripe owns them.
  An empty contact is stored as `Unknown` and an empty email as `no-email`, the placeholders Stripe
  intake uses, so the Stripe `customer.updated` backfill still fills them later.
- Website addresses: https only (a bare domain gets `https://`), no logins, no IP addresses, at most
  500 characters, at most 20 per client, no duplicates for the client (ignoring scheme, `www.`, case
  and a trailing slash).
- Which address is monitored (`monitoredAddress` in rules.ts) is the scanner's own rule: the oldest
  project's live address, otherwise the client's oldest website. A test checks it against
  `buildScanTargets` in the monitoring domain. The Websites tab marks that address as **Monitored**.
- Not part of this change: logo upload and project fields other than the live address (staging, GitHub, hosting,
  Sentry, contract).

## Leads

Where: the Growth screen (`/growth`): **Add lead**, and in an opened lead (`?lead=<id>`) stage buttons, a follow-up
date, **Edit details** and **Delete lead**. A collapsed **Won and lost** list makes closed leads reachable again.
Code: `src/domains/growth/service.ts` (permission `growth.write`, owner only; reads stay `growth.read`), rules in
`growth/rules.ts`, input shapes in `growth/schemas.ts`. Writes run as the signed-in owner (RLS applies).

| Change | Service function | Audit action |
| --- | --- | --- |
| Add a lead | `createLead` | `lead.created` |
| Edit details | `updateLead` | `lead.updated` (changed field names only) |
| Change stage | `setLeadStage` | `lead.stage_changed` (before/after stage) |
| Set or clear follow-up date | `setLeadFollowUp` | `lead.updated` |
| Delete | `deleteLead` (confirmation tick) | `lead.deleted` |

Rules:
- Stages are written as the old app's status values (`STAGE_TO_STATUS`: New lead → interested, In discussion →
  contacted, Proposal sent → quoted, Won, Lost), the only values `leads_status_check` accepts while the old app
  shares the database.
- Fields as in the old Quick Add: name (required), business name (blank → "Not given"), email, phone, notes,
  follow-up date, source (free text, old suggestion list plus "Website form"), estimated value (0 to $10M, cents).
- The same lead added again within 2 minutes (name plus email, else phone, else business name) returns the one
  already saved. At most 30 lead changes a minute.
- Audit rows never carry names, emails, phone numbers or notes.
- Won does not create a client (same as the old app). Not ported: the old leads page's status and source filters,
  and a Quick Add menu entry.

## Sync from Stripe

See doc 14, "Sync from Stripe". Settings → Stripe.
