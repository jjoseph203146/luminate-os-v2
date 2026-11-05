-- 0003_revoke_unneeded_table_privileges.sql
-- Finding H1: the baseline granted `authenticated` every table privilege, including
-- TRUNCATE, TRIGGER, REFERENCES and (PostgreSQL 17) MAINTAIN. Row Level Security does not
-- apply to TRUNCATE. The app needs only SELECT, INSERT, UPDATE and DELETE, all still
-- filtered by RLS.
--
-- Scope: `authenticated` and `anon`, every table in schema public. `service_role` is untouched.
-- Safe to run more than once. ALREADY APPLIED by the owner (SQL editor) to staging and
-- production on 2026-11-05; it is recorded here so a fresh database gets the same grants.

do $$
declare
  t record;
  privs text := 'truncate, references, trigger';
begin
  -- MAINTAIN exists only on PostgreSQL 17+.
  if current_setting('server_version_num')::int >= 170000 then
    privs := privs || ', maintain';
  end if;

  for t in
    select schemaname, tablename from pg_tables where schemaname = 'public'
  loop
    execute format('revoke %s on table %I.%I from authenticated, anon', privs, t.schemaname, t.tablename);
  end loop;
end
$$;

-- Tables created later by the postgres role should not get these privileges either.
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated, anon;
