-- 0010_bot_writes.sql
-- Bot write API (docs/architecture/18-bot-write-api.md).
--
-- NOT APPLIED. Staging first, then production only with the owner's approval for this
-- migration. Do not run this against production as part of development or CI.
--
-- ADDITIVE:
--   * audit_log.actor_type may be 'bot' (the check constraint is replaced with the old list plus 'bot')
--   * audit_log.actor_name (nullable) — which bot, when actor_type is bot
--   * requests.coverage (nullable) — 'included' (in monthly care) or 'addon' (quoted separately)
--   * bot_idempotency_keys — one row per bot + idempotency key, so a retried daily batch does not write twice
--
-- No existing column is dropped or retyped. Existing rows keep working: coverage and actor_name stay null,
-- and every current actor_type still passes the check. The old app does not read these columns.
-- Safe to run twice.
--
-- The bot API refuses to write until this migration is visible (it looks for bot_idempotency_keys).
-- Owner screens do not select the new columns, so they keep working before this is applied.
-- A request that classifies included vs add-on still records that on the existing billable_flag,
-- counts_toward_quota and estimated_charge columns if `coverage` itself is not visible yet.
--
-- ROLLBACK (only after you have stopped the bot API and are sure no bot audit rows must be kept):
--   drop table if exists public.bot_idempotency_keys;
--   alter table public.requests drop constraint if exists requests_coverage_check;
--   alter table public.requests drop column if exists coverage;
--   alter table public.audit_log drop constraint if exists audit_log_actor_name_check;
--   alter table public.audit_log drop column if exists actor_name;
--   alter table public.audit_log drop constraint if exists audit_log_actor_type_check;
--   alter table public.audit_log add constraint audit_log_actor_type_check
--     check (actor_type in ('owner', 'contractor', 'client', 'system', 'integration', 'ai'));
-- The last two lines fail if any row has actor_type 'bot'. Delete is not provided here on purpose:
-- audit_log is insert-only.

-- ---------------------------------------------------------------------------
-- Audit attribution
-- ---------------------------------------------------------------------------
alter table public.audit_log drop constraint if exists audit_log_actor_type_check;
alter table public.audit_log add constraint audit_log_actor_type_check
  check (actor_type in ('owner', 'contractor', 'client', 'system', 'integration', 'ai', 'bot'));

alter table public.audit_log add column if not exists actor_name text;
alter table public.audit_log drop constraint if exists audit_log_actor_name_check;
alter table public.audit_log add constraint audit_log_actor_name_check
  check (actor_name is null or (char_length(actor_name) between 1 and 40 and actor_name ~ '^[a-z0-9][a-z0-9-]*$'));

comment on column public.audit_log.actor_name is
  'Which named machine acted. Set for actor_type bot. Null for people and for older rows.';

-- ---------------------------------------------------------------------------
-- Change-request classification: included in care, or an add-on
-- ---------------------------------------------------------------------------
alter table public.requests add column if not exists coverage text;
alter table public.requests drop constraint if exists requests_coverage_check;
alter table public.requests add constraint requests_coverage_check
  check (coverage is null or coverage in ('included', 'addon'));

comment on column public.requests.coverage is
  'included = counts toward monthly care (counts_toward_quota, not billable). addon = quoted separately (billable_flag, estimated_charge). NULL = not classified (Quick Add and older rows).';

-- ---------------------------------------------------------------------------
-- Idempotency for the daily bot batch. Not CRM data: a lock and a stored result.
-- Server-only. RLS is on with no policy, so authenticated and anon cannot read it.
-- service_role bypasses RLS and is granted DML, including delete, so a failed
-- attempt can drop its own pending lock. That delete never touches a CRM row.
-- ---------------------------------------------------------------------------
create table if not exists public.bot_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  bot_name text not null,
  idempotency_key text not null,
  operation text not null,
  payload_hash text not null,
  status text not null default 'pending',
  entity_type text,
  entity_id text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bot_idempotency_keys_bot_name_check check (char_length(bot_name) between 1 and 40 and bot_name ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint bot_idempotency_keys_key_check check (char_length(idempotency_key) between 8 and 80),
  constraint bot_idempotency_keys_status_check check (status in ('pending', 'completed')),
  constraint bot_idempotency_keys_hash_check check (char_length(payload_hash) = 64),
  constraint bot_idempotency_keys_unique unique (bot_name, idempotency_key)
);

create index if not exists bot_idempotency_keys_created_idx on public.bot_idempotency_keys (created_at);

comment on table public.bot_idempotency_keys is
  'Bot write API idempotency. One row per bot and key. Pending is a lock; completed stores the result so a retry returns it.';

alter table public.bot_idempotency_keys enable row level security;

revoke all on table public.bot_idempotency_keys from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.bot_idempotency_keys to service_role;

-- Ask PostgREST to notice the new table and columns. Harmless if nothing is listening.
notify pgrst, 'reload schema';
