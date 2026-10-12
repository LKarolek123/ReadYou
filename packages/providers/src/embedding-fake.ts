/**
 * Deterministyczna atrapa embeddingów — WYŁĄCZNIE do testów.
 * Haszuje słowa do wymiarów (bag of words), więc nie rozumie znaczenia
 * i nie może być przedstawiana jako działające AI.
 */
import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from './embedding.ts';

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'test/fake-hash';
  constructor(readonly dim = 384) {}

  private vec(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
      const h = createHash('sha256').update(word).digest();
      v[h.readUInt32BE(0) % this.dim]! += 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }

  async embedPassages(texts: readonly string[]) {
    return texts.map((t) => this.vec(t));
  }

  async embedQuery(text: string) {
    return this.vec(text);
  }
}
