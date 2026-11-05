-- 0004_push_and_monitor_alerts.sql
-- Push notifications to the owner's phone, and the state the site-monitoring alert job needs.
--
-- ADDITIVE ONLY. The old app shares this database, so this creates new objects and touches
-- nothing that exists. The old app's own `push_subscriptions` table is NOT used or changed:
-- v2 has its own `push_devices`, so the two apps can never delete each other's devices.
--
-- Run order: apply 0003 first (privileges), then this file. Staging first, then production
-- with the owner's approval for this specific migration.

-- ---------------------------------------------------------------------------
-- Phones and browsers that have allowed notifications (one row per device)
-- ---------------------------------------------------------------------------
create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  label text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0,
  constraint push_devices_endpoint_length check (char_length(endpoint) <= 2048),
  constraint push_devices_label_length check (label is null or char_length(label) <= 80),
  constraint push_devices_failures_valid check (failure_count >= 0)
);

create index push_devices_owner_idx on public.push_devices (owner_id);

-- ---------------------------------------------------------------------------
-- What the alert job last told the owner, so one problem is one notification
-- ---------------------------------------------------------------------------
create table public.alert_state (
  key text primary key,
  state text not null,
  detail jsonb,
  notified_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint alert_state_key_length check (char_length(key) <= 200)
);

-- ---------------------------------------------------------------------------
-- The alert job. Runs on the existing scheduler tick (POST /api/jobs/tick).
-- ---------------------------------------------------------------------------
insert into public.jobs (key, name, description, interval_minutes)
values ('monitor_alerts', 'Site monitoring alerts',
        'Reads the site checks and sends a push notification when a site goes down or recovers, when a certificate or domain is close to expiring, or when checks stop arriving.', 5)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Row-level security and grants (explicit, like 0001)
-- ---------------------------------------------------------------------------
alter table public.push_devices enable row level security;
alter table public.alert_state enable row level security;

-- An owner manages only their own devices. alert_state has no policy: only the server uses it.
create policy owner_own_devices on public.push_devices as permissive for all to authenticated
  using (user_role() = 'admin' and owner_id = auth.uid())
  with check (user_role() = 'admin' and owner_id = auth.uid());

revoke all on table public.push_devices from public, anon, authenticated, service_role;
revoke all on table public.alert_state from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.push_devices to authenticated;
-- The server sends notifications, records success or failure, and removes dead devices.
grant select, update, delete on table public.push_devices to service_role;

grant select, insert, update, delete on table public.alert_state to service_role;
