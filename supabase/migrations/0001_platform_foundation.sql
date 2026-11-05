-- 0001_platform_foundation.sql
-- Phase 2 (Foundation): platform tables for Settings, audit and jobs.
--
-- ADDITIVE ONLY. The old app shares this database, so this migration creates
-- new objects and touches nothing that already exists (no ALTER on existing
-- tables, no changes to profiles, no changes to existing policies or grants).
--
-- Roles: the existing profiles.role value 'admin' is the owner. Access is
-- decided by the existing public.user_role() function ('none' when a user has
-- no profile row).
--
-- Seed values come from the approved SOPs (Business Playbook, Monthly Client
-- Care and Reporting). Two values are ASSUMPTIONS that the owner has not
-- confirmed: the business time zone (America/New_York) and the empty holiday
-- list. Both are editable in Settings -> Business calendar.
--
-- Grants are explicit. Supabase's default privileges would otherwise hand
-- every new table to anon/authenticated/service_role, so each table starts
-- with REVOKE ALL and then grants only what the app needs.

-- ---------------------------------------------------------------------------
-- Business profile (exactly one row)
-- ---------------------------------------------------------------------------
create table public.business_profile (
  id boolean primary key default true,
  legal_name text not null,
  display_name text,
  contact_email text,
  phone text,
  mailing_address text,
  website_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint business_profile_single_row check (id)
);

insert into public.business_profile (legal_name, display_name)
values ('Luminate Web Design & Development LLC', 'Luminate');

-- ---------------------------------------------------------------------------
-- Business calendar (exactly one row) and holidays
-- working_days uses 0 = Sunday ... 6 = Saturday.
-- Owner decision 2026-11-04: every day is a working day except Saturday.
-- ---------------------------------------------------------------------------
create table public.business_calendar (
  id boolean primary key default true,
  time_zone text not null default 'America/New_York',
  working_days integer[] not null default array[0,1,2,3,4,5],
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint business_calendar_single_row check (id),
  constraint business_calendar_working_days_valid check (
    working_days <@ array[0,1,2,3,4,5,6]
    and cardinality(working_days) between 1 and 7
  )
);

insert into public.business_calendar default values;

create table public.business_holidays (
  holiday_date date primary key,
  label text not null,
  created_at timestamptz not null default now(),
  created_by uuid
);

-- ---------------------------------------------------------------------------
-- Catalog (packages and add-ons)
-- Prices are stored in cents. Historical prices belong in snapshots on
-- proposals and agreements (docs/architecture/05 s3), so the catalog can
-- change freely.
-- ---------------------------------------------------------------------------
create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null,
  pricing_model text not null,
  price_cents integer,
  percent_value numeric(6,2),
  description text,
  internal_benchmark_cents integer,
  watch_pricing boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint catalog_items_code_format check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint catalog_items_kind_check check (kind in ('package', 'addon')),
  constraint catalog_items_pricing_model_check check (pricing_model in ('fixed', 'percent', 'quoted')),
  constraint catalog_items_price_shape check (
    (pricing_model = 'fixed' and price_cents is not null and price_cents >= 0 and percent_value is null)
    or (pricing_model = 'percent' and percent_value is not null and percent_value > 0 and price_cents is null)
    or (pricing_model = 'quoted' and price_cents is null and percent_value is null)
  ),
  constraint catalog_items_benchmark_nonneg check (internal_benchmark_cents is null or internal_benchmark_cents >= 0)
);

create trigger trg_catalog_items_updated_at before update on public.catalog_items
  for each row execute function update_updated_at();

insert into public.catalog_items
  (code, name, kind, pricing_model, price_cents, percent_value, description, internal_benchmark_cents, watch_pricing, sort_order)
