-- 0009_billing_tasks.sql
-- SOP billing tasks (docs/architecture/17-billing-tasks.md): each client's care renewal schedule, one billing cycle
-- per renewal date, and the billing actions (Day -5 / 0 / +3 / +7) the scheduled job creates as tasks.
--
-- ADDITIVE ONLY: three new tables, one new partial unique index on internal_work_items, and one new jobs row.
-- No existing table, column, constraint, policy or grant is changed. The old app never reads the new tables; the
-- tasks it may see in internal_work_items are ordinary 'internal' tasks.
-- Safe to run twice.
--
-- Run order: after 0008. Staging first, then production with the owner's approval. Until this runs, the billing
-- job fails visibly (Automations) and the billing screens say billing tasks are not set up.
--
-- ROLLBACK (before any schedule is entered):
--   delete from public.jobs where key = 'billing_tasks';
--   drop index if exists public.internal_work_items_billing_key;
--   drop table public.billing_actions; drop table public.billing_cycles; drop table public.care_agreements;

-- One care billing schedule per client (a subset of the care_agreements design in doc 05; later phases add to it).
-- Normally kept in step with the client's Stripe subscription by the billing job (source 'stripe'); the owner can
-- instead manage one by hand (source 'manual'), for a client who does not pay through a Stripe subscription.
create table if not exists public.care_agreements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  plan_name text,
  monthly_price_cents integer not null,
  -- The day of the month the plan renews (1-31). In shorter months the renewal is the last day of the month.
  anniversary_day smallint not null,
  starts_on date not null,
  status text not null default 'active',
  -- Who sends the renewal invoice: the owner from Luminate OS, Stripe (an emailed invoice), or Stripe autopay.
  -- One sender only, so a client is never asked to pay twice.
  invoice_sender text not null default 'luminate',
  payment_link_url text,
  source text not null default 'stripe',
  stripe_subscription_id text,
  -- Billing tasks are created for renewals from this date on (set when the schedule is entered or resumed).
  tasks_from date not null default current_date,
  paused_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint care_agreements_status_check check (status in ('active', 'paused', 'cancelled')),
  constraint care_agreements_sender_check check (invoice_sender in ('luminate', 'stripe_invoice', 'stripe_autopay')),
  constraint care_agreements_day_check check (anniversary_day between 1 and 31),
  constraint care_agreements_price_check check (monthly_price_cents >= 0 and monthly_price_cents <= 10000000),
  constraint care_agreements_link_check check (payment_link_url is null or (payment_link_url ~ '^https://' and char_length(payment_link_url) <= 500)),
  constraint care_agreements_plan_length check (plan_name is null or char_length(plan_name) <= 80),
  constraint care_agreements_source_check check (source in ('stripe', 'manual')),
  constraint care_agreements_subscription_check check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]{1,200}$')
);
-- At most one schedule that is not cancelled per client. Cancelled ones stay as history.
create unique index if not exists care_agreements_one_open_per_client on public.care_agreements (client_id) where status <> 'cancelled';

-- One row per client per renewal date (Day 0). Amount, plan and sender are copied when the cycle is created, so a
-- later price or date change never rewrites history.
create table if not exists public.billing_cycles (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.care_agreements (id) on delete restrict,
  client_id uuid not null references public.clients (id) on delete restrict,
  due_on date not null,
  amount_cents integer not null,
  plan_name text,
  invoice_sender text not null,
  status text not null default 'open',
  -- Set from a verified payment record (revenue_events, written only by the signed Stripe webhook or Sync from Stripe).
  paid_at timestamptz,
  payment_ref uuid,
  -- A payment the owner recorded by hand (cash, cheque, bank transfer ...). Not a Stripe record.
  manual_amount_cents integer,
  manual_method text,
  manual_note text,
  manual_recorded_at timestamptz,
  manual_recorded_by uuid,
  invoice_url text,
  invoice_sent_at timestamptz,
  invoice_sent_by uuid,
  reminder_sent_at timestamptz,
  reminder_sent_by uuid,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_cycles_unique unique (client_id, due_on),
  constraint billing_cycles_status_check check (status in ('open', 'paid', 'paid_manual', 'cancelled')),
  constraint billing_cycles_sender_check check (invoice_sender in ('luminate', 'stripe_invoice', 'stripe_autopay')),
  constraint billing_cycles_amount_check check (amount_cents >= 0),
  constraint billing_cycles_manual_amount_check check (manual_amount_cents is null or manual_amount_cents > 0),
  constraint billing_cycles_method_check check (manual_method is null or manual_method in ('cash', 'check', 'bank_transfer', 'stripe', 'other')),
  constraint billing_cycles_note_length check (manual_note is null or char_length(manual_note) <= 500),
  constraint billing_cycles_url_check check (invoice_url is null or (invoice_url ~ '^https://' and char_length(invoice_url) <= 500)),
  constraint billing_cycles_reason_length check (cancelled_reason is null or char_length(cancelled_reason) <= 200)
);
create index if not exists billing_cycles_agreement_idx on public.billing_cycles (agreement_id, due_on desc);

