-- READ-ONLY structure inventory. SELECT statements only; no data is changed.
-- Returns table names, definitions' md5 hashes and row COUNTS. No row contents.
select string_agg(section || ' | ' || item || ' | ' || detail, E'\n' order by section, item) as inventory from (
  select 'server' section, 'version' item, current_setting('server_version') detail
  union all select 'extension', extname::text, extversion::text from pg_extension
  union all
  select 'table_rowcount', c.relname::text,
    (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')
  union all
  select 'table_columns', c.relname::text,
    md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), '|' order by a.attnum))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind in ('r','p')
  group by c.relname
  union all
  select 'table_rls', c.relname::text, 'enabled=' || c.relrowsecurity::text || ' forced=' || c.relforcerowsecurity::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')
  union all
  select 'constraint', conrelid::regclass::text || '.' || conname::text, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'index', indexname::text, md5(indexdef) from pg_indexes where schemaname = 'public'
  union all
  select 'policy', schemaname || '.' || tablename || '.' || policyname,
    'roles=' || roles::text || ' cmd=' || cmd || ' ' || permissive || ' md5=' ||
    md5(coalesce(qual, '') || '|' || coalesce(with_check, ''))
  from pg_policies where schemaname in ('public','storage')
  union all
  select 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    'secdef=' || p.prosecdef::text || ' md5=' || md5(pg_get_functiondef(p.oid))
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')
  union all
  select 'function_named_rls_auto_enable', n.nspname || '.' || p.proname, 'secdef=' || p.prosecdef::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'rls_auto_enable'
  union all
  select 'trigger', n.nspname || '.' || c.relname || '.' || t.tgname, md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname in ('public','auth','storage')
  union all
  select 'event_trigger', evtname::text, evtevent::text || ' -> ' || evtfoid::regproc::text from pg_event_trigger
  union all
  select 'grants', c.relname::text,
    string_agg(coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type, ', ' order by a.grantee, a.privilege_type)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) a
  where n.nspname = 'public' and c.relkind in ('r','p','v','m','S')
  group by c.relname
  union all
  select 'view', viewname::text, md5(definition) from pg_views where schemaname = 'public'
  union all
  select 'sequence', sequencename::text, 'start=' || start_value || ' inc=' || increment_by from pg_sequences where schemaname = 'public'
  union all
  select 'publication', pubname::text || '.' || schemaname || '.' || tablename, '' from pg_publication_tables
  union all
  select 'storage_bucket', id::text, 'public=' || "public"::text || ' limit=' || coalesce(file_size_limit::text, '-') || ' mime=' || coalesce(allowed_mime_types::text, '-')
  from storage.buckets
) x;
