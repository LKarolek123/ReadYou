-- Wydarzenia, kluby i miejsca. Wspólny katalog (bez danych osobowych); ranking per osoba liczony osobno.
-- Chwile w UTC; strefa wydarzenia jako nazwa IANA. Nieznane dane = NULL (nie zgadujemy).

alter table content_item drop constraint content_item_discovered_via_check;
alter table content_item add constraint content_item_discovered_via_check
  check (discovered_via in ('feed', 'search', 'organizer', 'osm'));

create table event_details (
  content_id uuid primary key references content_item (id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  -- Całodniowe lub bez godziny: pokazujemy samą datę, starts_at = lokalna północ dnia rozpoczęcia.
  all_day boolean not null default false,
  timezone text not null default 'Europe/Warsaw',
  rrule text,
  venue_name text,
  address text,
  city text,
  city_normalized text,
  online boolean not null default false,
  -- NULL = cena nieznana. free = źródło jawnie podaje wstęp wolny.
  price_min numeric(10, 2),
  price_max numeric(10, 2),
  currency char(3),
  free boolean not null default false,
  registration_url text,
  registration_ends_at timestamptz,
  availability text,
  status text,
  organizer text,
  method text not null check (method in ('json-ld', 'ical', 'llm-quotes')),
  -- Dla ekstrakcji AI: dosłowne cytaty potwierdzające pola.
  quotes jsonb not null default '{}',
  source_page text not null,
  -- Kiedy ostatnio potwierdziliśmy dane u źródła (stara strona nie potwierdza dostępności biletów).
  verified_at timestamptz not null
);
create index event_details_city_start_idx on event_details (city_normalized, starts_at);
create index event_details_registration_idx on event_details (registration_ends_at) where registration_ends_at is not null;

create table place_details (
  content_id uuid primary key references content_item (id) on delete cascade,
  osm_ref text not null unique,
  category text not null,
  osm_filter text not null,
  node_key text,
  lat double precision not null,
  lon double precision not null,
  address text,
  website text,
  opening_hours text,
  city_normalized text not null,
  price_min numeric(10, 2),
  price_max numeric(10, 2),
  free boolean not null default false,
  verified_at timestamptz not null
);
create index place_details_city_idx on place_details (city_normalized);

-- Źródła wydarzeń (strony organizatorów, kalendarze) i stan ich pobierania.
-- `content_hash` pozwala pominąć kosztowną ekstrakcję AI, gdy strona się nie zmieniła.
create table event_source (
  url text primary key,
  city_normalized text not null,
  kind text not null check (kind in ('ics', 'page')),
  last_fetched_at timestamptz,
  content_hash text,
  last_status text,
  events_found integer,
  updated_at timestamptz not null default now()
);

-- Pochodzenie powiązania treści z tematem: także strona organizatora i OpenStreetMap.
alter table content_topic drop constraint content_topic_via_check;
alter table content_topic add constraint content_topic_via_check check (via in ('feed', 'search', 'organizer', 'osm'));
