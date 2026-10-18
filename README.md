# ReadYou

Spersonalizowane artykuły, newsy i wydarzenia: aplikacja przeglądarkowa projektowana najpierw na telefon.

**Stan: etap 2 ukończony (18.10.2026).** Działają:
- konto (e-mail + hasło, opcjonalnie Google), onboarding z pogłębianiem zainteresowań (DFS) i profil z tagami;
- dzienna pula do 20 artykułów ze streszczeniami (Grid/Swipe), polubione/przeczytane i „Twoje artykuły”;
- uczenie z interakcji;
- wydarzenia, kluby i miejsca;
- Trending w Polsce;
- raport tygodniowy e-mailem z wypisem i archiwum.

Co jest sprawdzone, a co nie: [docs/validation.md](docs/validation.md).

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

Worker (`npm run worker`, w `npm run dev` startuje automatycznie) wykonuje zadania w tle. Przy pierwszym zadaniu pobiera lokalny model `multilingual-e5-small` (~120 MB, ok. 30 s) do `.cache/models`. Kolejne uruchomienia działają offline.

- Aplikacja: http://localhost:5173
- Przechwycone e-maile (weryfikacja, reset hasła, raport tygodniowy): http://127.0.0.1:8025

W trybie dev wiadomości nigdy nie trafiają do realnych skrzynek. Adapter `smtp-dev` odmawia wysyłki na host inny niż lokalny.

## Co robi worker

- co 10 min planuje odkrywanie artykułów: kanały co 2 h, wyszukiwarka raz na dobę na temat;
- od 6:00 czasu lokalnego buduje dzienną pulę i zleca streszczenia;
- raz na dobę pobiera strony organizatorów wydarzeń, a raz w tygodniu kluby i miejsca z OpenStreetMap;
- co godzinę liczy Trending;
- co 5 min planuje raporty: przygotowuje je około 45 min przed piątkiem 20:00 w strefie osoby, a potem wysyła;
- raz na dobę przelicza wyuczone tematy (wygaszanie).

## Narzędzia deweloperskie

```bash
npm run engine -- run [--search]        # odkrywanie artykułów teraz: kanały RSS (+ Brave, w ramach limitu)
npm run engine -- inspect <email> [--all]  # ranking trafności konta z uzasadnieniem (✔ dopasowane, ~ odkrywanie)
npm run engine -- pool <email> [--force]   # zbuduj/uzupełnij dzisiejszą pulę (maks. 20) i pokaż składniki oceny
npm run engine -- summarize <id…>          # streszczenie wskazanych treści (Haiku 5.5, z limitem kosztu)
npm run engine -- events <miasto> [--search] [--places]  # wydarzenia ze stron organizatorów (+ wyszukiwarka, OSM)
npm run engine -- trending                 # kanały ogólnopolskie i migawki Trending
npm run engine -- report <email> [--send] [--force]      # raport tygodniowy „na teraz” — podgląd w Mailpit
npm run engine -- export <email>           # CSV do ręcznej oceny trafności (.cache/relevance/)
npm run engine -- eval <plik.csv>          # AUC i precyzja/czułość dla progów na Twoich ocenach
npm run engine -- usage                    # zużycie Brave i LLM (dziś / miesiąc) wobec limitów
```

## Testy

```bash
npm test             # vitest (wymaga db:up + db:migrate): DFS, harmonogram, izolacja kont, kolejka, wektory, trafność,
                     # pula, stany, uczenie, wydarzenia, Trending, raport tygodniowy
npm run typecheck
npm run build
```

Testy korzystają z tej samej lokalnej bazy co `npm run dev`. Uruchamiaj je przy zatrzymanym workerze albo licz się z rzadkimi kolizjami zadań (testy czyszczą swoje zlecenia).

## Struktura

```
apps/web         React 19 + Vite + Tailwind 4 (UI, grafiki SVG w src/graphics)
apps/api         Fastify 5 + Better Auth + Kysely; src/worker.ts — worker kolejki zadań; src/engine — silnik
packages/providers  adaptery: embeddingi e5, Brave, bezpieczne pobieranie (SSRF, robots.txt), RSS, ekstrakcja stron,
                 streszczenia, wydarzenia (JSON-LD, iCal, AI z cytatami), OpenStreetMap, synteza raportu
packages/shared  taksonomia, maszyna stanów DFS, schematy profilu, harmonogram raportu, kontrakty API
db/migrations    SQL 0001–0010 (konto, profil, kolejka, katalog, streszczenia, pula, uczenie, wydarzenia, Trending, raporty)
docs             plan, architektura, walidacja
```

