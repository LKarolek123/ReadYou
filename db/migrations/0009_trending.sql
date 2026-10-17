-- Trending w Polsce: migawki rankingu z dowodami (bez liczników popularności, których nie znamy).
-- Każda migawka zapisuje czas sprawdzenia i metodę; pozycja — członków klastra (URL, wydawca, grupa).

create table trending_snapshot (
  id bigserial primary key,
  kind text not null check (kind in ('news', 'events')),
  method text not null,
  items_considered integer not null,
  created_at timestamptz not null default now()
);
create index trending_snapshot_kind_idx on trending_snapshot (kind, created_at desc);

create table trending_item (
  snapshot_id bigint not null references trending_snapshot (id) on delete cascade,
  rank smallint not null,
  content_id uuid not null references content_item (id) on delete cascade,
  -- 'multi' = kilka niezależnych źródeł; 'radar' = słabe dowody (jedno źródło) — „Na radarze”.
  label text not null check (label in ('multi', 'radar')),
  independent_sources integer not null,
  -- Członkowie klastra: [{contentId, url, source, group, publishedAt}] — dowody do pokazania.
  members jsonb not null default '[]',
  -- Składniki oceny (np. groups, freshness) — do wyjaśnień i audytu.
  signals jsonb not null default '{}',
  primary key (snapshot_id, rank)
);
