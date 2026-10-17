import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AnthropicEventExtractor,
  AnthropicSummaryProvider,
  E5EmbeddingProvider,
  type EmbeddingProvider,
  type EventExtractor,
  type SummaryProvider,
} from '@readyou/providers';
import { env } from './env.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let embedding: EmbeddingProvider | null | undefined;

/** Dostawca embeddingów z konfiguracji; `null`, gdy jawnie wyłączony. */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  if (embedding === undefined) {
    embedding =
      env.EMBEDDING_PROVIDER === 'e5-local'
        ? new E5EmbeddingProvider({ cacheDir: path.resolve(root, env.EMBEDDING_CACHE_DIR) })
        : null;
  }
  return embedding;
}

/** Podmiana dostawcy w testach (np. FakeEmbeddingProvider). */
export function setEmbeddingProvider(p: EmbeddingProvider | null) {
  embedding = p;
}

let summary: SummaryProvider | undefined;

/** Dostawca streszczeń. Bez klucza zwraca błąd konfiguracji przy wywołaniu (bez fikcyjnych streszczeń). */
export function getSummaryProvider(): SummaryProvider {
  summary ??= new AnthropicSummaryProvider(env.ANTHROPIC_API_KEY, env.SUMMARY_MODEL);
  return summary;
}

/** Podmiana dostawcy w testach. */
export function setSummaryProvider(p: SummaryProvider) {
  summary = p;
}

let eventExtractor: EventExtractor | null | undefined;

/** Ekstraktor wydarzeń (AI z cytatami); null bez klucza — wtedy tylko dane strukturalne. */
export function getEventExtractor(): EventExtractor | null {
  if (eventExtractor === undefined) eventExtractor = env.ANTHROPIC_API_KEY ? new AnthropicEventExtractor(env.ANTHROPIC_API_KEY, env.SUMMARY_MODEL) : null;
  return eventExtractor;
}

export function setEventExtractor(p: EventExtractor | null) {
  eventExtractor = p;
}
