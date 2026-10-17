/**
 * SearchProvider: znajduje adresy treści dla zapytania.
 *
 * Wyniki są TYMCZASOWE (regulamin Brave §3(b)(i)): służą wyłącznie do wyboru adresów do pobrania
 * w ramach jednego zadania i nie są zapisywane w bazie. Zapisujemy to, co sami pobierzemy ze strony wydawcy.
 */
import { ProviderNotConfiguredError, ProviderRateLimitError } from './errors.ts';

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  /** Data publikacji podana przez wyszukiwarkę (jeśli znana). */
  publishedAt: Date | null;
}

export interface SearchQuery {
  q: string;
  lang: 'pl' | 'en';
  /** Kod kraju (np. PL) albo brak dla wyników globalnych. */
  country?: string;
  freshness?: 'pd' | 'pw' | 'pm';
  count?: number;
}

export interface SearchProvider {
  readonly name: string;
  searchNews(query: SearchQuery): Promise<SearchHit[]>;
  /** Wyszukiwanie ogólne (strony wydarzeń, organizatorów) — te same zasady przechowywania. */
  searchWeb(query: SearchQuery): Promise<SearchHit[]>;
}

const NEWS_ENDPOINT = 'https://api.search.brave.com/res/v1/news/search';
// Port z Pulse & Go: apps/api/app/adapters/outbound/search_brave.py (Web Search, wyniki w `web.results`).
const WEB_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

/** Brave News Search API (dokumentacja: api-dashboard.search.brave.com, „News Search”). */
export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave';

  constructor(private readonly apiKey: string | undefined) {}

  async searchNews(query: SearchQuery): Promise<SearchHit[]> {
    const data = (await this.get(NEWS_ENDPOINT, query, 50)) as { results?: Array<Record<string, any>> };
    return toHits(data.results);
  }

  async searchWeb(query: SearchQuery): Promise<SearchHit[]> {
    const data = (await this.get(WEB_ENDPOINT, { ...query, freshness: query.freshness ?? 'pm' }, 20)) as { web?: { results?: Array<Record<string, any>> } };
    return toHits(data.web?.results);
  }

  private async get(endpoint: string, query: SearchQuery, maxCount: number): Promise<unknown> {
    if (!this.apiKey) throw new ProviderNotConfiguredError('Brak klucza Brave Search (BRAVE_SEARCH_SECRET_KEY)');
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      q: query.q,
      count: String(Math.min(query.count ?? 20, maxCount)),
      search_lang: query.lang,
      ...(query.country ? { country: query.country } : {}),
      freshness: query.freshness ?? 'pw',
      safesearch: 'moderate',
    }).toString();
    const res = await fetch(url, {
      headers: { 'X-Subscription-Token': this.apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      throw new ProviderRateLimitError('Brave: limit zapytań', (Number.isFinite(ra) && ra > 0 ? ra : 60) * 1000);
    }
    // Treść błędu bez klucza: klucz jest tylko w nagłówku, nie w adresie.
    if (!res.ok) throw new Error(`Brave: HTTP ${res.status}`);
    return res.json();
  }
}

function toHits(results: Array<Record<string, any>> | undefined): SearchHit[] {
  return (results ?? [])
    .filter((r) => typeof r.url === 'string')
    .map((r) => ({
      url: r.url as string,
      title: String(r.title ?? ''),
      snippet: String(r.description ?? ''),
      publishedAt: typeof r.page_age === 'string' && !Number.isNaN(Date.parse(r.page_age)) ? new Date(r.page_age) : null,
    }));
}
