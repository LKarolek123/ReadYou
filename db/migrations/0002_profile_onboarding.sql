-- Profil, onboarding DFS, zainteresowania i subskrypcja raportu.
-- Chwile w UTC (timestamptz), strefy jako nazwy IANA.

create extension if not exists vector;

create table user_profile (
  user_id text primary key references "user" ("id") on delete cascade,
  city text,
  timezone text not null default 'Europe/Warsaw',
  -- Przybliżona lokalizacja (opcjonalna, tylko po działaniu użytkownika; zaokrąglana do ~1 km).
  approx_lat numeric(6, 2),
  approx_lon numeric(6, 2),
  university text,
  study_field text,
  budget_currency char(3) not null default 'PLN',
  -- NULL = brak informacji; 0 = tylko bezpłatne.
  budget_max_event_price integer check (budget_max_event_price >= 0),
  hours_per_week integer check (hours_per_week between 0 and 80),
  available_days text[] not null default '{}',
  available_slots text[] not null default '{}',
  activity_types text[] not null default '{}',
  preferred_view text not null default 'grid' check (preferred_view in ('grid', 'swipe')),
  onboarding_completed_at timestamptz,
  -- Zwiększana przy każdej zmianie wpływającej na rekomendacje (zadania async wykrywają nieaktualność).
  profile_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table onboarding_session (
  user_id text primary key references "user" ("id") on delete cascade,
  step text not null default 'location',
  dfs_state jsonb,
  updated_at timestamptz not null default now()
);

-- Węzły zainteresowań widziane w systemie (taksonomia, własne etykiety, w przyszłości rozwinięcia AI).
-- Wspólny katalog bez danych osobowych; rozwinięcia AI będą cache'owane tutaj.
create table interest_node (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  normalized text not null,
  parent_key text,
  origin text not null check (origin in ('taxonomy', 'custom', 'ai')),
  created_at timestamptz not null default now()
);
create index interest_node_parent_idx on interest_node (parent_key);

-- Zainteresowania użytkownika: jawne, wyuczone i wykluczone — rozdzielone stanem.
-- Wykluczenie ma pierwszeństwo przed uczeniem, dopóki użytkownik go nie zmieni.
create table user_interest (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" ("id") on delete cascade,
  node_key text,
  label text not null,
  normalized text not null,
  path text[] not null default '{}',
  state text not null check (state in ('explicit', 'learned', 'excluded')),
  origin text not null check (origin in ('onboarding', 'manual', 'behavior')),
  weight real not null default 1.0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized)
);
create index user_interest_user_state_idx on user_interest (user_id, state);

create table report_subscription (
  user_id text primary key references "user" ("id") on delete cascade,
  enabled boolean not null default false,
  weekday smallint not null default 5 check (weekday between 1 and 7),
  local_time text not null default '20:00' check (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- Hash nieprzezroczystego tokenu wypisu (sam token tylko w linku e-maila).
  unsubscribe_token_hash text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
