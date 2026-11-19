# Bot write API

Added 2026-11-19. Lets Jacob's assistant bots write a daily batch of CRM changes without using the browser. It is separate from the read-only assistant connector (`POST /api/mcp`, doc 12). That connector and the `ai` actor stay read-only.

The bot does not click through an approval screen in the app. Jacob reviews the batch before the bot submits it. The API then writes through the same domain services the owner screens use, so the permission check and the audit log apply. Money, legal records, invoices, agreements, permissions and deletes are not available.

## What it is

`POST /api/bot/writes` (`src/app/api/bot/writes/route.ts`). One JSON batch. `GET`, `PUT` and `DELETE` return 405. The work itself lives in `src/domains/bot` and calls `src/domains/growth`, `src/domains/clients` and `src/domains/work`.

Reads stay on `POST /api/mcp`. This API does not return client lists, notes or contact details.

## URL, key and bot name

```
POST https://www.luminateos.app/api/bot/writes
Authorization: Bearer <BOT_WRITE_API_KEY>
X-Bot-Name: daily-crm
Content-Type: application/json
```

Use the `www` host. The bare domain redirects, and clients do not follow redirects reliably.

`BOT_WRITE_API_KEY` is its own variable, not `MCP_API_KEY`. At least 32 random characters, otherwise the API is off (503). If the two variables are set to the same value, the write API stays off (503): the read-only key must not also be able to write. The key is compared in constant time, is never logged, and is never accepted from the query string (a write key must not land in URLs or access logs).

`X-Bot-Name` is required. Lowercase letters, digits and hyphens, 1–40 characters, starting with a letter or digit (`daily-crm`). It is the name stored on the audit row, so two bots that share the key are still distinct.

## What a bot may write

| Operation | What it does | Permission |
| --- | --- | --- |
| `lead.create` | New lead, stage New lead | `leads.write` |
| `lead.update` | Change only the lead fields that were sent, including `stage` | `leads.write` |
| `note.create` | Internal note on a client | `notes.write` |
| `note.update` | Replace that note's text | `notes.write` |
| `request.create` | Change request for a client | `work.write` |
| `request.comment` | Internal comment on a request (`author_type` admin, not shown to the client) | `work.write` |
| `task.create` | Internal task | `work.write` |
| `task.update` | Change only the task fields that were sent | `work.write` |

The `bot` actor has those three permissions and no others (`src/platform/auth/permissions.ts`). It cannot delete a lead (`growth.write` stays with the owner), archive a client, edit websites, send invoices, record payments, change settings or call the assistant tools. The `ai` actor still has no write permission.

`lead.update` is a partial edit on purpose. The read-only connector does not return emails, phones or notes, so sending a full lead form back would wipe them. Omit a field to leave it. `stage` uses the same names as the Growth screen: `new_lead`, `in_discussion`, `proposal_sent`, `won`, `lost`.

### Change request: included in care, or an add-on

`request.create` takes the same fields as Quick Add (`clientId`, `title`, `description`, `priority`, `source`, `websiteUrl`) plus:

| Field | Values |
| --- | --- |
| `coverage` | `included` (counts toward monthly care) or `addon` (quoted separately). Omit it to leave the request unclassified, which is what Quick Add does. |
| `price` | Optional dollars, only when `coverage` is `addon`. Example: `150` or `150.50`. This is an estimate on the request (`estimated_charge`). It does not create an invoice, a payment or a Stripe charge. |
| `status` | `new` (the default), `in_review`, `in_progress`, `waiting_on_client`, `completed`. |

`included` sets `counts_toward_quota`, clears the billable flag and stores no price. `addon` sets `billable_flag` and stores the price (0 when none was sent). Migration 0010 also adds `requests.coverage`. If that column is not visible yet, the request is still saved with the three existing columns, and the result says `coverageStored: false`.

## Idempotency and batches

Send 1 to 25 operations. Each one has an idempotency key (8–80 characters: letters, digits and `: . _ / -`). A retry of the same bot name, key and body returns the stored result and does not write again (`replayed: true`). The same key with a different body is rejected. Keys are per bot name.

Operations run in order. One failure does not undo the others. A later operation can use an id from an earlier one in the same batch:

```json
{ "requestId": { "$ref": "2026-11-19:req:acme-hours" } }
```

The hash is taken from the body you sent, before `$ref` is replaced, so a retry still matches.

A new lead or request with the same details inside two minutes is also treated as the one already saved (`duplicate: true`), the same rule as the owner forms. The idempotency key is what makes a retry the next day safe. Tasks are also matched by a source reference built from the bot name and the key.

The store is `bot_idempotency_keys` (migration 0010). Until that table is visible the API returns 503 and writes nothing. A failed attempt drops its own pending lock so the key can be retried. That delete is the lock only. It is not a CRM delete.

There is a limit of 30 batches a minute per address, and 10 failed key checks per 10 minutes, then 429. Both are in memory on one server instance, same as the read-only connector. The body is at most 256 KB. Every response sends `Cache-Control: no-store`.

