# ReadYou — architektura

```
Przeglądarka (React, apps/web)
   │  same-origin: /api/*  (Vite proxy w dev, reverse proxy na produkcji)
   ▼
API (Fastify, apps/api)
   ├─ /api/auth/*        Better Auth: rejestracja, logowanie, Google, weryfikacja, reset
   ├─ /api/me, /me/profile, /me/interests, /me/report-subscription, /me/export, DELETE /me
   ├─ /api/onboarding, /onboarding/step, /onboarding/next (DFS)
   └─ /api/health, /api/ready, /api/config (bez sekretów)
   │
   ├─ EmailProvider → Mailpit (dev)            [produkcyjny dostawca: etap 2/3]
   ▼
PostgreSQL 17 + pgvector (db/migrations)
   ▲
   │  tabela `job` (FOR UPDATE SKIP LOCKED, dzierżawy, ponowienia)
Worker (apps/api/src/worker.ts)
   └─ embed_user_interests → EmbeddingProvider (packages/providers: lokalny e5, w procesie)
```

### Kolejka zadań i wektory zainteresowań

- Zmiana zainteresowań (`bumpProfileVersion`) zleca zadanie `embed_user_interests`. Klucz `embed_user_interests:<userId>` zlewa równoległe zlecenia w jedno oczekujące zadanie, a worker nie uruchamia dwóch zadań o tym samym kluczu naraz.
- Zadanie liczy osobny wektor dla każdego jawnego lub wyuczonego zainteresowania (`user_interest_embedding`, `vector(384)`). Tekstem wektora jest pełna ścieżka gałęzi, np. „Informatyka > Sztuczna inteligencja > Agenci AI > RAG”. Wektory wykluczonych tagów są usuwane.
- Przeliczane są tylko wektory, których tekst lub model się zmienił (`source_hash`). Ponowienie niczego nie dubluje.
- Każdy wektor ma zapisany `model` i `dim`, więc wektory różnych modeli nie są porównywane.
- Ponowienia: do 5 prób, opóźnienie 30 s → 1 h z rozrzutem; `RetryLaterError` (np. Retry-After) nie zużywa próby. Zadania porzucone przez martwy proces wracają po wygaśnięciu dzierżawy (5 min).

`packages/shared` zawiera kod używany przez front i API: taksonomię, maszynę stanów DFS, normalizację tagów, schematy zod profilu i harmonogram raportu.

## Model danych (etap 1)

| Tabela | Zawartość |
| --- | --- |
| `user`, `session`, `account`, `verification` | Better Auth (konto, sesje, hasło lub Google, tokeny weryfikacji i resetu) |
| `user_profile` | Miasto, strefa IANA, przybliżona lokalizacja (~1 km), uczelnia, kierunek, budżet (`NULL` = nie wiem, `0` = tylko bezpłatne), czas, aktywności, preferowany widok, `profile_version` |
| `onboarding_session` | Bieżący krok i stan DFS (JSONB) do wznowienia |
| `interest_node` | Wspólny katalog węzłów (taksonomia, własne, w przyszłości AI) bez danych osobowych |
| `user_interest` | Zainteresowania użytkownika: `explicit/learned/excluded`, pochodzenie, ścieżka, waga |
| `report_subscription` | Zapis na raport (dzień ISO, godzina lokalna), hash tokenu wypisu |
| `job` | Trwała kolejka zadań w tle |
| `user_interest_embedding` | Wektor każdego zainteresowania: model, wymiar, hash tekstu, wersja profilu |

Usunięcie konta kaskadowo usuwa profil, sesje, zainteresowania, ich wektory, onboarding i subskrypcję. Wspólny katalog `interest_node` zostaje.

## Bezpieczeństwo

- Tożsamość pochodzi wyłącznie z ciasteczka sesji. Każde zapytanie o zasoby konta filtruje po `user_id` z sesji.
- Ciasteczka są HttpOnly, SameSite=Lax, a w produkcji także Secure.
- Ochrona CSRF:
  - Better Auth sprawdza `trustedOrigins`,
  - pozostałe metody zmieniające wymagają `Origin = APP_URL`.
- Walidacja zod na wejściu, limit ciała żądania 64 KB, rate limiting, zapytania parametryzowane (Kysely).
- Logi bez nagłówków `cookie`, `authorization` i `set-cookie`. Błędy konfiguracji wypisują nazwy zmiennych bez ich wartości.

## Silnik treści (etap 2)

```
Tematy (ścieżki aktywnych zainteresowań, wspólne dla wszystkich osób)
  ├─ ingest_feed  — kanały RSS przypisane do gałęzi taksonomii (co 2 h)
  └─ search_topic — Brave News Search, ręcznie dobrane frazy (raz na dobę, twardy limit)
        │  wyniki Brave tylko w pamięci zadania → wybór adresów
        ▼
  SafeFetcher (SSRF, robots.txt, limity) → ContentExtractor (JSON-LD/OG + Readability)
        ▼
  content_item (metadane od wydawcy) + content_text (pełny tekst z terminem usunięcia)
  + content_embedding (e5) + content_topic (pochodzenie)
        ▼
  build_pool (per osoba, worker) — trafność + ranking + różnorodność → daily_assignment (≤ 20)
        ▼
  summarize_content (Haiku 5.5, budżet USD) → summary (cache: hash źródła + wersja promptu + model)
        ▼
  API: /feed/articles, /content/:id/summary, /me/content/:id/state, /me/articles, /interactions
```

**Trafność** (`engine/relevance.ts`): margines = podobieństwo do zainteresowania + bonus kanału tematycznego − max(podobieństwo do ogólnych działów newsowych, do przodków zainteresowania). Szczegółowe zainteresowania wymagają dowodu słownego lub kanału tematycznego. Bez dowodu treść jest „sąsiednia” — kandydat do puli odkrywania.

**Ranking puli** (`engine/pool.ts`): 0,45 zainteresowanie, 0,20 tag, 0,15 świeżość, 0,10 jakość, 0,10 nowość; zachłanny dobór bez tej samej historii (kosinus ≥ 0,93), limit na zainteresowanie, ok. 20% odkrywania z progiem jakości.

**Polubienie i przeczytanie** (`user_content_state`): dwa niezależne znaczniki czasu w jednym wierszu (użytkownik, treść). „Polubione” = `liked_at` i brak `read_at`; „Przeczytane” = `read_at` (niezależnie od polubienia). Żądania ustawiają stan (nie przełączają); interakcja do uczenia zapisuje się w tej samej transakcji tylko przy rzeczywistej zmianie. Pominięcie ukrywa tylko pozycję.

**Uczenie** (`engine/learning.ts`): wyuczone tematy są funkcją bieżących stanów i interakcji (przeliczane, nie inkrementowane). Ukryty temat po 1 polubieniu (waga 0,3, 1 pozycja w puli), widoczny tag po 3. Wykluczenia blokują uczenie i filtrują pulę.

**Limit 20**: `daily_assignment` ma klucz (użytkownik, dzień lokalny, slot 1..20) i unikalną parę (użytkownik, treść); wstawianie pod blokadą doradczą.

## Planowane w etapie 2 (silnik)

`SearchProvider → ContentExtractor → SummaryProvider → EmbeddingProvider`, uczenie z interakcji (promowanie wyuczonych tagów), wydarzenia, Trending, raport tygodniowy. Szczegóły i kandydaci do przeniesienia z Pulse & Go: `implementation-plan.md`.
