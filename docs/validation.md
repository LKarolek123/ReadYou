# ReadYou — walidacja

Data: 12.10.2026. Środowisko: Windows 11, Node 22.14, Docker 29.8.

## Testy automatyczne — `npm test` (132/132 ✔, 18.10.2026)

| Plik | Zakres |
| --- | --- |
| `packages/shared/test/dfs.test.ts` | Kolejność DFS (kilka kategorii i dzieci), Pomiń, Wystarczy, Wstecz, limit głębokości, brak cykli, deduplikacja synonimów, własne etykiety, wieloznaczność „Tesla”, serializacja i wznowienie |
| `packages/shared/test/schedule.test.ts` | Piątek 20:00 Europe/Warsaw: CEST → 18:00 UTC, CET → 19:00 UTC, zmiana wiosenna i jesienna, granica 20:00, inna strefa; normalizacja tagów |
| `apps/api/test/account.test.ts` | Izolacja kont (A nie widzi i nie zmienia tagów B, eksport tylko własny), 401 bez sesji, CSRF 403, wykluczenie kontra reset wyuczonych, 422 dla wieloznacznych, budżet `null` ≠ `0`, raport wymaga weryfikacji, zapis DFS do tagów bez nadpisywania ręcznych |
| `apps/api/test/engine-jobs.test.ts` | Kolejka: deduplikacja równoległych zleceń, brak podwójnego pobrania przez kilku workerów, brak równoległych zadań o tym samym kluczu, ponowienia z opóźnieniem, maskowanie sekretów w błędach, Retry-After bez zużycia próby, przejęcie po wygaśnięciu dzierżawy. Wektory (atrapa): zlecenie po zmianie tagów, osobny wektor na zainteresowanie, idempotencja, usuwanie przy wykluczeniu i usunięciu, przeliczenie po zmianie modelu, izolacja kont, usunięcie konta |
| `packages/providers/test/providers.test.ts` | Kanonizacja URL (parametry śledzące), SSRF (IP prywatne, IPv6, metadane chmur, porty, localhost, DNS na adres prywatny), RSS/Atom (CDATA, encje), ekstrakcja (JSON-LD, OG, obcy canonical, TDM, fragment), instrukcje w tekście strony jako dane |
| `apps/api/test/engine-relevance.test.ts` | Działy newsowe, bramka dowodów dla liści, powrót do rodzica, konkurencja z przodkiem, bonus kanału, działy pokrywające się z zainteresowaniem; twardy limit zapytań przy 20 równoległych rezerwacjach |
| `apps/api/test/engine-discovery.test.ts` | Wyszukiwanie na atrapach: zapis metadanych ze strony wydawcy (nic z wyszukiwarki w bazie), brak duplikatów, robots odrzuca stronę, wyczerpany limit zatrzymuje zapytania |
| `apps/api/test/engine-summaries.test.ts` | Atrapa dostawcy: cache bez ponownego wywołania, nowe streszczenie po zmianie źródła, budżet blokuje wywołanie, błąd zwalnia rezerwację, walidacja (nieznane tagi, długość, brak materiału) |
| `apps/api/test/learning.test.ts` | Uczenie: najbardziej szczegółowe tagi, ukryty temat po 1 polubieniu i widoczny po 3, słabe sygnały bez polubienia nie tworzą tematu, limit wkładu i wygaszanie, blokada wykluczeń; przez API: wielokrotne serce bez wzrostu wagi, cofnięcie polubienia wycofuje wkład, pominięcie i otwarcie streszczenia bez tematu, wykluczenie wygrywa z uczeniem, reset wyuczonych bez ruszania jawnych; filtr wykluczeń w puli, limit 1 pozycji dla świeżego tematu |
| `apps/api/test/events.test.ts` | Parsery JSON-LD (`@graph`, oferty, online, HTML zakodowany encjami) i iCal (zawijanie, TZID, odwołane), OSM; czas lokalny wokół zmiany czasu 25.10.2026; zakończone/odwołane/bez terminu; nieznana cena ≠ bezpłatne; miasto z adresu; cykle sesji; walidacja cytatami (godzina, data z nagłówka, data z sąsiedniej pozycji odrzucona, cena 0); okna „Dzisiaj”/„Ten tydzień” (półotwarte, DST), trwające wydarzenia, cykle bez sesji, budżet, dostępność; API: filtr miasta i online, „Nadchodzące” z bliskim końcem zapisów, zapisane osobno od „Twoich artykułów”, pominięcie per osoba, osoba bez miasta, walidacja zakresu |
| `apps/api/test/feed.test.ts` | Pula: 5 równoległych budowań = dokładnie 20 różnych pozycji, odświeżenie nie dodaje ponad limit, przeczytane znikają z „Dla Ciebie” bez zwalniania slotu; Polubione/Przeczytane (wszystkie przejścia stanów), idempotencja polubienia, otwarcie streszczenia/źródła ≠ przeczytanie, pominięcie i cofnięcie bez wykluczania tematu, stronicowanie kursorowe, zmiana dnia, izolacja kont i eksportu, walidacja wejścia (w tym odrzucenie `userId` od klienta) |

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
- **Odkrywanie na prawdziwych danych (12.10.2026)**: 10 kanałów RSS + 14 zapytań Brave dla 7 tematów konta deweloperskiego → 445 pozycji w katalogu; pula 20 pozycji: Tesla 4, Agenci AI 4, Gry i szachy 4, RAG 3, Sztuczna inteligencja 2, Alpy 1, Hackathony 1 (HackYeah 2026), Informatyka 1. Ocena trafności ręczna, jednej osoby.
- **Streszczenia na prawdziwym modelu (13.10.2026, po doładowaniu konta)**: Haiku 5.5, artykuł polski (fragment) i angielski (pełny tekst). Fakty oddzielone od opinii, fragment oznaczony, reklama wtrącona w tekst pominięta. Prompt v2: 123 i 126 słów. `effort: low` → błąd merytoryczny na karcie; `effort: medium` → poprawne karty i tagi w 2/2 próbach. Ocena jakości ręczna, na kilku artykułach.
- **Interfejs Artykułów (Grid/Swipe, panel streszczenia, Twoje artykuły)**: obejrzany 14.10.2026 w Chrome (Playwright) przy 390 px, 360 px i 1280 px — szczegóły w `implementation-plan.md`, sekcja „Przegląd 14.10.2026”. Nie sprawdzono gestów dotykowych na fizycznym telefonie ani safe area na urządzeniu z wycięciem.
- **Noc 12/13.10**: laptop bez sieci od ~23:54 — zadania kanałów i ekstrakcji wyczerpały próby. Dodano wznawianie zaległych ekstrakcji i ostateczność błędów 4xx.
- Raport tygodniowy, wydarzenia, Trending i uczenie z interakcji: kolejne kroki.

