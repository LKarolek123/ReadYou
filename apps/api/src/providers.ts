import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E5EmbeddingProvider, type EmbeddingProvider } from '@readyou/providers';
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
