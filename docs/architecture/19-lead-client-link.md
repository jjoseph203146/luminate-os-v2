# 19. Lead-to-client link and pipeline fields

Build-order step 2. Migration **0011**. It has **not** been applied to staging or production. Do not apply it, and do not run the backfill, without the owner's approval for that specific action. This change does not deploy and does not touch production data.

SOP2 §2 still says Won is a signed agreement and the deposit may still be pending, and that Won then creates a project, a deposit milestone and onboarding tasks. This step does not do that, and it does not change the SOP. It raises the difference as D26 in doc 09. Here, Won means the contract is signed **and** the deposit is paid, and the only automatic result is a client link.

## What was added

Migration `supabase/migrations/0011_lead_pipeline.sql` is additive. `leads_status_check` is unchanged (`interested`, `contacted`, `quoted`, `won`, `lost`). No existing column is dropped or retyped. Existing rows stay valid because every new column is nullable.

| Addition | Purpose |
| --- | --- |
| `leads.client_id` | Nullable foreign key to `clients`. `ON DELETE SET NULL`, so a client row going away does not delete the lead. |
| `leads.stage_changed_at` | Set when `status` changes, including by the old app (trigger). |
| `leads.last_touch_at` | Latest email, call, meeting, note, or outreach. A stage change does not move it. Doc 05 calls the same idea `last_engaged_at`. |
| `leads.next_step`, `next_step_on` | The next thing to do, and the date. Doc 05 calls these `next_action` and `next_action_on`. |
| `leads.lost_reason` | `price`, `timing`, `competitor`, `unresponsive`, `not_fit`, `other`, or null. |
| `leads.kind`, `leads.campaign` | `inbound` or `outbound`, and an optional campaign label. |
| `lead_activities` | Append-only. Kinds: `email`, `call`, `meeting`, `note`, `outreach`, `stage`. |
| `client_note_revisions` | Append-only previous text of a client note, written before `note.update` replaces it. |

`lead_activities.kind = 'note'` stores the **previous** lead notes in `body` when that field is replaced. The new text stays on `leads.notes`. The audit row records the length and the history id, not the text. The same rule applies to client notes: the previous text is in `client_note_revisions`, and the audit row records lengths only.

Deleting a lead still works. Its activities go with it (`ON DELETE CASCADE`). The audit log keeps the fact of the delete. Client-note revisions follow the note and the client the same way the existing `client_notes` rows do.

Until 0011 is applied, the Growth screen still lists leads. Saving a pipeline field, replacing notes, or marking a lead Won is refused with a message to apply 0011. The lead is left as it was for those writes.

## Won

The owner ticks **Contract is signed** and **Deposit is paid**, then marks the lead Won. The service:

1. links `leads.client_id` to the client the owner typed, or
2. links the one non-archived client with the same email, or else the same business name, or
3. creates one client (`status` active, no Stripe id) and an account row, then links it.

Several matches are refused. The owner types the client id. Placeholders (`no-email`, `Not given`, `Unnamed`) do not match. An archived client is not matched automatically.

A second Won on a lead that is already linked does not create another client. This step does not create a project, a milestone, an invoice, or a Stripe charge. Won is not revenue.

Stage changes write `stage_changed_at` and a `lead_activities` row of kind `stage`. Lost requires a reason.

## Bot write API

`lead.update` may set `nextStep`, `nextStepOn`, `lostReason`, `lastTouchAt`, `kind`, `campaign`, and a stage other than Won. A bot cannot send `stage: "won"` or `clientId` on `lead.update` or `lead.create`. It records a signed contract and a paid deposit in a lead note. The owner then ticks Won in the app, which is what links or creates the client. The bot still cannot delete a lead, and it has no billing, Stripe, invoice, or `growth.backfill` permission.

Creating a lead with any of the new pipeline fields set, before migration 0011 is visible, returns the same "apply migration 0011" message as the other writes that need those columns. The lead is not saved.

`note.update` writes the previous text to `client_note_revisions` before replacing it. If that table is missing, the note is not changed.

### One shared key

`X-Bot-Name` is **not a credential**. Every bot uses the same `BOT_WRITE_API_KEY`. The caller declares the name, and the API checks only that it matches the shape (`daily-crm`). Anyone who has the key can send any allowed name, and the audit row will show that name. The name is there so the audit log can say which bot Jacob's batch claimed to be. It does not separate access. To cut a bot off, rotate the one key.

## Won backfill

`scripts/backfill-won-clients.ts`. It is not a migration and it does not run on deploy.

