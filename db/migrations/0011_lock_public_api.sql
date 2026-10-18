-- Supabase wystawia schemat public przez Data API (PostgREST) rolom anon/authenticated.
-- ReadYou łączy się z bazą wyłącznie z backendu (rola właściciela tabel), więc te role
-- nie mają żadnego dostępu: odbieramy uprawnienia i włączamy RLS bez polityk (deny-all).
-- Na zwykłym Postgresie (lokalnie, Neon) role nie istnieją — wtedy tylko RLS, bez skutków dla aplikacji.
do $$
declare
  t record;
  r text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;

  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
    end if;
  end loop;
end $$;
