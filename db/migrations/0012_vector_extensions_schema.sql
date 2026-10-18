-- pgvector poza schematem public. Supabase wystawia public przez Data API, a funkcje rozszerzenia
-- (właściciel supabase_admin, wykonywalne przez PUBLIC) byłyby dostępne jako /rest/v1/rpc/* z kluczem anon.
-- Odebranie uprawnień nie działa (rola aplikacji nie jest właścicielem funkcji), więc przenosimy
-- rozszerzenie do schematu `extensions`, którego Data API nie wystawia.
-- Tylko gdy `extensions` jest w search_path roli (Supabase: "$user", public, extensions) — inaczej
-- typ `vector` i operator `<=>` przestałyby się rozwiązywać. Lokalnie (Docker) bez zmian.
do $$
begin
  if exists (
    select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'vector' and n.nspname = 'public'
  ) and 'extensions' = any (current_schemas(false)) then
    alter extension vector set schema extensions;
  end if;
end $$;
