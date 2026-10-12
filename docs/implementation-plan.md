# ReadYou — plan implementacji i decyzje

Stan na 12.10.2026. Etap 1: konto, onboarding, profil, grafiki. Silnik treści (etap 2) budujemy wspólnie z właścicielem projektu.

## Izolacja od Pulse & Go

- ReadYou to osobny katalog `C:\Projekty informatyczne\ReadYou` z własnym repozytorium git, bazą danych (kontener `readyou-db`) i portami (15432, 1025/8025, 3001, 5173).
- Repozytorium referencyjne Pulse & Go (wskazane przez właściciela): `HackYeah2026\HachYeah2026` → `github.com/maciekto/HachYeah2026`. Tylko do odczytu — **nic w nim nie zmieniamy**.
- Właściciel potwierdził zgodę współautorów na portowanie fragmentów kodu. Repozytorium nie ma pliku LICENSE, więc każdy przeniesiony fragment oznaczamy w kodzie komentarzem `// Port z Pulse & Go: <ścieżka>`.
- Pulse & Go ma backend w Pythonie (FastAPI), a ReadYou w Node.js. Logikę przepisujemy na TypeScript zamiast importować kod Pythona.

### Kandydaci do przeniesienia w etapie 2 (do wspólnej decyzji)

| Pulse & Go (`apps/api/app/…`) | Rola w ReadYou |
| --- | --- |
| `adapters/outbound/search_brave.py` | `SearchProvider` (Brave Search API) |
| `adapters/outbound/page_fetcher.py`, `compliance_http.py`, `http_identity.py` | `ContentExtractor`: pobieranie z robots, limitami i identyfikacją |
| `adapters/outbound/structured_page.py`, `html_text.py` | Metadane JSON-LD/OG, tekst strony |
| `adapters/outbound/extractor_*.py`, `llm_common.py` | Ekstrakcja wydarzeń z walidacją dosłownych cytatów |
| `adapters/outbound/summarizer_openai_compat.py` | Punkt wyjścia dla `SummaryProvider` |
| `adapters/outbound/embedding_e5.py` | `EmbeddingProvider` (multilingual-e5-small, 384 wym.) |
| `domain/services/dedup.py`, `event_series.py`, `recurrence.py` | Deduplikacja, serie i powtarzalność wydarzeń |
| `domain/services/llm_budget.py`, `deepseek_budget.py` | Limity kosztów LLM |
| `domain/model/taxonomy.py` | Płaska taksonomia miejsc — do kategoryzacji wydarzeń i klubów (nie do DFS) |

## Dostawcy silnika (etap 2) — ustalone z właścicielem 12.10.2026

| Rola | Dostawca | Ograniczenie |
| --- | --- | --- |
| Budżet integracji | — | Łącznie 5 $ miesięcznie |
| `SearchProvider` | Brave Search API (kredyt 5 $/mies. ≈ 1000 zapytań) | Twardy limit ~900 zapytań/mies. (~30/dzień), zapytania współdzielone per temat; uzupełnienie darmowymi RSS (np. WP, Onet) do Trending. Konto i klucz zakłada właściciel |
| `SummaryProvider` | Claude Haiku 5.5, najlepiej przez Batch API | Twardy limit ~0,16 $/dzień; po przekroczeniu brak nowych streszczeń, zapisane działają dalej |
| `EmbeddingProvider` | Lokalnie, `multilingual-e5-small` (384 wym.), w procesie Node.js | 0 $; teksty nie opuszczają serwera; kolumny `vector(384)` z zapisanym modelem i wersją |

## Decyzje etapu 1

| Obszar | Decyzja | Uzasadnienie |
| --- | --- | --- |
| Monorepo | npm workspaces: `apps/web`, `apps/api`, `packages/shared`, `db/migrations` | pnpm nie jest zainstalowany; jeden lockfile |
| Frontend | React 19.3, Vite 8.3, Tailwind 4.3, TanStack Query 5, React Router **7.18** | RR 8 wymaga Node ≥ 22.22, a środowisko ma 22.14 |
| Backend | Fastify 5.12, Kysely 0.29, pg 8.23, zod 4.6 | Lekki serwer z typowanymi zapytaniami |
| Uwierzytelnianie | Better Auth 1.7.7: e-mail + hasło (weryfikacja i reset) oraz Google OIDC | Wybór właściciela; utrzymywana biblioteka; Google włącza się po podaniu kluczy |
| Sesje | Ciasteczka HttpOnly (Better Auth), SameSite=Lax, `Secure` na produkcji; Vite proxy → ten sam origin | Brak tokenów w JS |
| CSRF | Better Auth: `trustedOrigins`; własne API: wymóg nagłówka `Origin` = `APP_URL` dla metod zmieniających | Proste i skuteczne przy jednym originie |
| Limity | Better Auth: logowanie 10/min, rejestracja 5/min, reset 3/5 min; API: 300/min | Ochrona przed brute force |
| Migracje | Pliki SQL + własny runner (`npm run db:migrate`); schemat Better Auth wygenerowany przez `auth generate` | Jeden mechanizm, łatwy pgvector |
| Baza | `pgvector/pgvector:pg17`, rozszerzenie `vector` włączone już teraz | Gotowość pod embeddingi |
| E-mail | Adapter `EmailProvider`; dev: SMTP do Mailpit (odmawia hostów nielokalnych) | Brak wysyłki do realnych osób w dev |
| Czcionki | Inter i Plus Jakarta Sans hostowane lokalnie (`@fontsource`) | Brak wysyłania IP do Google Fonts |
| Grafiki | Własne SVG: abstrakcyjne gradienty fiolet → niebieski z glifem kategorii (wybór właściciela) | Spójne, lekkie, bez praw osób trzecich; nie udają zdjęć |
| Port DB | 15432 | Windows/Hyper-V rezerwuje 54160–54959 |

