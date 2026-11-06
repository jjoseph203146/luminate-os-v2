-- 0007_integration_events.sql
-- A ledger of incoming webhook events (Stripe), so each event is processed once even though Stripe retries
-- deliveries, and so the owner can see what arrived and whether it was handled (docs/architecture/14).
--
-- ADDITIVE ONLY: one new table. Nothing existing is changed. The old app never reads it.
-- Safe to run twice.
--
-- Run order: after 0006. Staging first, then production with the owner's approval.
-- Until this table exists the v2 Stripe webhook answers 500 (Stripe then retries), so apply it BEFORE the
-- Stripe endpoint is pointed at v2.
--
-- ROLLBACK (only before the endpoint is pointed at v2): drop table public.integration_events;

create table if not exists public.integration_events (
  id text primary key,
  source text not null default 'stripe',
  type text not null,
  livemode boolean not null default false,
  status text not null default 'processing',
  attempts integer not null default 1,
  error text,
  received_at timestamptz not null default now(),
  claimed_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint integration_events_status_check check (status in ('processing', 'processed', 'failed', 'ignored')),
  constraint integration_events_attempts_positive check (attempts >= 1),
  constraint integration_events_id_length check (char_length(id) <= 255),
  constraint integration_events_error_length check (error is null or char_length(error) <= 300)
);

create index if not exists integration_events_received_idx on public.integration_events (received_at desc);

alter table public.integration_events enable row level security;

-- Owners can read the ledger. Only the server writes it.
drop policy if exists owner_select on public.integration_events;
create policy owner_select on public.integration_events as permissive for select to authenticated
  using (user_role() = 'admin');

revoke all on table public.integration_events from public, anon, authenticated, service_role;
grant select on table public.integration_events to authenticated;
grant select, insert, update on table public.integration_events to service_role;
