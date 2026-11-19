-- 0011_lead_pipeline.sql
-- Lead-to-client link, pipeline fields, and an append-only activity log
-- (docs/architecture/19-lead-client-link.md).
--
-- NOT APPLIED. Staging first, then production only with the owner's approval for this
-- migration. Do not run this against production as part of development or CI.
-- This file does not backfill Won leads. That is a separate dry-run script
-- (scripts/backfill-won-clients.ts) and it is not run from here.
--
-- ADDITIVE. The v1 check leads_status_check is left exactly as it is
-- (interested, contacted, quoted, won, lost). No existing column is dropped,
-- retyped, or given a new NOT NULL. Existing rows keep working: every new
-- column stays null, and the old app does not read them.
-- Safe to run twice.
--
-- The Growth screen still lists leads when these columns are missing. Saving a
-- pipeline field, replacing a note, or marking a lead Won needs this migration.
--
-- ROLLBACK (only before any client_id, activity, or note revision must be kept):
--   drop trigger if exists trg_lead_activities_touch_lead on public.lead_activities;
--   drop trigger if exists trg_leads_stage_changed_at on public.leads;
--   drop function if exists public.lead_activities_touch_lead();
--   drop function if exists public.leads_stamp_stage_changed_at();
--   drop table if exists public.lead_activities;
--   drop table if exists public.client_note_revisions;
--   alter table public.leads drop constraint if exists leads_client_id_fkey;
--   alter table public.leads drop constraint if exists leads_lost_reason_check;
--   alter table public.leads drop constraint if exists leads_kind_check;
--   alter table public.leads drop constraint if exists leads_next_step_check;
--   alter table public.leads drop constraint if exists leads_campaign_check;
--   alter table public.leads drop column if exists client_id;
--   alter table public.leads drop column if exists stage_changed_at;
--   alter table public.leads drop column if exists last_touch_at;
--   alter table public.leads drop column if exists next_step;
--   alter table public.leads drop column if exists next_step_on;
--   alter table public.leads drop column if exists lost_reason;
--   alter table public.leads drop column if exists kind;
--   alter table public.leads drop column if exists campaign;
-- Do not drop leads_status_check. The old app still needs it.

-- ---------------------------------------------------------------------------
-- Pipeline columns on leads. Status stays the stage the old app understands.
-- ---------------------------------------------------------------------------
alter table public.leads add column if not exists client_id uuid;
alter table public.leads add column if not exists stage_changed_at timestamptz;
alter table public.leads add column if not exists last_touch_at timestamptz;
alter table public.leads add column if not exists next_step text;
alter table public.leads add column if not exists next_step_on date;
alter table public.leads add column if not exists lost_reason text;
alter table public.leads add column if not exists kind text;
alter table public.leads add column if not exists campaign text;

alter table public.leads drop constraint if exists leads_client_id_fkey;
alter table public.leads
  add constraint leads_client_id_fkey
  foreign key (client_id) references public.clients (id) on delete set null;

alter table public.leads drop constraint if exists leads_next_step_check;
alter table public.leads add constraint leads_next_step_check
  check (next_step is null or char_length(next_step) between 1 and 200);

alter table public.leads drop constraint if exists leads_lost_reason_check;
alter table public.leads add constraint leads_lost_reason_check
  check (lost_reason is null or lost_reason in ('price', 'timing', 'competitor', 'unresponsive', 'not_fit', 'other'));

alter table public.leads drop constraint if exists leads_kind_check;
alter table public.leads add constraint leads_kind_check
  check (kind is null or kind in ('inbound', 'outbound'));

alter table public.leads drop constraint if exists leads_campaign_check;
alter table public.leads add constraint leads_campaign_check
  check (campaign is null or char_length(campaign) between 1 and 80);

comment on column public.leads.client_id is
  'Client this lead became, once Won (contract signed and deposit paid). Null until then. ON DELETE SET NULL so archiving history does not depend on the client row.';
comment on column public.leads.stage_changed_at is
  'When status last changed. Null on rows that have not changed stage since this column was added.';
comment on column public.leads.last_touch_at is
  'Latest email, call, meeting, note, or outreach. A stage change does not move it. Doc 05 calls the same idea last_engaged_at.';
comment on column public.leads.next_step is
  'The next thing to do on this lead. Free text, not a task.';
comment on column public.leads.next_step_on is
  'The date that next step is due. Separate from follow_up_date, which the old app already uses.';
comment on column public.leads.lost_reason is
  'Why a lost lead was lost. Null on older lost rows and on open leads.';
comment on column public.leads.kind is
  'inbound or outbound. Null when it was not recorded.';
comment on column public.leads.campaign is
  'Marketing campaign label, when there is one. Not a foreign key.';

create index if not exists leads_client_id_idx on public.leads (client_id);