A paying client is a non-archived client with `lifetime_value > 0` or a `revenue_events` row of status `paid` and amount greater than zero. The 2026-11-04 snapshot described 13 clients, of which 12 were the paying ones. The dry run prints `payingCount`. Confirm that list. The script does not insist the count is 12, because staging may hold made-up data.

For each paying client it links one unlinked lead (email, then exact business name) and marks that lead Won, or reports the client as unmatched or ambiguous. It does not invent a lead. An already-Won lead with no client is linked the same way, or a client is created when nothing matches. Applying the plan twice writes nothing new.

The output includes business names and ids so the list can be checked. It does not include emails, phones, or notes.

### How to run it

Dry-run and apply run on the **staging** Supabase project (or a local database), after migration 0011 is applied there. Do not point those two modes at production.

```bash
# Dry run. Reads and prints the plan. Writes nothing.
APP_ENV=staging npm run backfill:won -- --dry-run

# The same thing: dry run is the default.
APP_ENV=staging npm run backfill:won

# After the plan looks right. --confirm-url must equal NEXT_PUBLIC_SUPABASE_URL.
APP_ENV=staging npm run backfill:won -- --apply --confirm-url="$NEXT_PUBLIC_SUPABASE_URL"

# Or allow the project ref (the subdomain of <ref>.supabase.co) instead of --confirm-url.
APP_ENV=staging BACKFILL_ALLOWED_PROJECT_REF=<staging-ref> npm run backfill:won -- --apply
```

For `--dry-run` and `--apply`, `APP_ENV` must be `local` or `staging`. Unset and `production` both refuse, before any read, even if `--confirm-url` matches. `--apply` also refuses unless `--confirm-url` equals `NEXT_PUBLIC_SUPABASE_URL` (a trailing slash does not matter) or `BACKFILL_ALLOWED_PROJECT_REF` lists that URL's project ref. Either confirmation is enough. `--confirm-url` does not authorize production. This change does not set those variables. The script also uses `SUPABASE_SERVICE_ROLE_KEY` to connect.

A linked lead that loses a race leaves the extra client in place and records `linked: false` on that client. It does not delete the client.

Use only one of `--dry-run`, `--apply`, or `--preview`.

### Production preview

`--preview` is the only mode that may point at production. It reads and prints the planned actions. It does not call apply. It does not create clients, link leads, or write audit rows. The plan is built through a read-only data-access object: the Supabase client it holds has no insert, update, upsert, delete, or rpc, and calling any of those throws before a request is sent.

Jacob runs this himself, on his own machine, after migration 0011 is applied on production. The production service-role key stays on that machine. Do not commit it, paste it into chat, or put it in Vercel.

```bash
APP_ENV=production \
NEXT_PUBLIC_SUPABASE_URL=https://<prod-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key> \
npm run backfill:won -- --preview --i-know-this-is-production
```

`APP_ENV`, `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are the three variables he sets for this command. The URL is `https://<prod-ref>.supabase.co` for the production project. In production, `--preview` without `--i-know-this-is-production` refuses before any read. An unset `APP_ENV` refuses before any read. `--preview` together with `--apply` or `--dry-run` is an error.

The first lines of the output are the banner: `mode: preview`, the target project ref (not the key), and `READ ONLY, nothing written`. Under that: business names and ids, counts, `payingCount`, the roster, and the action names. Emails, phones, and notes are not printed.

On local or staging, `--preview` is the same read-only plan and does not need `--i-know-this-is-production`.

## Apply migration 0011

Staging first. Production only with explicit approval for this migration. The Supabase CLI applies numbered files in `supabase/migrations/`. 0010 is a separate migration and is not modified by this step. Owner screens keep working before 0011 runs. The old app keeps working because `leads.status` still uses the five values it already accepts.

Rollback notes are at the top of `0011_lead_pipeline.sql`. Do not drop `leads_status_check`.

## Tests

`src/domains/growth/rules.test.ts` covers matching, the 12-client plan, a second plan that has nothing left to write, the preview guard, and mixed flags. `service.test.ts` covers the Won gate, link versus create, lost reason, pipeline edits, note history, a dry run that does not write, a production preview that reads and does not write, and `--apply` refusing when `APP_ENV` is production or unset. `readonly-db.test.ts` covers the read-only client. `scripts/backfill-won-clients.test.ts` covers the preview banner and the refusal to print emails, phones, or notes. `migration.test.ts` checks that 0011 does not alter `leads_status_check`. `src/domains/clients/notes.test.ts` covers the previous text of a client note.
