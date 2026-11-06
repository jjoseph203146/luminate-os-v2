# Operations: install, notifications, website leads, monitoring (2026-11-05)

Added so the owner can use v2 daily on a phone. Additive only: no existing table or policy changed.

## Installable app
`src/app/manifest.ts` serves `/manifest.webmanifest`; icons are in `public/icons/`. The manifest, `/sw.js`,
`/icons/*` and `/logo.png` are public paths (the browser asks for them before sign-in).

## Push notifications
- Server: `web-push` with a VAPID key pair (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). Not set = push is off, nothing breaks.
- Devices live in `push_devices` (migration 0004). The old app's `push_subscriptions` table is never read or written.
- `public/sw.js` only shows notifications and opens the tapped link. It caches nothing.
- The list of notifications and when each fires is `src/domains/notifications/events.ts`, shown on Settings > Notifications.

## Website contact form
`POST /api/leads/create` (same path as the old app). Public; checks the Origin against `LEAD_FORM_ORIGINS`
(default: luminatewebdesign.com and www), 5 posts per 10 minutes per IP, a 30-per-hour cap in the database,
bot trap fields, field validation, a 10-minute duplicate check. Stores the lead with source "Website form",
status "interested", and pushes a notification.

## Site monitoring
The checks still run in the old app (`site_monitors`, `site_issues`). v2 reads them (Monitoring screen) and runs the
`monitor_alerts` job every 5 minutes on the existing tick. `alert_state` remembers what was announced.
One owner per scheduled job (CLAUDE.md): the old app keeps the checks; v2 owns the alerts. Until the old app's own push
subscription is removed, both apps may alert about the same outage.

## Payment and client activity alerts (added 2026-11-06)
The `activity_alerts` job (migration `0005`, every 5 minutes on the existing tick) pushes a notification once for each:
- **Payment received / failed**, from `revenue_events` (written by the old app's Stripe webhook). A failed payment that is later paid announces both. No failed alert for clients on hold or archived (same as the old app).
- **New client request / comment**, from the `notifications` rows the old client portal writes (`new_request`, `new_comment`). Requests added in v2 Quick Add write no such row, so they do not notify. Comment text is never put in a notification.

The webhook and the portal stay in the old app; this job only reads what they wrote and writes `alert_state` (keys `payment:<id>`, `notif:<id>`, `activity:seeded`). The first run records what already exists without notifying, only the last 14 days are looked at, and at most 10 pushes go out per run. Until the old app's matching pushes are muted (`OLD_PUSH_MUTE=payment_received,payment_failed,new_request,new_comment`), both apps notify.
