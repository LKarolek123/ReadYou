/**
 * Źródła wydarzeń per miasto i zapytania wyszukiwarki per temat.
 *
 * Strony organizatorów dla Krakowa pochodzą z listy punktów wejścia crawlera Pulse & Go
 * (`seed/crawl_entrypoints.yaml`) — to konfiguracja integracji (adresy stron programu), a nie dane
 * wydarzeń: same wydarzenia pobieramy na bieżąco ze stron. Pominięto adresy pojedynczych wydarzeń
 * (szybko się dezaktualizują) i strony wspólnot religijnych (nie wyciągamy wniosków o religii).
 * Sprawdzone 18.10.2026: Klub Studio (iCal), Jazz It Up (JSON-LD), Tauron Arena (JSON-LD na
 * stronach szczegółów); pozostałe bez danych strukturalnych → ekstrakcja AI z walidacją cytatów.
 *
 * Inne miasta: brak skonfigurowanych stron → wydarzenia tylko z wyszukiwarki (z dowodem miejsca)
 * i wydarzenia online. Interfejs mówi o tym wprost.
 */
import { normalizeTag } from '@readyou/shared';
import type { PlannedQuery } from './sources.ts';

export interface EventSourceConfig {
  url: string;
  kind: 'ics' | 'page';
  /**
   * Agregator regionalny (wydarzenia także poza miastem): miasto wydarzenia musi wynikać z jego adresu,
   * nie z konfiguracji źródła. Domyślnie: organizator z siedzibą w mieście.
   */
  regional?: boolean;
}

export const EVENT_SOURCES: Record<string, EventSourceConfig[]> = {
  krakow: [
    { url: 'https://jazzitup.pl/', kind: 'page', regional: true }, // cała Małopolska (np. Stary Sącz)
    { url: 'https://www.klubstudio.pl/wydarzenia', kind: 'page' },
    { url: 'https://www.tauronarenakrakow.pl/events/', kind: 'page' },
    // Kalendarium miasta obejmuje też gminy ościenne (np. biblioteka w Rybnej).
    { url: 'https://www.krakow.pl/kalendarium/1919,artykul,kalendarium.html', kind: 'page', regional: true },
    { url: 'https://www.muzeumkrakowa.pl/wydarzenia', kind: 'page' },
    { url: 'https://alchemia.com.pl/program/', kind: 'page' },
    { url: 'https://filharmoniakrakow.pl/public/program', kind: 'page' },
    { url: 'https://ludowy.pl/repertuar/', kind: 'page' },
    { url: 'https://www.agh.edu.pl/wydarzenia', kind: 'page' },
    { url: 'https://namiasteczku.org/kalendarz', kind: 'page' },
    { url: 'https://klubkwadrat.pl/', kind: 'page' },
  ],
};

export const CITY_NAMES: Record<string, string> = { krakow: 'Kraków' };

export const cityKey = (city: string | null | undefined) => (city ? normalizeTag(city) : '');

export function eventSourcesFor(city: string | null | undefined): EventSourceConfig[] {
  return EVENT_SOURCES[cityKey(city)] ?? [];
}

/**
 * Zapytania wyszukiwarki o wydarzenia (`{city}` = miasto osoby). Konkretne frazy z terminem zapisów
 * (hackathon za miesiąc bywa istotny dziś, gdy zapisy kończą się w tym tygodniu).
 */
export const EVENT_QUERIES: Record<string, ((city: string) => PlannedQuery)[]> = {
  'tech.hackathons': [
    (c) => ({ q: `hackathon ${c} zapisy`, lang: 'pl', country: 'PL' }),
    () => ({ q: 'hackathon online 2026 registration deadline', lang: 'en' }),
  ],
  tech: [(c) => ({ q: `meetup technologiczny ${c}`, lang: 'pl', country: 'PL' })],
  'tech.ai': [(c) => ({ q: `konferencja AI ${c} 2026`, lang: 'pl', country: 'PL' })],
  'games.chess': [(c) => ({ q: `turniej szachowy ${c}`, lang: 'pl', country: 'PL' })],
  'dance.ballroom': [(c) => ({ q: `turniej tańca towarzyskiego ${c}`, lang: 'pl', country: 'PL' })],
  dance: [(c) => ({ q: `warsztaty taneczne ${c}`, lang: 'pl', country: 'PL' })],
  'mountains.climbing': [(c) => ({ q: `zawody wspinaczkowe ${c}`, lang: 'pl', country: 'PL' })],
  'sport.running': [(c) => ({ q: `bieg zapisy ${c}`, lang: 'pl', country: 'PL' })],
  'music.concerts': [(c) => ({ q: `koncerty ${c} w tym tygodniu`, lang: 'pl', country: 'PL' })],
};

/** Zapytania dla miasta: po jednym na temat z listy, w kolejności tematów (limit stosuje wywołujący). */
export function eventQueriesFor(city: string, nodePaths: string[][]): PlannedQuery[] {
  const out: PlannedQuery[] = [];
  const seen = new Set<string>();
  for (const path of nodePaths) {
    for (const id of [...path].reverse()) {
      for (const make of EVENT_QUERIES[id] ?? []) {
        const q = make(city);
        if (!seen.has(q.q)) {
          seen.add(q.q);
          out.push(q);
        }
      }
    }
  }
  return out;
}

/**
 * Linki do stron szczegółów na stronie programu (ta sama domena, typowe ścieżki wydarzeń).
 * Strony szczegółów często mają JSON-LD, gdy strona listy go nie ma — wtedy nie potrzeba AI.
 */
export const DETAIL_LINK = /\/(event|events|wydarzeni[ea]|wydarzenie|program|repertuar|spektakl|koncert|kalendarium)\/[^?#]{3,}/i;