-- Stamps stage_changed_at when status changes, including updates from the old app.
-- An update that sets stage_changed_at itself keeps that value.
create or replace function public.leads_stamp_stage_changed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.stage_changed_at is null then
      new.stage_changed_at := now();
    end if;
  elsif new.status is distinct from old.status
    and new.stage_changed_at is not distinct from old.stage_changed_at then
    new.stage_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_stage_changed_at on public.leads;
create trigger trg_leads_stage_changed_at
  before insert or update of status, stage_changed_at on public.leads
  for each row execute function public.leads_stamp_stage_changed_at();

-- ---------------------------------------------------------------------------
-- Append-only lead activities. Deleting a lead removes its activities
-- (ON DELETE CASCADE) so the existing delete still works. The audit log keeps
-- the fact of the change, without the note text.
-- Grants are select and insert only. service_role does not get update or delete.
-- ---------------------------------------------------------------------------
create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  kind text not null,
  direction text,
  occurred_at timestamptz not null default now(),
  summary text not null,
  -- Previous lead notes, when kind is 'note' and the notes field was replaced.
  -- The new text stays on leads.notes. This column is the history.
  body text,
  actor_type text,
  actor_name text,
  created_at timestamptz not null default now(),
  constraint lead_activities_kind_check check (kind in ('email', 'call', 'meeting', 'note', 'outreach', 'stage')),
  constraint lead_activities_direction_check check (direction is null or direction in ('inbound', 'outbound')),
  constraint lead_activities_summary_check check (char_length(summary) between 1 and 300),
  constraint lead_activities_body_check check (body is null or char_length(body) <= 8000),
  constraint lead_activities_actor_type_check check (actor_type is null or actor_type in ('owner', 'contractor', 'client', 'system', 'integration', 'ai', 'bot')),
  constraint lead_activities_actor_name_check check (actor_name is null or (char_length(actor_name) between 1 and 40 and actor_name ~ '^[a-z0-9][a-z0-9-]*$'))
);

create index if not exists lead_activities_lead_occurred_idx on public.lead_activities (lead_id, occurred_at desc);

comment on table public.lead_activities is
  'Append-only history for a lead: touches and stage changes. kind note stores the previous notes text in body when notes are replaced.';

-- A stage row does not count as a touch. Any other kind moves last_touch_at forward only.
create or replace function public.lead_activities_touch_lead()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind is distinct from 'stage' then
    update public.leads
      set last_touch_at = new.occurred_at
      where id = new.lead_id
        and (last_touch_at is null or last_touch_at < new.occurred_at);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lead_activities_touch_lead on public.lead_activities;
create trigger trg_lead_activities_touch_lead
  after insert on public.lead_activities
  for each row execute function public.lead_activities_touch_lead();

alter table public.lead_activities enable row level security;

drop policy if exists owner_select on public.lead_activities;
create policy owner_select on public.lead_activities
  as permissive for select to authenticated
  using (user_role() = 'admin');

drop policy if exists owner_insert on public.lead_activities;
create policy owner_insert on public.lead_activities
  as permissive for insert to authenticated
  with check (user_role() = 'admin');

revoke all on table public.lead_activities from public, anon, authenticated, service_role;
grant select, insert on table public.lead_activities to authenticated;
grant select, insert on table public.lead_activities to service_role;

-- ---------------------------------------------------------------------------
-- Previous text of a client note, written before note.update replaces it.
-- client_notes itself still holds the current text. Append-only by grant.
-- ---------------------------------------------------------------------------
create table if not exists public.client_note_revisions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.client_notes (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  previous_content text not null,
  actor_type text,
  actor_name text,
  created_at timestamptz not null default now(),
  constraint client_note_revisions_content_check check (char_length(previous_content) between 1 and 8000),
  constraint client_note_revisions_actor_type_check check (actor_type is null or actor_type in ('owner', 'contractor', 'client', 'system', 'integration', 'ai', 'bot')),
  constraint client_note_revisions_actor_name_check check (actor_name is null or (char_length(actor_name) between 1 and 40 and actor_name ~ '^[a-z0-9][a-z0-9-]*$'))
);

create index if not exists client_note_revisions_note_idx on public.client_note_revisions (note_id, created_at desc);

comment on table public.client_note_revisions is
  'Append-only previous text of a client note. The audit log records the length, not the text.';

alter table public.client_note_revisions enable row level security;

drop policy if exists owner_select on public.client_note_revisions;
create policy owner_select on public.client_note_revisions
  as permissive for select to authenticated
  using (user_role() = 'admin');

drop policy if exists owner_insert on public.client_note_revisions;
create policy owner_insert on public.client_note_revisions
  as permissive for insert to authenticated
  with check (user_role() = 'admin');

revoke all on table public.client_note_revisions from public, anon, authenticated, service_role;
grant select, insert on table public.client_note_revisions to authenticated;
grant select, insert on table public.client_note_revisions to service_role;

notify pgrst, 'reload schema';
