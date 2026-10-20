// Port z Pulse & Go: apps/api/app/adapters/outbound/osm_overpass.py (zapytanie po obszarze miasta, odczyt elementów, ceny z tagów).
/**
 * Kluby i miejsca z OpenStreetMap (Overpass API). Dane OSM są na licencji ODbL —
 * wymagana atrybucja „© OpenStreetMap contributors” przy wyświetlaniu.
 *
 * Polityka Overpass: rozsądne użycie (rzadkie, zbiorcze zapytania). Pobieramy jedno zapytanie na miasto
 * i odświeżamy je co kilka dni, z identyfikującym User-Agentem.
 */
import { ProviderRateLimitError, ProviderUnavailableError } from './errors.ts';
import type { SafeFetcher } from './safe-fetch.ts';

export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';

/** Selektor OSM → rodzaj pozycji i opis kategorii (z tagów OSM, nie wymyślony). */
export interface OsmSelector {
  /** Fragment zapytania Overpass, np. `["sport"="chess"]`. */
  filter: string;
  kind: 'club' | 'place';
  category: string;
}

/**
 * Węzły taksonomii ReadYou → selektory OSM. Tylko kategorie, które OSM opisuje wiarygodnie; zbyt ogólne
 * (np. każda kawiarnia) celowo pomijamy, żeby nie zalewać listy.
 */
export const OSM_SELECTORS: Record<string, OsmSelector[]> = {
  'games.chess': [
    { filter: '["club"="chess"]', kind: 'club', category: 'Klub szachowy' },
    { filter: '["sport"="chess"]', kind: 'club', category: 'Szachy' },
  ],
  'games.board': [{ filter: '["club"="board_games"]', kind: 'club', category: 'Klub gier planszowych' }],
  dance: [
    { filter: '["leisure"="dance"]', kind: 'club', category: 'Szkoła lub sala tańca' },
    { filter: '["amenity"="dancing_school"]', kind: 'club', category: 'Szkoła tańca' },
  ],
  'mountains.climbing': [{ filter: '["sport"="climbing"]["leisure"~"^(sports_centre|sports_hall|fitness_centre)$"]', kind: 'club', category: 'Ścianka wspinaczkowa' }],
  'sport.fitness': [{ filter: '["leisure"="fitness_centre"]', kind: 'club', category: 'Siłownia / fitness' }],
  'sport.volleyball': [{ filter: '["sport"="volleyball"]["leisure"="sports_centre"]', kind: 'club', category: 'Obiekt siatkarski' }],
  tech: [{ filter: '["leisure"="hackerspace"]', kind: 'club', category: 'Hackerspace' }],
  'tech.hackathons': [{ filter: '["leisure"="hackerspace"]', kind: 'club', category: 'Hackerspace' }],
  'culture.books': [{ filter: '["amenity"="library"]', kind: 'place', category: 'Biblioteka' }],
  'culture.art': [
    { filter: '["tourism"="gallery"]', kind: 'place', category: 'Galeria' },
    { filter: '["tourism"="museum"]', kind: 'place', category: 'Muzeum' },
  ],
  'culture.history': [{ filter: '["tourism"="museum"]', kind: 'place', category: 'Muzeum' }],
  'culture.theatre': [{ filter: '["amenity"="theatre"]', kind: 'place', category: 'Teatr' }],
  'culture.film': [{ filter: '["amenity"="cinema"]', kind: 'place', category: 'Kino' }],
  'music.concerts': [{ filter: '["amenity"="music_venue"]', kind: 'place', category: 'Klub muzyczny' }],
  'music.jazz': [{ filter: '["amenity"="music_venue"]', kind: 'place', category: 'Klub muzyczny' }],
  'music.classical': [{ filter: '["amenity"="concert_hall"]', kind: 'place', category: 'Sala koncertowa' }],
};

/** Selektory dla węzła z dziedziczeniem po przodkach (np. „dance.salsa” → selektory „dance”). */
export function osmSelectorsFor(path: readonly string[]): OsmSelector[] {
  return [...path].reverse().flatMap((id) => OSM_SELECTORS[id] ?? []).filter((s, i, all) => all.findIndex((o) => o.filter === s.filter) === i);
}