## Konfiguracja integracji

| Zmienna | Do czego | Bez niej |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Podpisywanie sesji, tokenów i linków wypisu (≥ 32 znaki) | API się nie uruchomi |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | „Kontynuuj z Google”. W Google Cloud Console ustaw redirect URI `${APP_URL}/api/auth/callback/google` | Przycisk Google jest ukryty |
| `EMAIL_PROVIDER` | `smtp-dev` (Mailpit), `smtp` (produkcja) lub `disabled` | — |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM` | Produkcyjna wysyłka (`EMAIL_PROVIDER=smtp`): dowolna usługa SMTP z uwierzytelnionym nadawcą (SPF/DKIM) | Tylko Mailpit |
| `EMBEDDING_PROVIDER` | `e5-local` (lokalny multilingual-e5-small, 0 $) lub `disabled` | Domyślnie `e5-local`; `disabled` — brak wektorów |
| `BRAVE_SEARCH_SECRET_KEY` | Wyszukiwanie artykułów i stron wydarzeń | Tylko kanały RSS i strony organizatorów |
| `ANTHROPIC_API_KEY` | Streszczenia, ekstrakcja wydarzeń bez danych strukturalnych, synteza raportu (Claude Haiku 5.5) | Brak streszczeń („w przygotowaniu”), wydarzenia tylko z JSON-LD/iCal, raport bez syntezy |
| `SHOW_SOURCE_IMAGES` | Obrazy wydawców na kartach | Ilustracje kategorii ReadYou |

Limity kosztów (Brave, LLM, strony wydarzeń) i pozostałe ustawienia: `.env.example`. Decyzje i kalibracje: `docs/implementation-plan.md`.

**Wdrożenie na Vercel + Supabase** (front i API; worker osobno):
- projekt Vercel podpięty do repozytorium; ustawienia budowania pochodzą z `vercel.json` (funkcja `api/index.js`, bundle `npm run build:api`);
- zmienne projektu: `DATABASE_URL` (Supabase → Connect → *Transaction pooler*, port 6543; bez niej API używa `POSTGRES_URL` z integracji), `DATABASE_CA_CERT` (opcjonalny — dla hostów Supabase wbudowany jest Supabase Root 2021 CA, więc TLS z pełną weryfikacją działa bez tej zmiennej), `BETTER_AUTH_SECRET` (typ Sensitive), `APP_URL`, `NODE_ENV=production`, `EMAIL_PROVIDER`, `DB_POOL_MAX=3`, `EMBEDDING_PROVIDER=disabled`;
- klucze Anthropic i Brave **nie** trafiają do Vercela — używa ich tylko worker;
- migracja `0011` odbiera rolom `anon`/`authenticated` dostęp do tabel i włącza RLS: publiczne Data API Supabase nie widzi danych ReadYou (aplikacja łączy się jako właściciel tabel z backendu);
- region funkcji (`regions` w `vercel.json`) powinien odpowiadać regionowi bazy.

**Wdrożenie na serwer** (jeszcze nie zrobione):
- HTTPS i `APP_URL` z docelową domeną;
- `EMAIL_PROVIDER=smtp` z danymi usługi i zweryfikowaną domeną nadawcy;
- `NODE_ENV=production`, czyli ciasteczka `Secure`;
- uruchomione trzy procesy: API, worker i serwowanie zbudowanego frontu (`npm run build`).

## Pulse & Go

ReadYou nie modyfikuje Pulse & Go i nie zależy od jego kodu w czasie działania. Przeniesione do TypeScript fragmenty są oznaczone w kodzie komentarzem `// Port z Pulse & Go: <ścieżka>`:
- Brave Search;
- pobieranie z poszanowaniem robots.txt i sygnałów TDM;
- embeddingi e5;
- wydarzenia z JSON-LD i iCal;
- ekstrakcja AI z walidacją dosłownych cytatów;
- OpenStreetMap.

ReadYou jest bezpłatne i nie ma modułu płatności.
