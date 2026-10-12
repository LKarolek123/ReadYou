// Port z Pulse & Go: apps/api/app/adapters/outbound/embedding_e5.py
/**
 * Lokalne embeddingi multilingual-e5-small (384 wymiary) liczone w procesie Node.js
 * przez transformers.js (ONNX). Koszt 0 $, tekst nie opuszcza serwera.
 *
 * Model (~120 MB, wersja skwantyzowana) pobiera się z Hugging Face przy pierwszym użyciu
 * i trafia do cache (`EMBEDDING_CACHE_DIR`). Kolejne uruchomienia działają offline.
 *
 * e5 wymaga prefiksów: „query: ” dla zapytań/zainteresowań i „passage: ” dla dokumentów.
 */
import type { EmbeddingProvider } from './embedding.ts';

type Extractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

export const E5_MODEL = 'intfloat/multilingual-e5-small';
/** Port ONNX tego samego modelu (te same wagi), wymagany przez transformers.js. */
const ONNX_REPO = 'Xenova/multilingual-e5-small';

export interface E5Options {
  cacheDir?: string;
  batchSize?: number;
  /** Pełna precyzja (fp32) zamiast domyślnej wersji skwantyzowanej (q8). */
  fullPrecision?: boolean;
}

export class E5EmbeddingProvider implements EmbeddingProvider {
  readonly model = E5_MODEL;
  readonly dim = 384;
  private extractor?: Promise<Extractor>;
  private readonly batchSize: number;

  constructor(private readonly opts: E5Options = {}) {
    this.batchSize = opts.batchSize ?? 16;
  }

  private load(): Promise<Extractor> {
    // Jedno ładowanie modelu na proces, nawet przy równoległych wywołaniach.
    this.extractor ??= (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      if (this.opts.cacheDir) env.cacheDir = this.opts.cacheDir;
      env.allowLocalModels = false;
      const pipe = await pipeline('feature-extraction', ONNX_REPO, {
        dtype: this.opts.fullPrecision ? 'fp32' : 'q8',
      });
      return pipe as unknown as Extractor;
    })().catch((err: unknown) => {
      this.extractor = undefined; // pozwól ponowić po błędzie sieci
      throw new Error(`Nie udało się załadować modelu ${E5_MODEL}: ${(err as Error).message}`);
    });
    return this.extractor;
  }

  private async encode(texts: string[]): Promise<number[][]> {
    const extractor = await this.load();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
      out.push(...tensor.tolist());
    }
    return out;
  }

  async embedPassages(texts: readonly string[]): Promise<number[][]> {
    if (!texts.length) return [];
    return this.encode(texts.map((t) => `passage: ${clean(t)}`));
  }

  async embedQuery(text: string): Promise<number[]> {
    const [v] = await this.encode([`query: ${clean(text)}`]);
    return v!;
  }
}

/** e5 ma limit 512 tokenów; przycinamy tekst z zapasem i usuwamy nadmiar białych znaków. */
function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 2000);
}
