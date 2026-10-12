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

## Planowane w etapie 2 (silnik)

`SearchProvider → ContentExtractor → SummaryProvider → EmbeddingProvider`, ranking, dzienna pula do 20 pozycji, stany polubienia i przeczytania (`UserContentState`). Worker i wektory zainteresowań już działają. Szczegóły i kandydaci do przeniesienia z Pulse & Go: `implementation-plan.md`.
