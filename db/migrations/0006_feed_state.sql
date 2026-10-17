-- Dzienna pula artykułów, stany użytkownika (polubienie / przeczytanie / pominięcie) i rejestr interakcji.

-- Niezależne stany jednej pary użytkownik–treść. NULL = brak stanu.
-- Polubienie i przeczytanie są niezależne: „Polubione” = liked_at not null and read_at is null.
create table user_content_state (
  user_id text not null references "user" ("id") on delete cascade,
  content_id uuid not null references content_item (id) on delete cascade,
  liked_at timestamptz,
  read_at timestamptz,
  skipped_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, content_id)
);
create index user_content_state_liked_idx on user_content_state (user_id, liked_at desc) where liked_at is not null and read_at is null;
create index user_content_state_read_idx on user_content_state (user_id, read_at desc) where read_at is not null;

-- Rejestr interakcji (do uczenia i audytu). Klucz idempotencji chroni przed retransmisją.
create table interaction (
  id bigserial primary key,
  user_id text not null references "user" ("id") on delete cascade,
  content_id uuid references content_item (id) on delete cascade,
  type text not null check (type in (
    'exposure', 'like', 'unlike', 'summary_open', 'source_click', 'skip', 'unskip', 'read', 'unread', 'less_topic'
  )),
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index interaction_user_idx on interaction (user_id, created_at desc);

-- Przydziały dziennej puli: najwyżej 20 miejsc na użytkownika i lokalny dzień (unikalny slot 1..20).
-- Ta sama treść nie trafia do puli dwa razy (unikalna para użytkownik–treść ponad dniami).
create table daily_assignment (
  user_id text not null references "user" ("id") on delete cascade,
  local_day date not null,
  slot smallint not null check (slot between 1 and 20),
  content_id uuid not null references content_item (id) on delete cascade,
  kind text not null check (kind in ('matched', 'explore')),
  score real not null,
  -- Uzasadnienie „Dlaczego dla Ciebie” (zainteresowanie, składniki oceny) — prywatne, per użytkownik.
  reason jsonb not null default '{}',
  profile_version integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, local_day, slot),
  unique (user_id, content_id)
);
create index daily_assignment_day_idx on daily_assignment (user_id, local_day);