-- One row per cycle per milestone. action_key is the stable id ("billing:<client>:<due date>:<milestone>"), also
-- used as the task's source_reference, so retries and overlapping runs can never create a second task.
create table if not exists public.billing_actions (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.billing_cycles (id) on delete restrict,
  client_id uuid not null references public.clients (id) on delete restrict,
  milestone text not null,
  due_on date not null,
  action_key text not null,
  work_item_id uuid references public.internal_work_items (id) on delete set null,
  status text not null default 'open',
  outcome text,
  completed_at timestamptz,
  completed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_actions_key_unique unique (action_key),
  constraint billing_actions_cycle_milestone_unique unique (cycle_id, milestone),
  constraint billing_actions_milestone_check check (milestone in ('send_invoice', 'verify_payment', 'friendly_reminder', 'grace_review')),
  constraint billing_actions_status_check check (status in ('open', 'done', 'resolved', 'cancelled')),
  constraint billing_actions_outcome_length check (outcome is null or char_length(outcome) <= 60),
  constraint billing_actions_key_length check (char_length(action_key) <= 120)
);
create index if not exists billing_actions_open_idx on public.billing_actions (status, due_on) where status = 'open';

-- A second guard against duplicate billing tasks: one task per billing key.
create unique index if not exists internal_work_items_billing_key on public.internal_work_items (source_reference)
  where source = 'internal' and source_reference like 'billing:%';

drop trigger if exists trg_care_agreements_updated_at on public.care_agreements;
create trigger trg_care_agreements_updated_at before update on public.care_agreements for each row execute function update_updated_at();
drop trigger if exists trg_billing_cycles_updated_at on public.billing_cycles;
create trigger trg_billing_cycles_updated_at before update on public.billing_cycles for each row execute function update_updated_at();
drop trigger if exists trg_billing_actions_updated_at on public.billing_actions;
create trigger trg_billing_actions_updated_at before update on public.billing_actions for each row execute function update_updated_at();

alter table public.care_agreements enable row level security;
alter table public.billing_cycles enable row level security;
alter table public.billing_actions enable row level security;

-- Owners read and write these with their own session (row-level security behind the service layer). Nobody deletes:
-- cancelled schedules, cycles and actions are kept as billing history.
drop policy if exists owner_all on public.care_agreements;
create policy owner_all on public.care_agreements as permissive for all to authenticated
  using (user_role() = 'admin') with check (user_role() = 'admin');
drop policy if exists owner_all on public.billing_cycles;
create policy owner_all on public.billing_cycles as permissive for all to authenticated
  using (user_role() = 'admin') with check (user_role() = 'admin');
drop policy if exists owner_all on public.billing_actions;
create policy owner_all on public.billing_actions as permissive for all to authenticated
  using (user_role() = 'admin') with check (user_role() = 'admin');

revoke all on table public.care_agreements from public, anon, authenticated, service_role;
revoke all on table public.billing_cycles from public, anon, authenticated, service_role;
revoke all on table public.billing_actions from public, anon, authenticated, service_role;
grant select, insert, update on table public.care_agreements to authenticated;
grant select, insert, update on table public.billing_cycles to authenticated;
grant select, insert, update on table public.billing_actions to authenticated;
-- The billing job (server) keeps Stripe-managed schedules in step with Stripe, and writes cycles and actions.
grant select, insert, update on table public.care_agreements to service_role;
grant select, insert, update on table public.billing_cycles to service_role;
grant select, insert, update on table public.billing_actions to service_role;

-- The job: hourly, so tasks appear soon after midnight in New York and close soon after a payment arrives. Each
-- milestone is still created once per renewal (the unique keys above).
insert into public.jobs (key, name, description, interval_minutes)
values ('billing_tasks', 'Billing tasks',
        'Follows each client''s Stripe subscription renewals and creates the SOP billing tasks for each renewal (Day -5 send invoice, Day 0 verify payment, Day +3 friendly reminder, Day +7 grace-period review), closes them when a verified payment arrives, and cancels them when a plan is paused or cancelled. Never sends anything.', 60)
on conflict (key) do nothing;
