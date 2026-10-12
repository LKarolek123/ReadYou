/**
 * EmbeddingProvider: wektory znaczenia tekstu dla treści i zainteresowań.
 * Każdy wektor zapisujemy razem z `model` i `dim`, żeby nigdy nie porównywać
 * wektorów z niekompatybilnych modeli.
 */
export interface EmbeddingProvider {
  /** Identyfikator modelu zapisywany przy wektorze, np. `intfloat/multilingual-e5-small`. */
  readonly model: string;
  readonly dim: number;
  /** Wektory dokumentów (artykułów, wydarzeń). Znormalizowane do długości 1. */
  embedPassages(texts: readonly string[]): Promise<number[][]>;
  /** Wektor zapytania lub zainteresowania. Znormalizowany do długości 1. */
  embedQuery(text: string): Promise<number[]>;
}

/** Podobieństwo kosinusowe; dla wektorów znormalizowanych to iloczyn skalarny. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error(`Niezgodne wymiary wektorów: ${a.length} ≠ ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
