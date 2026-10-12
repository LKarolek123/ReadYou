# ReadYou — walidacja

Data: 12.10.2026. Środowisko: Windows 11, Node 22.14, Docker 29.8.

## Testy automatyczne — `npm test` (38/38 ✔)

| Plik | Zakres |
| --- | --- |
| `packages/shared/test/dfs.test.ts` | Kolejność DFS (kilka kategorii i dzieci), Pomiń, Wystarczy, Wstecz, limit głębokości, brak cykli, deduplikacja synonimów, własne etykiety, wieloznaczność „Tesla”, serializacja i wznowienie |
| `packages/shared/test/schedule.test.ts` | Piątek 20:00 Europe/Warsaw: CEST → 18:00 UTC, CET → 19:00 UTC, zmiana wiosenna i jesienna, granica 20:00, inna strefa; normalizacja tagów |
| `apps/api/test/account.test.ts` | Izolacja kont (A nie widzi i nie zmienia tagów B, eksport tylko własny), 401 bez sesji, CSRF 403, wykluczenie kontra reset wyuczonych, 422 dla wieloznacznych, budżet `null` ≠ `0`, raport wymaga weryfikacji, zapis DFS do tagów bez nadpisywania ręcznych |
| `apps/api/test/engine-jobs.test.ts` | Kolejka: deduplikacja równoległych zleceń, brak podwójnego pobrania przez kilku workerów, brak równoległych zadań o tym samym kluczu, ponowienia z opóźnieniem, maskowanie sekretów w błędach, Retry-After bez zużycia próby, przejęcie po wygaśnięciu dzierżawy. Wektory (atrapa): zlecenie po zmianie tagów, osobny wektor na zainteresowanie, idempotencja, usuwanie przy wykluczeniu i usunięciu, przeliczenie po zmianie modelu, izolacja kont, usunięcie konta |

Testy API wymagają działającej bazy (`npm run db:up && npm run db:migrate`). Tymczasowe konta są usuwane po teście.

## Typecheck i build

`npm run typecheck` (shared, api, web) ✔, `npm run build` ✔.

## Sprawdzenia ręczne w przeglądarce (375×812 i 1280×800)

1. Rejestracja e-mailem → automatyczne przejście do onboardingu ✔
2. Krok 1–4: miasto (Kraków), studia (Informatyka), budżet (do 60 PLN, ok. 5 h, sobota wieczór), aktywności ✔
3. Kategorie główne + własne „Tesla” → okno doprecyzowania znaczenia → „Tesla (samochody)” ✔
4. DFS: Informatyka → Sztuczna inteligencja → Agenci AI → RAG, następnie Gry i szachy → Szachy. Kolejność zgodna z DFS ✔
5. Przeładowanie strony w połowie DFS → wznowienie na tym samym pytaniu ✔
6. „Wstecz” → poprzednie pytanie; „Pomiń” → przegląd tagów ✔
7. Przegląd tagów: ogólne i szczegółowe razem, ręczne dodanie „Alpy” ✔
8. Raport: bez weryfikacji pojawia się ostrzeżenie. Link z Mailpit → „Adres potwierdzony”, potem włączenie raportu. Profil pokazuje „Następna wysyłka: piątek, 16 października 20:00” ✔
9. Zakładki: dolna nawigacja (telefon), boczna (komputer), puste stany bez fikcyjnych treści ✔
10. Profil: tagi pod e-mailem, dane, raport, widok, eksport, reset, usunięcie konta, wylogowanie ✔

Znalezione i naprawione podczas sprawdzania:
- efekt React zwracał wartość zamiast funkcji sprzątającej (błąd ekranu),
- przekierowanie po onboardingu następowało przed odświeżeniem profilu w cache,
- tytuł pytania DFS był niegramatyczny,
- licznik pozostałych pytań liczył liście.

## Niesprawdzone / wymaga konfiguracji

- **Logowanie przez Google**: brak `GOOGLE_CLIENT_ID/SECRET`, więc przycisk jest ukryty. Ścieżki nie testowano.
- **Produkcyjny dostawca e-mail**: nieskonfigurowany. Wiadomości trafiają wyłącznie do lokalnego Mailpit.
- **Reset hasła**: przetestowane tylko wysłanie wiadomości do Mailpit (`requestPasswordReset`), bez pełnego przejścia w przeglądarce.
- **Lokalny model e5 (12.10.2026)**: sprawdzony ręcznie, nie w `npm test`. Pierwsze pobranie zajęło ~35 s. Worker przeliczył 9 wektorów konta deweloperskiego w ~2,2 s (`vector_dims = 384`). Nagłówki demonstracyjne trafiły w odpowiednie gałęzie (szachy → „Szachy”, lawiny w Alpach → „Alpy”, Tesla → „Tesla (samochody)”, hackathon → „Hackathony”). Różnice podobieństwa są jednak małe — patrz obserwacja w `implementation-plan.md`.
- Silnik treści (wyszukiwanie, streszczenia, ranking) i raporty: kolejne kroki etapu 2.