## Wydarzenia — sprawdzenia ręczne (18.10.2026)

- **Pobieranie na żywo (Kraków, 11 stron organizatorów)**: Jazz It Up (JSON-LD) 16 wydarzeń w Krakowie, 1 odrzucone poza miastem (Stary Sącz), 31 zakończonych; Tauron Arena 8 (JSON-LD ze stron szczegółów); Teatr Ludowy 17, AGH 19, Kwadrat 10, Alchemia 8, Filharmonia 6, Muzeum Krakowa 3, kalendarium krakow.pl 3 (AI z cytatami). Klub Studio i Na Miasteczku: 0 (lista ładowana skryptem). Jedna strona (AGH) raz zwróciła ucięty JSON modelu — zadanie się ponawia. Koszt AI kilku przebiegów testowych: ~0,05 $.
- **OSM (Overpass)**: 13 miejsc dla tematów kont deweloperskich (szkoły tańca, hackerspace’y).
- **Interfejs** (Chrome przez Playwright, 360 px i 1280 px): Dzisiaj / Ten tydzień / Kluby i miejsca, panel szczegółów wydarzenia (Kiedy, Gdzie, Cena, Zapisy, źródło i data weryfikacji), brak błędów konsoli, brak poziomego przewijania. Znalezione i poprawione: HTML zakodowany encjami w opisie (Tauron), sesje cyklu „trwające” do końca cyklu (Jazz It Up), cykliczne spotkania kwiecień–grudzień w „Ten tydzień”, wydarzenie z gminy ościennej z kalendarium krakow.pl, błąd 500 dla osoby bez miasta.
- **Niesprawdzone**: wyszukiwanie wydarzeń przez Brave (`search_events`) — kod i limity gotowe, bez przebiegu na żywo; trafność dopasowania wydarzeń do zainteresowań oceniona tylko na kilku przykładach.
