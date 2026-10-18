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
- **Kalibracja progu (12.10.2026).** Próbka: 320 nagłówków i leadów z 24 publicznych kanałów RSS (RMF24, WP, TVN24, Polsat News, Onet, money.pl, Bankier, BBC, Antyweb, Chip, Spider's Web, The Verge, Hugging Face, Simon Willison, MarkTechPost, ChessBase, Chess.com, Electrek, Teslarati, wspinanie.pl, ExplorersWeb, Alpinist, Przegląd Sportowy, Onet Kultura). Pozycje oceniono ręcznie względem 9 zainteresowań konta deweloperskiego: 102 wyraźnie trafne, 59 pokrewnych, 159 nietrafnych. Wyniki (AUC: 0,5 = losowo, 1 = idealnie):

  | Metoda | AUC trafne vs nietrafne | Wniosek |
  | --- | --- | --- |
  | A: surowy max kosinusa | 0,55 | Bezużyteczny jako próg; mediana nietrafnych 0,788, trafnych 0,793 |
  | B: max − średnia po zainteresowaniach | 0,80 | Lepszy, ale słaby |
  | Opisy zainteresowań zamiast ścieżek | ≈ jak bez nich | Nie warto generować opisów tylko dla progu |
  | F: max − max konkurenta (inne kategorie taksonomii + działy newsowe) | 0,91 | Dobry |
  | **F2: max − max działu newsowego** | **0,93** | **Wybrany** |

- Wybrana miara trafności: `podobieństwo do najlepszego zainteresowania − podobieństwo do najbliższego ogólnego działu newsowego` (polityka, wojna, wypadki, przestępczość, gospodarka, pogoda, religia, celebryci, transport, zdrowie, edukacja, administracja itd.). Działy to stała lista wektorów (prototypów), liczona raz.
- Próg: **margines ≥ 0**, czyli artykuł jest bliżej Twoich tematów niż ogólnych newsów. Walidacja krzyżowa (próg z połowy danych, test na drugiej) dała próg −0,003 i 0,000 oraz precyzję 0,79–0,86 przy czułości ~0,77. Surowy próg w tej samej walidacji nie wybrał prawie nic.
- Model bezbłędnie wybiera właściwą gałąź (46/46 dla szachów, Tesli i Alp). Problemem jest tylko rozstrzygnięcie „czy w ogóle trafne”.
- Ograniczenia: jeden profil, ręczne etykiety jednej osoby, tylko nagłówki i leady z RSS (bez pełnego tekstu). Najsłabiej wypadają angielskie nagłówki bez słowa-klucza (np. „Nakamura Breaks Calendar Record” — szachy). Pomoże pełny tekst po ekstrakcji i sygnał źródła (Chess.com to serwis szachowy). Próg należy ponownie sprawdzić na wynikach z Brave.
- **Weryfikacja na Brave (12.10.2026).** 20 zapytań News Search (`freshness=pw`, PL i EN, ~0,10 $ z kredytu) dało 342 wyniki, z czego 314 unikalnych: 210 wyraźnie trafnych, 42 pokrewne, 62 nietrafne. Nietrafne były tu trudniejsze: „Alpy” → Aleph Alpha i notowania giełdowe, „hackathon Kraków” → półmaraton i wybory, „szachy arcymistrz” → turniej ATP.

  | Tekst artykułu | Surowy kosinus AUC | F2 AUC | F2, próg 0 |
  | --- | --- | --- | --- |
  | tytuł | 0,57 | 0,88 | precyzja 0,88, czułość 0,92 |
  | **tytuł + opis** | 0,61 | **0,94** | **precyzja 0,93, czułość 0,95** |
  | tytuł + opis + `extra_snippets` | 0,59 | 0,92 | precyzja 0,89, czułość 0,96 |

  - Próg 0 się potwierdził. Do oceny używamy tytułu i opisu; `extra_snippets` nie pomagają (dodają szum).
  - Do działów newsowych dodano „Sport: piłka nożna, tenis, siatkówka, wyniki meczów”: Brave AUC 0,944 → 0,948, RSS 0,928 → 0,934. Działy pokrywające się z zainteresowaniem użytkownika (np. ktoś wybrał Sport) trzeba dla niego wyłączyć z listy konkurentów.
  - Jakość zapytań: konkretne angielskie zapytania (np. „AI agents”, „chess tournament grandmaster”, „hackathon 2026 registration”) dają 15–20 trafnych wyników na 20. Ogólne polskie („nowe technologie”, „programowanie”, „szachy online”) dają 1–2. Planer zapytań ma używać ścieżki i konkretnych fraz, a nie samej etykiety.
  - Limit konta: nagłówek `x-ratelimit-limit: 50` (na sekundę). Klucz jest w `.env` jako `BRAVE_SEARCH_SECRET_KEY`.
  - **Regulamin Brave (sprawdzony 12.10.2026)** zabrania przechowywania wyników poza przechowywaniem tymczasowym (§3(b)(i)) oraz używania ich do oceny, testowania i trenowania modeli AI (§3(b)(xiii)). Powyższa jednorazowa ocena była z tym sprzeczna. Surowe wyniki Brave zostały usunięte, zostały tylko zagregowane wnioski. Konsekwencje dla silnika:
    - wyniki Brave żyją wyłącznie w pamięci zadania odkrywania i służą do wyboru adresów do pobrania;
    - w bazie zapisujemy treść i metadane pobrane **ze strony wydawcy** (Open Graph, JSON-LD, tekst), a nie tytuły i opisy z Brave;
    - kalibracja i testy trafności korzystają wyłącznie z RSS i z naszych ekstrakcji stron, nigdy z wyników Brave.

## Etap 2, kroki 2–4: odkrywanie, streszczenia, pula (12–13.10.2026)

Decyzje podjęte samodzielnie (właściciel zostawił pracę na noc):

- **Źródła.** RSS jako podstawa (0 $), Brave dla gałęzi bez dobrych kanałów (hackathony, RAG, agenci AI, Alpy). Zapytania to ręcznie dobrane frazy per węzeł (`engine/sources.ts`); węzły główne nie mają zapytań.
- **Regulamin Brave.** Wyniki tylko w pamięci zadania; zapisujemy metadane i tekst ze strony wydawcy. Test sprawdza, że nic z wyników wyszukiwarki nie trafia do bazy.
- **Uczciwy bot.** User-Agent `ReadYouBot/0.1 (+kontakt)`, robots.txt, zastrzeżenia TDM, odstęp 1,5 s na domenę. Ok. 30–40% stron z wyszukiwarki odmawia (HTTP 403) — nie obchodzimy tego; takie pozycje odpadają.
- **Trafność po pierwszym przebiegu.** Na 445 prawdziwych pozycjach liść „Hackathony” przyciągał ogólne newsy technologiczne (49 pozycji, prawie żadna o hackathonach). Dodane: konkurencja z przodkami, bonus kanału tematycznego (+0,02) i dowody słowne dla liści. Na oznaczonym zbiorze RSS: AUC 0,934 → 0,981, precyzja przy progu 0: 0,88 → 0,95, poprawne przypisanie 66 → 81/103. Porównanie z rodzeństwem w taksonomii odrzucone (czułość 0,68 → 0,55 bez zysku precyzji). Uwaga: listy dowodów układano, patrząc na ten sam zbiór — wynik jest optymistyczny; walidacja na ocenach właściciela (`engine export/eval`).
- **Streszczenia.** Haiku 5.5, `effort: medium` (13.10: przy `low` karta Tesli zawierała błąd „zanim ruszy produkcja” i ogólny tag; przy `medium` dwie próby wierne źródłu i tag `auto.ev.tesla`; koszt ~0,0016 $ zamiast ~0,0012 $ za streszczenie), prompt `pl-summary-v2` (twardy limit 150 słów, najbardziej szczegółowe tagi; v1 dawał 170–190 słów), structured outputs (zod) + walidacja po naszej stronie, tekst źródła jako niezaufany `<dokument>`, maks. 14 000 znaków (dłuższy = „fragment”). Model zwraca też tagi z taksonomii (do lepszego przypisania i ilustracji). Batch API świadomie nie teraz: ~30 streszczeń/dzień kosztuje grosze, a wsad może trwać do 24 h.
- **Budżet LLM.** Rezerwacja szacowanego kosztu przed wywołaniem (blokada doradcza), rozliczenie rzeczywistych tokenów po nim; błąd zwalnia rezerwację. Brak środków na koncie API → ponowienie za 6 h zamiast zalewu błędów.
- **Pula.** Budowana w workerze (model e5 nie w procesie API). Pierwsze otwarcie dnia zleca zadanie; front odpytuje co 3 s. Od 6:00 lokalnie worker przygotowuje pulę sam. Odświeżenie uzupełnia tylko wolne sloty (odstęp 15 min, limit 6 żądań/h). Limit na zainteresowanie = max(3, ⌈1,5 × 20 / liczba zainteresowań z kandydatami⌉).
- **Odkrywanie (~20%).** Tylko pozycje z marginesem bez dowodu ≥ 0,015 i oceną ≥ 0,45. Pierwsza pula miała 4 słabe pozycje (WhatsApp, fotokatalizator) z mylącym uzasadnieniem „Hackathony” — po zmianie ich nie ma; uzasadnienie wskazuje kategorię główną, nie liść.
- **Obrazy.** Domyślnie ilustracje kategorii (`SHOW_SOURCE_IMAGES=false`): `og:image` to metadane, nie licencja.
- **Odporność.** Odmowa wydawcy (HTTP 4xx) kończy ekstrakcję bez ponowień; błędy sieci są ponawiane, a harmonogram co godzinę wznawia pozycje, które utknęły (np. po uśpieniu laptopa).

## Przegląd 14.10.2026: interfejs, streszczenia, przypisanie

- **Interfejs** sprawdzony w Chrome (Playwright, systemowa przeglądarka): 390 px, 360 px i 1280 px; logowanie, pula, Grid, Swipe (klawiatura ←), pominięcie i „Cofnij”, panel streszczenia, polubienie, przeczytanie, Twoje artykuły (obie listy), Profil. Bez poziomego przewijania. Poprawione: ucięte źródło/data na kartach siatki (osobna linia), kolejność wyświetlania przeplata tematy (round-robin), żeby nie było trzech kart o Tesli z rzędu.
- **Streszczenia** (84 × v2): średnio 122 słowa (maks. 158), 1 słusznie odrzucone (strona z 10 słowami). Ręczna weryfikacja faktów na próbce (Chess.com, SnowBrains, Electrek, DEV): liczby, nazwiska i przyczyny zgodne ze źródłem, opinie oddzielone. Częsty szum: zastrzeżenia o reklamach w źródle (EnergySage, FRITZ) — filtrowane przy odczycie, a prompt v3 każe je pomijać.
- **Tagi AI jako dowód przypisania.** e5 mylił dyscypliny (Liga Mistrzów → „Siatkówka”). Tagi ze streszczenia: tag w poddrzewie potwierdza zainteresowanie; tag w innej gałęzi wyklucza je, chyba że jest niezależny dowód (słowo-klucz, kanał tematyczny — model bywa omylny: symultana Polgar dostała tag `sport.volleyball`); tag ogólniejszy nie rozstrzyga. Własne zainteresowania (spoza taksonomii) przy obecnych tagach wymagają wzmianki nazwy w tekście (wcześniej „giełda” przejmowała artykuł o RAG). Na 98 streszczonych pozycjach w pulach: 12 zmian przypisania, z czego ręcznie oceniłem jako poprawne 10, wątpliwe 2 (kwanty → „Sztuczna inteligencja”, startupy → „rynki finansowe”). Zapisane uzasadnienia w pulach przeliczono.

## Etap 2, krok 5: uczenie z interakcji (18.10.2026)

- **Przeliczanie zamiast przyrostów** (`engine/learning.ts`). Wyuczone tematy liczymy od nowa z bieżących stanów (`user_content_state`: polubienie, przeczytanie) i różnych treści z otwarciem streszczenia lub kliknięciem źródła. Wielokrotne kliknięcia i retransmisje nie zawyżają wag; cofnięcie polubienia wycofuje dokładnie jego wkład. Pominięcie nie wpływa na tematy.
- **Temat treści** = najbardziej szczegółowe tagi taksonomii z AI-streszczenia (bez streszczenia: węzeł tematu odkrycia).
- **Wagi** (heurystyka startowa): polubienie 1,0, przeczytanie 0,4, źródło 0,3, streszczenie 0,1; maks. 1,5 na pozycję; wygaszanie e^(−dni/30) od ostatniego sygnału; okno 120 dni.
- **Etapy**: pierwsze polubienie tworzy ukryty temat (`visible=false`, waga 0,3, w puli najwyżej 1 pozycja). Widocznym tagiem „Na podstawie polubionych treści” staje się po polubieniu 3 różnych pozycji i przy wyniku ≥ 1,5. Poniżej 0,5 temat znika. Słabe sygnały bez polubienia nie tworzą tematu.
- **Pierwszeństwo**: wykluczony temat i jego poddrzewo nie są uczone, a w puli działają jako twardy filtr (tagi streszczenia, słowa-dowody w tytule, nazwa własnego tematu). Nie uczymy też węzłów pokrytych jawnym wyborem (ten sam węzeł lub przodek jawnego liścia).
- **Kiedy**: synchronicznie po zmianie stanu w API (błąd uczenia nie psuje zapisu stanu) oraz raz na dobę w workerze (`recompute_learned`, wygaszanie). Nowy lub usunięty temat podbija `profile_version` i zleca wektory.

## Etap 2, krok 6: wydarzenia, kluby i miejsca (18.10.2026)

- **Port z Pulse & Go** (oznaczony w kodzie): parsowanie schema.org `Event` z JSON-LD i kalendarzy iCal (`structured_page.py`), ekstrakcja AI z polami `{value, quote}` i walidacja wartości dosłownymi cytatami (`extractor_claude.py`, `extraction.py`), zapytanie Overpass po obszarze miasta (`osm_overpass.py`), Brave Web Search (`search_brave.py`). Lista stron organizatorów Krakowa pochodzi z `seed/crawl_entrypoints.yaml` (konfiguracja integracji — same wydarzenia pobieramy na bieżąco). Pominięte: adresy pojedynczych wydarzeń i strony wspólnot religijnych.
- **Kolejność źródeł strony**: iCal → JSON-LD → JSON-LD stron szczegółów (linki z listy) → ekstrakcja AI. AI tylko gdy hash tekstu strony się zmienił, w limicie `EVENT_LLM_PAGES_PER_DAY` (15) i w budżecie LLM. Koszt pełnego przebiegu 11 stron Krakowa: ~0,01–0,015 $.
- **Walidacja cytatami** (zaostrzona względem Pulse & Go): cytat musi być w tekście; godzina w cytacie albo tuż przy tytule; data w cytacie albo jako najbliższa data przed tytułem (nagłówki programów: „październik › 18 niedziela”, „19-10-2026”), a cytat godziny musi stać przy tytule — model nie przeniesie daty z sąsiedniej pozycji. Cena 0 tylko z cytatem o wolnym wstępie. Na stronach Krakowa: Teatr Ludowy 0/17 → 17/17, Filharmonia 0/6 → 6/6, Kwadrat 0/10 → 10/10 po dodaniu tych reguł.
- **Niczego nie zgadujemy**: brak godziny = całodniowe („Godzina rozpoczęcia nieznana”), brak ceny = „Cena nieznana” (nie „bezpłatne”), brak końca zapisów = „Termin zapisów nieznany”. Waluta przy znanej cenie bez waluty: PLN (źródła polskie).
- **Miejsce**: miasto z `addressLocality`, z kodu pocztowego w adresie, a dopiero potem z siedziby organizatora. Źródła regionalne (Jazz It Up — cała Małopolska, kalendarium krakow.pl — także gminy ościenne) wymagają dowodu miejsca; bez niego wydarzenie odpada (krakow.pl: 3 z 20 — świadomy kompromis na rzecz prawdziwości). Z wyszukiwarki: dowód miejsca albo online.
- **Cykle**: sesje z tym samym tytułem i tym samym `endDate` (koniec cyklu) traktujemy jako jednodniowe. Wydarzenia trwające > 14 dni, które nie są wystawą/festiwalem/targami, nie trafiają do „Dzisiaj” i „Ten tydzień” (nie wiadomo, czy jest sesja).
- **Tematy wydarzeń**: krótkie tytuły („Korn”, „Mrozu”) trafiały do „Siatkówki” (koncerty w hali sportowej). Dodane działy wydarzeń jako konkurencja (koncert, spektakl, wystawa, konferencja naukowa, mecz…), bramka dowodów słownych, próg 0,01 i brak powiązań dla tekstów < 6 słów. Tagi z AI-streszczenia strony wydarzenia rozstrzygają, gdy są.
- **Ranking per osoba** (`services/events.ts`, bez modelu w API — powiązania treść–temat liczy worker): 0,35 zainteresowanie, 0,15 typ aktywności, 0,15 dostępność (dzień/pora), 0,15 budżet, 0,10 jakość dowodów, 0,10 bliskość terminu/końca zapisów. Twarde filtry: zakończone, odwołane, wykluczony temat, inne miasto (stacjonarne), pominięte. Cena powyżej budżetu nie wyklucza (budżet to kwota „komfortowa”), tylko obniża ocenę i jest opisana.
- **Zakresy**: Dzisiaj = [lokalna północ, następna północ), trwające i z sesją; Ten tydzień = [teraz, poniedziałek 00:00 lokalnie); Nadchodzące = od poniedziałku do +60 dni albo koniec zapisów w ciągu 14 dni. Bez końca zakładamy 3 h (tylko do „czy już się skończyło”).
- **Kluby i miejsca**: OpenStreetMap (Overpass), selektory OSM dla wybranych tematów (szkoły tańca, kluby szachowe, ścianki, hackerspace’y, biblioteki, muzea, teatry…), raz w tygodniu na miasto, z atrybucją ODbL. Pokazujemy tylko miejsca związane z tematami osoby. Kraków (18.10): 13 miejsc (taniec, hackerspace); klubów szachowych OSM w Krakowie nie oznacza.
- **„Twoje artykuły”** i dzienna pula obejmują tylko artykuły i newsy; zapisane wydarzenia i miejsca są w Wydarzenia → Zapisane (`GET /me/saved`).

## Etap 2, krok 7: Trending w Polsce (18.10.2026)

- **Źródła newsów**: 9 darmowych kanałów RSS (WP, money.pl, Onet, RMF24, TVN24, Polsat News, Interia, Gazeta.pl, Bankier.pl), sprawdzonych 18.10.2026. Nie działały: PAP (pusty kanał), rp.pl (nieobsługiwany typ treści), Radio ZET, TVP Info, DW (404). Pobieranie co godzinę, okno 36 h, bez pobierania stron (strony tylko dla czołówki — do streszczeń).
- **Niezależność**: liczymy grupy wydawnicze, nie portale (WP = WP + money.pl; Polsat = Polsat News + Interia). Niemal identyczne teksty (e5 ≥ 0,975, np. ta sama depesza w kilku portalach) łączą się w jedno źródło — przedruk nie jest drugim potwierdzeniem.
- **Grupowanie historii**: kalibracja na ~210 nagłówkach z 7 portali (36 h): pary ≥ 0,89 to ta sama historia, ok. 0,88 łączy już różne wypowiedzi tej samej osoby (Zełenski). Reguła: średnie podobieństwo do klastra ≥ 0,89 i minimum ≥ 0,85 (bez łańcuchowania).
- **Ranking**: liczba niezależnych źródeł + 0,5 × świeżość. Najpierw historie z ≥ 2 źródeł („Obecne w N niezależnych źródłach”), do 5 pozycji jednoźródłowych tylko jako uzupełnienie („Na radarze”). Bez liczników czytelników i wyświetleń. Sekcji „najpopularniejsze” portali nie używamy — nie znaleźliśmy kanałów, które by je udostępniały zgodnie z zasadami.
- **Migawki** (`trending_snapshot`, `trending_item`): metoda, czas sprawdzenia, członkowie klastra z URL-ami i składniki oceny; zostają 48 h. Pierwszy przebieg (18.10, 01:40): 270 newsów, 166 historii, 33 z kilku źródeł; czołówka: atak na dyplomatów na Zachodnim Brzegu (7 źródeł), konwencja Rozwoju Plus (6), drony nad Rumunią (5).
- **Streszczenia**: dla 10 pierwszych historii — pobranie strony (robots.txt) i streszczenie w budżecie LLM; przedstawicielem klastra jest pozycja ze streszczeniem lub pobraną stroną.
- **Wydarzenia w Trending**: osobny ranking z katalogu wydarzeń (14 dni): liczba różnych stron ogłaszających (ten sam tytuł), dane strukturalne organizatora, znany termin zapisów, bliskość. Cykl sesji pokazujemy raz. Na razie tylko Kraków i w praktyce wszystko „Na radarze” (jedno źródło) — uczciwie oznaczone.
- Polubienia, streszczenia, przeczytanie i obecność w „Twoich artykułach” działają dla newsów z Trending tak samo jak dla artykułów (`kind = 'news'`).

## Etap 2, krok 8: raport tygodniowy (18.10.2026)

- **Termin**: domyślnie piątek 20:00 w strefie osoby (czas ścienny — poprawnie przez zmiany czasu). Worker co 5 min zleca generację, gdy do terminu zostało ≤ 60 min. Raport powstaje ok. 45 min przed terminem, wysyłka ma `run_at` = termin.
- **Najpierw zapis, potem wysyłka**: `weekly_report` (unikalny na osobę i okres = tydzień ISO terminu) i `email_delivery` (unikalna na raport i kanał, klucz idempotencji `report:<osoba>:<okres>:email`). Ponowienie zadania nie tworzy drugiego raportu ani wysyłki.
- **Gwarancja: najwyżej jedna wysyłka, nie „dokładnie jedna”**. Przejęcie `pending → sending` jest atomowe. Błąd przed przekazaniem wiadomości serwerowi (połączenie, DNS, logowanie, odrzucenie MAIL FROM/RCPT TO) jest ponawiany. Każdy inny błąd (np. przerwanie w trakcie DATA) to `uncertain` i nie wysyłamy go ślepo drugi raz. `sending` starsze niż 30 min (awaria procesu) też przechodzi w `uncertain`. Przy zerwanym połączeniu po przyjęciu przez serwer osoba może więc nie dostać raportu, ale nie dostanie go dwa razy. SMTP nie ma idempotencji dostawcy, więc klucz przekazujemy w nagłówku `X-Idempotency-Key` tylko informacyjnie.
- **Ponowna kontrola tuż przed wysyłką**: raport włączony, adres zweryfikowany, konto istnieje, opóźnienie ≤ `REPORT_MAX_DELAY_HOURS` (12 h). Inaczej `skipped`, a raport zostaje w archiwum.
- **Treść (≤ 10 różnych pozycji)**:
  - najpierw polubione i nieprzeczytane z tygodnia;
  - potem najlepsze z dziennych pul;
  - do 2 historii z Trending z ≥ 3 niezależnymi źródłami („Ważne w Polsce”);
  - wydarzenia na 7 dni od terminu, w tym weekend;
  - do 2 bliskich terminów zapisów.

  Przeczytane i pominięte nie wracają. Ta sama historia trafia do raportu raz (e5 ≥ 0,9), a jeden temat najwyżej 2 razy (po pierwszym przebiegu raport był „tygodniem Tesli”: 5 z 6 newsów). Trwające wydarzenia pokazujemy jako „trwa do …”, a nie z datą otwarcia sprzed miesięcy. Bez statystyk aktywności. Brak treści oznacza raport „pusty” w archiwum, bez wysyłki.
- **Synteza „co się zmieniło”** (Haiku, `pl-report-v1`): tylko z streszczeń pozycji raportu. Każde zdanie wskazuje pozycje, a zdania bez pozycji z raportu są odrzucane. Koszt ok. 0,001 $ za raport. Bez klucza, budżetu lub przy awarii raport powstaje bez syntezy, z prostym wstępem.
- **Wypis**: nieprzezroczysty token HMAC (sekret serwera + id osoby), w bazie jego hash. GET pokazuje stronę z przyciskiem, żeby skanery linków w poczcie nie wypisywały nikogo samym otwarciem. POST wypisuje. Nagłówki `List-Unsubscribe` i `List-Unsubscribe-Post` obsługują wypis jednym kliknięciem (RFC 8058); ścieżka ma wyjątek od kontroli Origin. Token pozwala tylko wyłączyć raport.
- **Archiwum**: Profil → Raport tygodniowy → Archiwum raportów (`GET /me/reports`, `/me/reports/:id`, tylko własne). Raporty są w eksporcie konta i usuwane razem z kontem.
- **Produkcja**: adapter `EMAIL_PROVIDER=smtp` (dowolna usługa SMTP; wymaga loginu, hasła i prawdziwego nadawcy). Dev: Mailpit.

## Poza etapem 1 (świadomie niezrobione)

- Silnik treści — zrobione w etapie 2: wyszukiwanie, ekstrakcja, streszczenia, embeddingi, ranking, limit 20, polubienia i przeczytane. Uczenie — krok 5, wydarzenia — krok 6, Trending — krok 7, raport tygodniowy — krok 8. Etap 2 zamknięty.
- Moduł płatności nie istnieje i nie powstanie.
- Otwarte po etapie 2:
  - rozwijanie własnych zainteresowań przez AI w onboardingu (cache w `interest_node`, `origin='ai'`);
  - logowanie Google (klucze);
  - produkcyjny dostawca e-mail;
  - źródła wydarzeń dla miast innych niż Kraków;
  - wdrożenie workera na serwer.

## Wdrożenie (Vercel + Supabase)

- Front statyczny i API jako jedna funkcja Vercel (`api/index.js` → `dist-api/vercel.mjs`); worker z embeddingami e5 (onnxruntime) nie mieści się w funkcji i działa osobno.
- Baza: Supabase Postgres przez pooler w trybie transakcyjnym. Kod jest z nim zgodny: brak nazwanych prepared statements, tylko blokady `pg_advisory_xact_lock` (na czas transakcji), brak `LISTEN`/`SET` sesyjnych.
- TLS: Supabase podpisuje certyfikaty własnym CA, więc `DATABASE_CA_CERT` daje weryfikację z `rejectUnauthorized: true`. Nie wyłączamy weryfikacji.
- Data API Supabase: migracja `0011` (RLS bez polityk + odebrane uprawnienia `anon`/`authenticated`, także domyślne dla przyszłych tabel). Klucz publishable/anon nie daje dostępu do żadnych danych; front go nie używa. Migracja `0012` przenosi pgvector do schematu `extensions` (tylko gdy jest w `search_path`, czyli na Supabase), żeby jego funkcje nie były wywoływalne przez `/rest/v1/rpc`.
- `esbuild` w wersji zgodnej z Vite 8 (`0.28.x`) — starsza wersja blokowała `npm install` na Vercelu (konflikt peer).
