# ReadYou

Spersonalizowane artykuły, newsy i wydarzenia: aplikacja przeglądarkowa projektowana najpierw na telefon.

**Stan: etap 1.** Działają konto (e-mail + hasło, opcjonalnie Google), onboarding z pogłębianiem zainteresowań (DFS), profil z tagami, ustawienia raportu i grafiki. Silnik treści (wyszukiwanie, streszczenia, ranking) to etap 2. Do tego czasu zakładki treści pokazują uczciwe puste stany.

Specyfikacja: [CLAUDE.md](CLAUDE.md) · Decyzje: [docs/implementation-plan.md](docs/implementation-plan.md) · Architektura: [docs/architecture.md](docs/architecture.md) · Walidacja: [docs/validation.md](docs/validation.md)

## Wymagania

- Node.js ≥ 22.12 (testowane na 22.14), npm 10
- Docker (PostgreSQL 17 + pgvector i Mailpit)

## Uruchomienie

```bash
npm install
cp .env.example .env          # uzupełnij BETTER_AUTH_SECRET (polecenie w pliku)
npm run db:up                 # Postgres :15432, Mailpit :1025/:8025
npm run db:migrate
npm run dev                   # API :3001 + worker + web :5173
```

Worker (`npm run worker`, w `npm run dev` startuje automatycznie) wykonuje zadania w tle, np. liczenie wektorów zainteresowań. Przy pierwszym zadaniu pobiera lokalny model `multilingual-e5-small` (~120 MB, ok. 30 s) do `.cache/models`. Kolejne uruchomienia działają offline.

- Aplikacja: http://localhost:5173
- Przechwycone e-maile (weryfikacja, reset hasła): http://127.0.0.1:8025

W trybie dev wiadomości nigdy nie trafiają do realnych skrzynek. Adapter `smtp-dev` odmawia wysyłki na host inny niż lokalny.

## Testy

```bash
npm test             # vitest: DFS, harmonogram, izolacja kont, kolejka zadań, wektory (wymaga db:up + db:migrate)
npm run typecheck
npm run build
```

## Struktura

```
apps/web         React 19 + Vite + Tailwind 4 (UI, grafiki SVG w src/graphics)
apps/api         Fastify 5 + Better Auth + Kysely; src/worker.ts — worker kolejki zadań
packages/providers  adaptery dostawców (EmbeddingProvider: lokalny e5)
packages/shared  taksonomia, maszyna stanów DFS, schematy profilu, harmonogram raportu
db/migrations    SQL (0001 Better Auth, 0002 profil/onboarding/zainteresowania/raport, 0003 kolejka zadań i wektory)
docs             plan, architektura, walidacja
```

## Konfiguracja integracji

| Zmienna | Do czego | Bez niej |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Podpisywanie sesji i tokenów (≥ 32 znaki) | API się nie uruchomi |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | „Kontynuuj z Google”. W Google Cloud Console ustaw redirect URI `${APP_URL}/api/auth/callback/google` | Przycisk Google jest ukryty |
| `EMAIL_PROVIDER` | `smtp-dev` (Mailpit) lub `disabled` | — |
| `EMBEDDING_PROVIDER` | `e5-local` (lokalny multilingual-e5-small, 0 $) lub `disabled` | Domyślnie `e5-local`; `disabled` — brak wektorów |
| `EMBEDDING_CACHE_DIR` | Katalog cache modelu | `.cache/models` |

Wybrani dostawcy silnika (Brave Search, Claude Haiku 5.5) i limity budżetu: `docs/implementation-plan.md`. Ich klucze dojdą w kolejnych krokach.

## Pulse & Go

ReadYou nie modyfikuje Pulse & Go i nie zależy od jego kodu w czasie działania. Fragmenty silnika (Brave Search, pobieranie z robots, ekstrakcja z walidacją cytatów, embeddingi e5) zostaną przeniesione do TypeScript w etapie 2. Lista kandydatów jest w `docs/implementation-plan.md`.

ReadYou jest bezpłatne i nie ma modułu płatności.
