-- Odkrywanie treści: wspólny katalog artykułów, wektory treści, tematy i zużycie dostawców.
-- Katalog jest wspólny i nie zawiera danych osobowych; personalizacja liczona jest per użytkownik osobno.

-- Temat wyszukiwania = znormalizowana ścieżka zainteresowania, wspólna dla wszystkich osób z tym zainteresowaniem.
create table topic (
  key text primary key,               -- np. „informatyka i technologia > hackathony”
  label text not null,                -- liść ścieżki w oryginalnym brzmieniu
  path text[] not null,
  node_key text,                      -- węzeł taksonomii, jeśli istnieje
  model text,                         -- model i wektor tematu (ten sam tekst co wektor zainteresowania)
  embedding vector(384),
  last_feeds_at timestamptz,
  last_search_at timestamptz,
  created_at timestamptz not null default now()
);

create table content_item (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'article' check (kind in ('article', 'news', 'event', 'club', 'place')),
  canonical_url text not null unique,
  url text not null,
  source_domain text not null,
  source_name text,
  -- Tytuł i opis pochodzą od wydawcy (strona lub jego kanał RSS), nigdy z wyników wyszukiwarki.
  title text not null,
  description text,
  language text,
  published_at timestamptz,
  author text,
  image_url text,                     -- adres obrazu z metadanych strony; to nie jest licencja na jego użycie
  discovered_via text not null check (discovered_via in ('feed', 'search')),
  feed_url text,
  status text not null default 'discovered'
    check (status in ('discovered', 'extracted', 'partial', 'blocked', 'failed', 'irrelevant')),
  status_note text,
  word_count integer,
  content_hash text,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index content_item_published_idx on content_item (published_at desc);
create index content_item_created_idx on content_item (created_at desc);

-- Pełny tekst tylko na potrzeby streszczenia; usuwany po `expires_at` (sprzątanie w workerze).
create table content_text (
  content_id uuid primary key references content_item (id) on delete cascade,
  text text not null,
  expires_at timestamptz not null
);

create table content_embedding (
  content_id uuid primary key references content_item (id) on delete cascade,
  model text not null,
  dim integer not null check (dim = 384),
  source_hash text not null,
  embedding vector(384) not null,
  created_at timestamptz not null default now()
);
create index content_embedding_hnsw_idx on content_embedding using hnsw (embedding vector_cosine_ops);

-- Przez jaki temat treść została znaleziona (sygnał pochodzenia, np. kanał szachowy → szachy).
create table content_topic (
  content_id uuid not null references content_item (id) on delete cascade,
  topic_key text not null references topic (key) on delete cascade,
  via text not null check (via in ('feed', 'search')),
  relevance real,                     -- margines trafności względem tematu w chwili odkrycia
  discovered_at timestamptz not null default now(),
  primary key (content_id, topic_key)
);
create index content_topic_topic_idx on content_topic (topic_key, discovered_at desc);

-- Zużycie płatnych dostawców per dzień (UTC) — twarde limity dzienne i miesięczne.
create table provider_usage (
  day date not null,
  provider text not null,
  calls integer not null default 0,
  primary key (day, provider)
);
