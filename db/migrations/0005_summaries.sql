-- Streszczenia (wspólne dla wszystkich odbiorców) i zużycie modelu językowego.

create table summary (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references content_item (id) on delete cascade,
  -- Klucz cache: hash dowodów (tekstu źródła) + wersja promptu + model + język.
  source_hash text not null,
  prompt_version text not null,
  model text not null,
  language text not null default 'pl',
  sufficient boolean not null,
  card_description text,
  summary text,
  key_facts jsonb not null default '[]',
  caveats jsonb not null default '[]',
  tags text[] not null default '{}',
  -- Zakres materiału: pełny tekst czy tylko fragment (paywall, lead, przycięcie).
  basis text not null check (basis in ('full', 'excerpt')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now(),
  unique (content_id, source_hash, prompt_version, model, language)
);
create index summary_content_idx on summary (content_id, created_at desc);

-- Zużycie LLM per dzień (UTC) i model. Koszt w USD to SZACUNEK ze skonfigurowanych stawek.
create table llm_usage (
  day date not null,
  model text not null,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  -- Rezerwacje w toku (szacunek przed wywołaniem) — chronią limit przy równoległych zadaniach.
  reserved_usd numeric(10, 6) not null default 0,
  est_cost_usd numeric(10, 6) not null default 0,
  primary key (day, model)
);
