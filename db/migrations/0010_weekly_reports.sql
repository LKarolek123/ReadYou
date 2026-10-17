-- Raport tygodniowy: najpierw zapisany raport, potem wysyłka (outbox). Unikalny klucz użytkownik + okres + kanał.

create table weekly_report (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" ("id") on delete cascade,
  -- Okres raportu = tydzień ISO terminu wysyłki w strefie użytkownika, np. „2026-W43”.
  period_key text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  scheduled_for timestamptz not null,
  status text not null check (status in ('ready', 'empty')),
  subject text not null,
  -- Treść strukturalna (pozycje, synteza) — źródło dla archiwum w aplikacji; HTML/tekst — dokładnie to, co wysłano.
  content jsonb not null,
  html text not null,
  text text not null,
  -- Synteza „co się zmieniło”: model i wersja promptu (null = bez syntezy AI).
  synthesis_model text,
  generated_at timestamptz not null default now(),
  unique (user_id, period_key)
);
create index weekly_report_user_idx on weekly_report (user_id, generated_at desc);

create table email_delivery (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references weekly_report (id) on delete cascade,
  user_id text not null references "user" ("id") on delete cascade,
  channel text not null default 'email' check (channel in ('email')),
  -- pending → sending → sent | failed | uncertain (wynik nieznany po przerwaniu — bez ślepej ponownej wysyłki)
  -- | skipped (wypis, brak weryfikacji, zbyt duże opóźnienie).
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'uncertain', 'skipped')),
  idempotency_key text not null unique,
  provider text,
  provider_message_id text,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (report_id, channel)
);
create index email_delivery_status_idx on email_delivery (status);