## Onboarding i DFS

- Kroki: miasto i strefa → studia → budżet i czas → aktywności → kategorie główne → pogłębianie DFS → przegląd tagów → raport.
- Stan DFS (`packages/shared/src/dfs.ts`) to czysty JSON zapisany w `onboarding_session.dfs_state`, dzięki czemu onboarding można wznowić na innym urządzeniu.
- **„Pomiń”** zamyka bieżącą gałąź. **„Wystarczy”** kończy cały etap pogłębiania. **„Wstecz”** przywraca poprzedni stan (historia: 40 kroków).
- Maksymalna głębokość: 4 kroki od kategorii głównej (`DEFAULT_MAX_DEPTH`).
- Ochrona przed cyklami i duplikatami:
  - opcje nie obejmują przodków ani już wybranych węzłów,
  - deduplikacja działa po znormalizowanej etykiecie (bez diakrytyków),
  - własny tekst jest dopasowywany do taksonomii przez synonimy.
- Wieloznaczne hasła (Tesla, Python, Jaguar, Apple, Mars, Rust) wymagają krótkiego pytania doprecyzowującego.
- Własne etykiety spoza taksonomii są zapisywane z oryginalnym brzmieniem, ale **nie są jeszcze rozwijane przez AI**. To część etapu 2 (cache w `interest_node` z `origin='ai'`).
- Wybory trafiają do `user_interest` jako `explicit`/`onboarding`, razem ze ścieżką. Zapisywane są i tematy ogólne, i liście.

## Zainteresowania: jawne, wyuczone, wykluczone

- Jeden wiersz na parę (użytkownik, znormalizowana etykieta). Stan: `explicit | learned | excluded`.
- Ręczne dodanie lub wykluczenie nadpisuje poprzedni stan. Wykluczenie ma pierwszeństwo przed uczeniem.
- Usunięcie wyuczonego tagu z `block=true` zmienia go w wykluczenie, żeby uczenie nie odtworzyło go od razu.
- Reset wyuczonych usuwa tylko `learned`.
- Każda zmiana podbija `user_profile.profile_version`, co pozwoli zadaniom asynchronicznym wykryć nieaktualny profil.

## Raport

- Na tym etapie jest tylko subskrypcja: domyślnie piątek 20:00 w strefie użytkownika, włączenie wymaga zweryfikowanego e-maila.
- Termin liczy `nextReportAt` (Luxon, strefy IANA, poprawne przejścia czasu letniego i zimowego).
- Generacja, wysyłka, tokeny wypisu i archiwum to etap 2 lub 3. Kolumna `unsubscribe_token_hash` jest już w schemacie.

## Etap 2, krok 1: kolejka zadań i embeddingi (12.10.2026)

- Worker to drugi punkt wejścia pakietu API (`apps/api/src/worker.ts`), a nie osobny `apps/worker`. Dzieli konfigurację, połączenie z bazą i serwisy z API, bez dodatkowego pakietu.
- Adaptery dostawców są w `packages/providers`. `E5EmbeddingProvider` używa transformers.js (`@huggingface/transformers` 4.x, ONNX) i repozytorium `Xenova/multilingual-e5-small`, czyli portu ONNX tych samych wag co `intfloat/multilingual-e5-small` w Pulse & Go. Domyślnie wersja skwantyzowana q8.
- Prefiksy e5 jak w Pulse & Go: `query: ` dla zainteresowań, `passage: ` dla treści.
- `FakeEmbeddingProvider` (haszowanie słów) służy wyłącznie do testów.
- Obserwacja do decyzji przy rankingu: podobieństwa e5 mieszczą się w wąskim przedziale (~0,75–0,88). Niezwiązany nagłówek („zmiany w VAT”) dostaje ~0,82, a trafny ~0,85–0,88. Surowy kosinus wymaga kalibracji, np. przeskalowania względem tła lub progu, zanim trafi do składnika 0,45.

## Poza etapem 1 (świadomie niezrobione)

- Silnik treści: wyszukiwanie, ekstrakcja, streszczenia, embeddingi, ranking, limit 20 dziennie, polubienia i przeczytane, Trending, wydarzenia.
- Wysyłka raportów, publiczny endpoint wypisu.
- Zakładki Artykuły, Wydarzenia i Trending pokazują uczciwe puste stany, bez fikcyjnych kart.
- Moduł płatności nie istnieje i nie powstanie.