export interface OsmPlace {
  osmRef: string;
  name: string;
  kind: 'club' | 'place';
  category: string;
  filter: string;
  lat: number;
  lon: number;
  address: string | null;
  website: string | null;
  openingHours: string | null;
  description: string | null;
  priceMin: number | null;
  priceMax: number | null;
  free: boolean;
}

/** Zapytanie Overpass: obszar miasta po nazwie i poziomie gminy (bez zakodowanych identyfikatorów relacji). */
export function placesQuery(city: string, selectors: readonly OsmSelector[], timeoutS = 60): string {
  const name = city.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const lines = [...new Set(selectors.map((s) => s.filter))].map((f) => `  nwr${f}["name"](area.a);`);
  return `[out:json][timeout:${timeoutS}];\narea["name"="${name}"]["admin_level"="8"]->.a;\n(\n${lines.join('\n')}\n);\nout center tags 400;`;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const PLN = /(?<![\w.,-])(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?\s*(?:PLN|zł|zl)(?!\w)/gi;

function matches(tags: Record<string, string>, filter: string): boolean {
  for (const m of filter.matchAll(/\["([^"]+)"(=|~)"([^"]+)"\]/g)) {
    const v = tags[m[1]!];
    if (v === undefined) return false;
    if (m[2] === '=' ? v !== m[3] : !new RegExp(m[3]!).test(v)) return false;
  }
  return true;
}

export function elementToPlace(el: OverpassElement, selectors: readonly OsmSelector[]): OsmPlace | null {
  const tags = el.tags ?? {};
  const name = tags.name?.trim();
  const point = el.lat !== undefined ? { lat: el.lat, lon: el.lon! } : el.center;
  const sel = selectors.find((s) => matches(tags, s.filter));
  if (!name || !point || !sel) return null;
  const nums = [...(tags.charge ?? '').matchAll(PLN)].flatMap((m) => [m[1], m[2]]).filter(Boolean).map((n) => Number(n!.replace(',', '.')));
  const free = tags.fee?.trim().toLowerCase() === 'no';
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
  let website = tags.website ?? tags['contact:website'] ?? null;
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  return {
    osmRef: `${el.type}/${el.id}`,
    name,
    kind: sel.kind,
    category: sel.category,
    filter: sel.filter,
    lat: point.lat,
    lon: point.lon,
    address: [street, tags['addr:city']].filter(Boolean).join(', ') || null,
    website,
    openingHours: tags.opening_hours ?? null,
    description: (tags['description:pl'] ?? tags.description ?? '').trim() || null,
    priceMin: free ? 0 : nums.length ? Math.min(...nums) : null,
    priceMax: free ? 0 : nums.length ? Math.max(...nums) : null,
    free,
  };
}

export class OverpassPlacesProvider {
  constructor(
    private readonly fetcher: SafeFetcher,
    private readonly endpoint = OVERPASS_ENDPOINT,
  ) {}

  async places(city: string, selectors: readonly OsmSelector[]): Promise<OsmPlace[]> {
    if (!selectors.length) return [];
    const url = `${this.endpoint}?data=${encodeURIComponent(placesQuery(city, selectors))}`;
    const res = await this.fetcher.fetch(url, ['application/json']);
    if (res.status === 429 || res.status === 504) throw new ProviderRateLimitError(`Overpass: HTTP ${res.status}`, 30 * 60_000);
    // Publiczny serwer przy pełnej kolejce odpowiada 502/503, a klientów automatycznych odsyła z 406 —
    // to stan serwera, nie błąd zapytania: wracamy po kilku godzinach zamiast ponawiać od razu.
    if (res.status === 406 || res.status >= 500) throw new ProviderUnavailableError(`Overpass: HTTP ${res.status}`, 3 * 60 * 60_000);
    if (res.status >= 400) throw new Error(`Overpass: HTTP ${res.status}`);
    const data = JSON.parse(res.body.toString('utf8')) as { elements?: OverpassElement[] };
    const seen = new Set<string>();
    const out: OsmPlace[] = [];
    for (const el of data.elements ?? []) {
      const p = elementToPlace(el, selectors);
      if (p && !seen.has(p.osmRef)) {
        seen.add(p.osmRef);
        out.push(p);
      }
    }
    return out;
  }
}