## Example

```http
POST /api/bot/writes HTTP/1.1
Host: www.luminateos.app
Authorization: Bearer <BOT_WRITE_API_KEY>
X-Bot-Name: daily-crm
Content-Type: application/json

{
  "operations": [
    {
      "idempotencyKey": "2026-11-19:lead:ada",
      "op": "lead.create",
      "input": {
        "name": "Ada Lovelace",
        "businessName": "Analytical Engines",
        "email": "ada@example.com",
        "source": "Referral"
      }
    },
    {
      "idempotencyKey": "2026-11-19:req:acme-hours",
      "op": "request.create",
      "input": {
        "clientId": "11111111-1111-4111-8111-111111111111",
        "title": "Update the opening hours",
        "coverage": "included",
        "status": "new"
      }
    },
    {
      "idempotencyKey": "2026-11-19:req:acme-hours:comment",
      "op": "request.comment",
      "input": {
        "requestId": { "$ref": "2026-11-19:req:acme-hours" },
        "body": "Included in this month's care."
      }
    },
    {
      "idempotencyKey": "2026-11-19:note:acme",
      "op": "note.create",
      "input": {
        "clientId": "11111111-1111-4111-8111-111111111111",
        "content": "Asked for the hours to go live on Friday."
      }
    },
    {
      "idempotencyKey": "2026-11-19:task:hours",
      "op": "task.create",
      "input": {
        "title": "Publish the new opening hours",
        "clientId": "11111111-1111-4111-8111-111111111111",
        "priority": "normal",
        "dueDate": "2026-11-21"
      }
    }
  ]
}
```

```json
{
  "results": [
    { "idempotencyKey": "2026-11-19:lead:ada", "op": "lead.create", "ok": true, "replayed": false, "id": "…", "duplicate": false, "idempotencyRecorded": true },
    { "idempotencyKey": "2026-11-19:req:acme-hours", "op": "request.create", "ok": true, "replayed": false, "id": "…", "displayId": "LUM-1204", "duplicate": false, "coverageStored": true, "idempotencyRecorded": true },
    { "idempotencyKey": "2026-11-19:req:acme-hours:comment", "op": "request.comment", "ok": true, "replayed": false, "id": "…", "idempotencyRecorded": true },
    { "idempotencyKey": "2026-11-19:note:acme", "op": "note.create", "ok": true, "replayed": false, "id": "…", "idempotencyRecorded": true },
    { "idempotencyKey": "2026-11-19:task:hours", "op": "task.create", "ok": true, "replayed": false, "id": "…", "duplicate": false, "idempotencyRecorded": true }
  ]
}
```

A failed operation looks like `{ "ok": false, "replayed": false, "error": "That client could not be found." }`. The HTTP status is still 200 when the batch was accepted. 401 means the key was wrong. 503 means the API is off or migration 0010 is not visible. 400 means the batch itself is invalid (for example the same key twice).

An add-on with a price:

```json
{
  "idempotencyKey": "2026-11-19:req:acme-page",
  "op": "request.create",
  "input": {
    "clientId": "11111111-1111-4111-8111-111111111111",
    "title": "Add a services page",
    "coverage": "addon",
    "price": 350,
    "status": "in_review"
  }
}
```

## Audit

Every successful write goes through `writeAudit`. The row's `actor_type` is `bot`, `actor_name` is the `X-Bot-Name` value, and `request_ip` is the caller. The after payload also contains `bot`, so the audit log screen can show `bot (daily-crm)` even from the payload. Note text, comment text and lead contact details are not copied into the audit row. The record itself holds them.

Settings → System status lists `BOT_WRITE_API_KEY` as present or not. It never shows the value.

## Migration 0010 — not applied

`supabase/migrations/0010_bot_writes.sql` is in this change and has **not** been applied to staging or production. It is additive:

- `audit_log.actor_type` may be `bot`, plus nullable `actor_name`
- nullable `requests.coverage` (`included` or `addon`)
- `bot_idempotency_keys`, server-only (row-level security on, no policy, granted only to `service_role`)

Owner screens do not read the new columns, so they keep working before the migration runs. Do not apply it to production without the owner's approval for this specific migration. Apply it to staging first.

## Before this can be used in production

1. Apply migration 0010 to staging and confirm a batch against staging. Then apply it to production, with explicit approval for that migration.
2. In Vercel, set `BOT_WRITE_API_KEY` on Production (and Preview, if bots should hit preview). At least 32 random characters. It must not equal `MCP_API_KEY`.
3. Redeploy so the new variable is picked up. Until the variable is set, `POST /api/bot/writes` returns 503 and writes nothing.
4. Settings → System status should list `BOT_WRITE_API_KEY` as present.
5. Do not merge this, deploy it, or run the migration until those steps are intended. This change does not deploy and does not touch production data.

## Rotating or switching off

Change `BOT_WRITE_API_KEY` in Vercel and redeploy, then update the bots. Remove the variable, or shorten it below 32 characters, to switch the API off. The read-only connector is unaffected.
