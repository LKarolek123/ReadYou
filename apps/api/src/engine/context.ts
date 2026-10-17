/** Współdzielone w procesie klienty odkrywania treści (jeden fetcher = wspólne odstępy per domena). */
import {
  BraveSearchProvider,
  ContentExtractor,
  RobotsGuard,
  SafeFetcher,
  type ExtractedArticle,
  type SearchProvider,
} from '@readyou/providers';
import { env } from '../env.ts';

export const BOT_TOKEN = 'ReadYouBot';

export interface EngineContext {
  fetcher: SafeFetcher;
  /** Osobny klient dla Overpass (OSM): długie zapytania zbiorcze, większe odpowiedzi. */
  osmFetcher: SafeFetcher;
  robots: Pick<RobotsGuard, 'assertAllowed'>;
  extractor: Pick<ContentExtractor, 'extract'> & { extract(url: string): Promise<ExtractedArticle> };
  search: SearchProvider;
}

let ctx: EngineContext | undefined;

export function engine(): EngineContext {
  if (!ctx) {
    const contact = env.CRAWLER_CONTACT ?? env.APP_URL;
    const fetcher = new SafeFetcher({ userAgent: `${BOT_TOKEN}/0.1 (+${contact})`, perHostDelayMs: 1500 });
    const robots = new RobotsGuard(fetcher, BOT_TOKEN);
    ctx = {
      fetcher,
      osmFetcher: new SafeFetcher({ userAgent: `${BOT_TOKEN}/0.1 (+${contact})`, perHostDelayMs: 5000, timeoutMs: 120_000, maxBytes: 8 * 1024 * 1024 }),
      robots,
      extractor: new ContentExtractor(fetcher, robots),
      search: new BraveSearchProvider(env.BRAVE_SEARCH_SECRET_KEY),
    };
  }
  return ctx;
}

/** Tylko testy: podmiana wyszukiwarki i ekstraktora na atrapy (bez sieci). */
export function setEngineForTests(partial: Partial<EngineContext>) {
  ctx = { ...engine(), ...partial };
}

export async function closeEngine() {
  await ctx?.fetcher.close();
  await ctx?.osmFetcher.close();
  ctx = undefined;
}
