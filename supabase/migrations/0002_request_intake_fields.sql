-- 0002_request_intake_fields.sql
-- M1 Quick Add: three optional intake fields on client requests.
--
-- This is the first migration that ALTERs a table the old app uses, so it is kept
-- as small and as safe as possible:
--   * three NULLABLE columns, no defaults, no NOT NULL -> metadata-only change,
--     existing rows and the old app's inserts are unaffected;
--   * values are limited by CHECK constraints that allow NULL;
--   * no change to row-level security policies or grants (table-level grants and
--     the existing admin_full / client_select policies already cover new columns).
--
-- ROLLBACK (if ever needed): drop the three constraints, then the three columns.
--
-- Before applying to production, confirm the old app does not break on unknown
-- columns in the requests table (it should not: it selects named columns).

alter table public.requests
  add column if not exists priority text,
  add column if not exists source text,
  add column if not exists website_url text;

-- Safe to run twice: constraints are dropped first if they already exist.
alter table public.requests
  drop constraint if exists requests_priority_check,
  drop constraint if exists requests_source_check,
  drop constraint if exists requests_website_url_length_check;

alter table public.requests
  add constraint requests_priority_check
    check (priority is null or priority in ('low', 'normal', 'high', 'urgent')),
  add constraint requests_source_check
    check (source is null or source in ('email', 'phone_call', 'text_message', 'in_person', 'other')),
  add constraint requests_website_url_length_check
    check (website_url is null or char_length(website_url) <= 2048);

comment on column public.requests.priority is 'Owner-assigned urgency from Quick Add. NULL = not set (requests from the client portal).';
comment on column public.requests.source is 'How the request reached the owner. NULL = not recorded (requests from the client portal).';
comment on column public.requests.website_url is 'Which of the client''s websites the request is about. NULL = not specified.';