values
  ('starter_website', 'Starter website', 'package', 'fixed', 50000, null,
   'Up to four pages. Mobile-friendly design; navigation and footer; one contact form; click-to-call and email links; social links; map embed; basic SEO titles, descriptions, headings and sitemap; initial Google Analytics and Search Console setup; embedding an existing booking widget; a standard photo gallery; client-provided testimonials; basic handoff instructions. Two rounds of combined in-scope revisions. Normal timeline 10-15 business days after signed agreement, paid deposit and materials.',
   null, false, 10),
  ('additional_pages', 'Additional pages', 'addon', 'quoted', null, null,
   'Individually quoted. No fixed per-page rate. Larger websites, redesigns, web apps and business automations are also quoted.',
   null, false, 20),
  ('extra_contact_form', 'Extra standard contact form', 'addon', 'fixed', 5000, null,
   'One form with basic fields, validation, email notifications, styling and testing. Not a CRM or complex workflow.',
   null, false, 30),
  ('expanded_gallery', 'Expanded gallery', 'addon', 'fixed', 10000, null,
   'Up to 30 client images, up to 3 categories, mobile-friendly layout, lightbox and basic optimization.',
   null, false, 40),
  ('blog_news', 'Blog/news section', 'addon', 'fixed', 15000, null,
   'Blog listing, article template, categories, featured images/dates, SEO metadata and publishing instructions. Not content writing or migration.',
   18400, true, 50),
  ('payment_integration', 'Payment/donation integration', 'addon', 'fixed', 7500, null,
   'One existing hosted checkout or donation service, button/section, available confirmation and testing. Not a custom cart.',
   9200, true, 60),
  ('third_party_calendar', 'Third-party event calendar', 'addon', 'fixed', 7500, null,
   'Embed/connect one existing calendar provider, style where possible and test.',
   null, false, 70),
  ('cms_events', 'CMS event management system', 'addon', 'fixed', 15000, null,
   'Standard reusable database-backed event admin with one role; create/edit/publish/delete events, public listing and testing. No ticketing, registrations or complex permissions.',
   27600, true, 80),
  ('onpage_seo', 'Additional on-page SEO', 'addon', 'fixed', 10000, null,
   'Up to 3 existing pages: keyword mapping, titles, headings, limited copy refinement, alt text, internal links and indexing review.',
   13800, true, 90),
  ('content_migration', 'Basic content migration', 'addon', 'fixed', 10000, null,
   'Move content from up to 5 existing pages, including text, images, links and documents. Not complex database or e-commerce migration.',
   null, false, 100),
  ('rush_delivery', 'Rush delivery', 'addon', 'percent', null, 35.00,
   'Added to the quote. Only when there is capacity and an accelerated deadline is agreed.',
   null, false, 110),
  ('ai_chatbot', 'Standard AI chatbot', 'addon', 'fixed', 10000, null,
   'Integrate one existing chatbot provider, brand it, configure initial FAQ/content and test. No advanced agent or custom integrations.',
   null, false, 120);

-- ---------------------------------------------------------------------------
-- Care plan templates
-- Source: Monthly Client Care and Reporting s1 and s5 (the more specific SOP).
-- The Business Playbook words two items differently: it lists "deployment" for
-- Essential, and says Professional gets "a concise monthly performance report"
-- where the Care SOP says "monthly full report" (Essential gets a brief
-- summary). Raised for the owner to confirm; nothing here changes either SOP.
-- ---------------------------------------------------------------------------
create table public.care_plan_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  monthly_price_cents integer not null,
  small_updates_per_cycle integer not null,
  response_target_business_days integer not null,
  priority_support boolean not null default false,
  included_services text[] not null default '{}',
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint care_plan_templates_code_format check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint care_plan_templates_price_nonneg check (monthly_price_cents >= 0),
  constraint care_plan_templates_updates_nonneg check (small_updates_per_cycle >= 0),
  constraint care_plan_templates_response_positive check (response_target_business_days >= 1)
);

create trigger trg_care_plan_templates_updated_at before update on public.care_plan_templates
  for each row execute function update_updated_at();

insert into public.care_plan_templates
  (code, name, monthly_price_cents, small_updates_per_cycle, response_target_business_days, priority_support, included_services, sort_order)
values
  ('essential', 'Essential', 3500, 2, 2, false,
   array['Managed hosting and SSL', 'Routine maintenance', 'Uptime checks', 'Brief monthly service summary'], 10),
  ('professional', 'Professional', 4900, 3, 1, false,
   array['Managed hosting and SSL', 'Routine maintenance', 'Uptime checks', 'Monthly Search Console review', 'Monthly full report'], 20),
  ('growth', 'Growth', 9900, 5, 1, true,
   array['Managed hosting and SSL', 'Routine maintenance', 'Uptime checks', 'Monthly Search Console review', 'Monthly full report', 'SEO and conversion review', 'Priority support'], 30);

-- ---------------------------------------------------------------------------
-- Audit log: insert-only.
-- Written only by the server with the service-role key. Nobody gets UPDATE,
-- DELETE or TRUNCATE, and triggers refuse them even for privileged roles.
-- client_id deliberately has no foreign key so history survives any client
-- change (docs/architecture/05 s3).
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_type text not null,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  client_id uuid,
  before jsonb,
  after jsonb,
  approval_id uuid,
  request_ip text,
  constraint audit_log_actor_type_check check (actor_type in ('owner', 'contractor', 'client', 'system', 'integration', 'ai'))
);

