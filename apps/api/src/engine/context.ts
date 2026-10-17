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
  extractor: Pick<ContentExtractor, 'extract'> & { extract(url: string): Promise<ExtractedArticle> };
  search: SearchProvider;
}

let ctx: EngineContext | undefined;

export function engine(): EngineContext {
  if (!ctx) {
    const contact = env.CRAWLER_CONTACT ?? env.APP_URL;
    const fetcher = new SafeFetcher({ userAgent: `${BOT_TOKEN}/0.1 (+${contact})`, perHostDelayMs: 1500 });
    ctx = {
      fetcher,
      extractor: new ContentExtractor(fetcher, new RobotsGuard(fetcher, BOT_TOKEN)),
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
  ctx = undefined;
}
