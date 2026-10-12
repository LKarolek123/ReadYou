-- Trwała kolejka zadań (worker) i wektory zainteresowań użytkownika.

-- Kolejka oparta na PostgreSQL: pobieranie przez FOR UPDATE SKIP LOCKED, dzierżawy (locked_until),
-- ograniczone ponowienia z rosnącym opóźnieniem. Unikalny `dedupe_key` dla zadań oczekujących
-- sprawia, że równoległe zlecenia tej samej pracy zlewają się w jedno zadanie.
create table job (
  id bigserial primary key,
  kind text not null,
  payload jsonb not null default '{}',
  dedupe_key text,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_by text,
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
-- Najwyżej jedno OCZEKUJĄCE zadanie o danym kluczu. Zlecenie w trakcie wykonywania innego
-- może czekać (praca od nowszej wersji danych), a worker nie uruchomi obu naraz.
create unique index job_dedupe_queued_idx on job (dedupe_key) where status = 'queued';
create index job_ready_idx on job (run_at) where status = 'queued';
create index job_lease_idx on job (locked_until) where status = 'running';

-- Osobny wektor dla każdego zainteresowania (gałęzi), żeby szachy, Alpy i AI
-- nie spłaszczały się do jednego uśrednionego wektora.
-- Wymiar 384 = multilingual-e5-small. Inny model z innym wymiarem wymaga nowej kolumny/tabeli;
-- `model` i `dim` chronią przed porównaniem niekompatybilnych wektorów.
create table user_interest_embedding (
  interest_id uuid primary key references user_interest (id) on delete cascade,
  user_id text not null references "user" ("id") on delete cascade,
  model text not null,
  dim integer not null check (dim = 384),
  -- Hash tekstu, z którego policzono wektor (etykieta + ścieżka); zmiana tekstu = przeliczenie.
  source_hash text not null,
  profile_version integer not null,
  embedding vector(384) not null,
  created_at timestamptz not null default now()
);
create index user_interest_embedding_user_idx on user_interest_embedding (user_id, model);