create index audit_log_occurred_at_idx on public.audit_log (occurred_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_actor_idx on public.audit_log (actor_id);

create function public.audit_log_block_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit_log is insert-only';
end;
$$;

create trigger trg_audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function public.audit_log_block_change();
create trigger trg_audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_block_change();

revoke all on function public.audit_log_block_change() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Jobs and job runs
-- One scheduler calls POST /api/jobs/tick; due jobs run idempotently, keyed by
-- job + period (docs/architecture/04 s5).
-- ---------------------------------------------------------------------------
create table public.jobs (
  key text primary key,
  name text not null,
  description text,
  interval_minutes integer not null,
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_key_format check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  constraint jobs_interval_valid check (interval_minutes between 1 and 10080)
);

create trigger trg_jobs_updated_at before update on public.jobs
  for each row execute function update_updated_at();

insert into public.jobs (key, name, description, interval_minutes)
values ('heartbeat', 'Scheduler heartbeat',
        'Does no business work. Its recent runs prove the scheduler is calling the app.', 5);

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null references public.jobs (key),
  idempotency_key text not null unique,
  status text not null default 'running',
  attempts integer not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger_source text not null default 'schedule',
  error text,
  result jsonb,
  constraint job_runs_status_check check (status in ('running', 'succeeded', 'failed')),
  constraint job_runs_trigger_check check (trigger_source in ('schedule', 'manual')),
  constraint job_runs_attempts_positive check (attempts >= 1)
);

create index job_runs_job_started_idx on public.job_runs (job_key, started_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------
alter table public.business_profile enable row level security;
alter table public.business_calendar enable row level security;
alter table public.business_holidays enable row level security;
alter table public.catalog_items enable row level security;
alter table public.care_plan_templates enable row level security;
alter table public.audit_log enable row level security;
alter table public.jobs enable row level security;
alter table public.job_runs enable row level security;

create policy owner_all on public.business_profile as permissive for all to authenticated
  using (user_role() = 'admin') with check (user_role() = 'admin');
create policy owner_all on public.business_calendar as permissive for all to authenticated
  using (user_role() = 'admin') with check (user_role() = 'admin');
create policy owner_all on public.business_holidays as permissive for all to authenticated
  using (user_role() = 'admin') with check (user_role() = 'admin');
create policy owner_all on public.catalog_items as permissive for all to authenticated
  using (user_role() = 'admin') with check (user_role() = 'admin');
create policy owner_all on public.care_plan_templates as permissive for all to authenticated
  using (user_role() = 'admin') with check (user_role() = 'admin');
create policy owner_select on public.audit_log as permissive for select to authenticated
  using (user_role() = 'admin');
create policy owner_select on public.jobs as permissive for select to authenticated
  using (user_role() = 'admin');
create policy owner_select on public.job_runs as permissive for select to authenticated
  using (user_role() = 'admin');

revoke all on table public.business_profile from public, anon, authenticated, service_role;
revoke all on table public.business_calendar from public, anon, authenticated, service_role;
revoke all on table public.business_holidays from public, anon, authenticated, service_role;
revoke all on table public.catalog_items from public, anon, authenticated, service_role;
revoke all on table public.care_plan_templates from public, anon, authenticated, service_role;
revoke all on table public.audit_log from public, anon, authenticated, service_role;
revoke all on table public.jobs from public, anon, authenticated, service_role;
revoke all on table public.job_runs from public, anon, authenticated, service_role;

-- Settings tables are read and written with the signed-in owner's session, so
-- row-level security is a second line of defence behind the service layer.
grant select, update on table public.business_profile to authenticated;
grant select, update on table public.business_calendar to authenticated;
grant select, insert, delete on table public.business_holidays to authenticated;
grant select, insert, update on table public.catalog_items to authenticated;
grant select, insert, update on table public.care_plan_templates to authenticated;

-- The server (jobs, background work) may read settings; it never edits them.
grant select on table public.business_profile to service_role;
grant select on table public.business_calendar to service_role;
grant select on table public.business_holidays to service_role;
grant select on table public.catalog_items to service_role;
grant select on table public.care_plan_templates to service_role;

-- Audit log: owners can read; only the server can append. No one can change it.
grant select on table public.audit_log to authenticated;
grant select, insert on table public.audit_log to service_role;

-- Jobs: owners can read history; the server runs and records jobs.
grant select on table public.jobs to authenticated;
grant select, update on table public.jobs to service_role;
grant select on table public.job_runs to authenticated;
grant select, insert, update on table public.job_runs to service_role;
