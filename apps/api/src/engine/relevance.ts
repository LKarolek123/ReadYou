/**
 * Trafność treści względem zainteresowania (miara F2 z kalibracji, docs/implementation-plan.md),
 * z poprawkami po pierwszym przebiegu na prawdziwych danych:
 *
 *   margines = podobieństwo(treść, zainteresowanie) + bonus źródła
 *              − max(podobieństwo do ogólnych działów newsowych, podobieństwo do PRZODKÓW zainteresowania)
 *
 * - Działy newsowe: surowy kosinus e5 nie odróżnia trafnych od nietrafnych (AUC ≈ 0,55–0,61); porównanie
 *   z „konkurencją” (polityka, wypadki, sport…) daje AUC ≈ 0,93–0,95.
 * - Przodkowie: wektor liścia liczony ze ścieżki („Informatyka i technologia > Hackathony”) niesie głównie
 *   znaczenie rodzica, więc liść przyciągał ogólne newsy technologiczne. Teraz treść zalicza się do liścia
 *   tylko wtedy, gdy jest bliżej liścia niż jego przodków. Ogólne treści trafiają do rodzica — o ile osoba
 *   go wybrała.
 * - Bonus źródła: pozycja z kanału tematycznego (np. Chess.com) dostaje mały bonus dla tego węzła i jego
 *   przodków — nagłówek szachowy bez słowa „szachy” nadal jest szachowy.
 *
 * - Dowody słowne: liść z listy EVIDENCE (np. Hackathony) wymaga słowa-dowodu w tekście albo kanału
 *   tematycznego. Bez dowodu treść liczy się do ogólniejszego zainteresowania; jeśli żadne nie pasuje,
 *   jest tylko „sąsiednia” (kandydat do ~20% puli odkrywania), a nie „dopasowana”.
 *
 * Działy pokrywające się z zainteresowaniem (np. Sport dla kogoś, kto wybrał sport) są dla niego wyłączane.
 */
import { cosine, type EmbeddingProvider } from '@readyou/providers';
import { getNode } from '@readyou/shared';
import { interestText } from '../services/embeddings.ts';
import { DEDICATED_FEEDS, EVIDENCE } from './sources.ts';

interface NewsDesk {
  text: string;
  /** Kategorie główne taksonomii, z którymi dział się pokrywa. */
  overlaps: string[];
}

export const NEWS_DESKS: NewsDesk[] = [
  { text: 'Polityka i rząd', overlaps: [] },
  { text: 'Wybory i sondaże', overlaps: [] },
  { text: 'Wojna i bezpieczeństwo', overlaps: [] },
  { text: 'Wojsko i uzbrojenie', overlaps: [] },
  { text: 'Wypadki i katastrofy', overlaps: [] },
  { text: 'Przestępczość i sądy', overlaps: [] },
  { text: 'Gospodarka, ceny i podatki', overlaps: ['business'] },
  { text: 'Banki i finanse osobiste', overlaps: ['business'] },
  { text: 'Pogoda i klimat', overlaps: ['nature'] },
  { text: 'Religia i Kościół', overlaps: [] },
  { text: 'Celebryci i plotki', overlaps: ['culture', 'music'] },
  { text: 'Transport publiczny i kolej', overlaps: ['travel'] },
  { text: 'Zdrowie i szpitale', overlaps: ['science'] },
  { text: 'Edukacja i szkoły', overlaps: [] },
  { text: 'Usługi publiczne i administracja', overlaps: [] },
  { text: 'Sport: piłka nożna, tenis, siatkówka, wyniki meczów', overlaps: ['sport'] },
];

/** Gdy zainteresowanie nie pochodzi z taksonomii: dział uznajemy za pokrywający się powyżej tego podobieństwa. */
const CUSTOM_OVERLAP_SIM = 0.9;
/** Bonus dla pozycji z kanału tematycznego. Startowa wartość — do strojenia na ocenach (engine eval). */
export const SOURCE_PRIOR = 0.02;

export interface DeskVectors {
  model: string;
  vectors: number[][];
}

const cachedDesks = new Map<string, Promise<DeskVectors>>();

/** Wektory działów per model (nigdy nie mieszamy wektorów różnych modeli). */
export function deskVectors(provider: EmbeddingProvider): Promise<DeskVectors> {
  let p = cachedDesks.get(provider.model);
  if (!p) {
    p = (async () => {
      const vectors: number[][] = [];
      for (const d of NEWS_DESKS) vectors.push(await provider.embedQuery(d.text));
      return { model: provider.model, vectors };
    })().catch((e) => {
      cachedDesks.delete(provider.model);
      throw e;
    });
    cachedDesks.set(provider.model, p);
  }
  return p;
}

export interface InterestVector {
  id: string;
  label: string;
  nodeKey: string | null;
  vector: number[];
  /** Wektory przodków (od rodzica w górę); puste dla kategorii głównej. */
  ancestors: number[][];
}

const ancestorCache = new Map<string, number[]>();

/** Wektory przodków dla ścieżki zainteresowania (cache w procesie — ta sama ścieżka u wielu osób). */
export async function ancestorVectors(path: readonly string[], provider: EmbeddingProvider): Promise<number[][]> {
  const out: number[][] = [];
  for (let len = path.length - 1; len >= 1; len--) {
    const prefix = path.slice(0, len);
    const text = interestText(prefix.at(-1)!, prefix);
    const key = `${provider.model}\n${text}`;
    let v = ancestorCache.get(key);
    if (!v) {
      v = await provider.embedQuery(text);
      ancestorCache.set(key, v);
    }
    out.push(v);
  }
  return out;
}

/** Indeksy działów, które dla danego zainteresowania NIE są konkurencją. */
export function overlappingDesks(interest: InterestVector, desks: DeskVectors): Set<number> {
  const out = new Set<number>();
  const root = interest.nodeKey ? getNode(interest.nodeKey)?.rootId : undefined;
  NEWS_DESKS.forEach((d, i) => {
    if (root && d.overlaps.includes(root)) out.add(i);
    else if (!root && cosine(interest.vector, desks.vectors[i]!) >= CUSTOM_OVERLAP_SIM) out.add(i);
  });
  return out;
}

/** Bonus źródła: kanał tematyczny węzła X wzmacnia X i jego przodków (nie potomków — szachy ≠ debiuty). */
export function sourcePrior(feedUrl: string | null | undefined, interest: InterestVector): number {
  const feedNode = feedUrl ? DEDICATED_FEEDS[feedUrl] : undefined;
  if (!feedNode || !interest.nodeKey) return 0;
  return getNode(feedNode)?.path.includes(interest.nodeKey) ? SOURCE_PRIOR : 0;
}

/** Czy tekst zawiera dowód dla zainteresowania (lub zainteresowanie nie wymaga dowodu). */
export function hasEvidence(
  interest: InterestVector,
  text: string | undefined,
  feedUrl?: string | null,
  summaryTags?: readonly string[],
): boolean {
  const re = interest.nodeKey ? EVIDENCE[interest.nodeKey] : undefined;
  const independent = (re !== undefined && text !== undefined && re.test(text)) || sourcePrior(feedUrl, interest) > 0;
  if (summaryTags?.length) {
    // Tagi z AI-streszczenia (wybrane z taksonomii na podstawie pełnego tekstu):
    // - tag w poddrzewie zainteresowania potwierdza je,
    // - tag w innej gałęzi wyklucza je (piłka ≠ siatkówka), chyba że jest niezależny dowód
    //   (słowo-klucz, kanał tematyczny) — model bywa w tagach omylny,
    // - tag ogólniejszy od zainteresowania (np. „Samochody elektryczne” przy „Tesli”) nie rozstrzyga.
    if (!interest.nodeKey) return text !== undefined && mentionsLabel(interest.label, text);
    const nodeKey = interest.nodeKey;
    if (summaryTags.some((t) => getNode(t)?.path.includes(nodeKey))) return true;
    if (independent) return true;
    const interestPath = getNode(nodeKey)?.path ?? [];
    if (!summaryTags.some((t) => interestPath.includes(t))) return false;
  }
  if (!re || text === undefined) return true;
  return independent;
}

/** Własne zainteresowanie (spoza taksonomii): czy tekst wspomina jego nazwę (rdzeń słów ≥ 4 znaki). */
export function mentionsLabel(label: string, text: string): boolean {
  const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
  const t = norm(text);
  const stems = norm(label).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).map((w) => w.slice(0, Math.max(4, w.length - 2)));
  return stems.length > 0 && stems.every((s) => t.includes(s));
}

export interface Relevance {
  /** Margines najlepszego zainteresowania z dowodem; ≥ próg = dopasowane. */
  margin: number;
  /** Margines bez bramki dowodów; ≥ próg przy `margin` < progu = temat sąsiedni (odkrywanie). */
  looseMargin: number;
  /** Zainteresowanie najbliższe bez bramki dowodów (do wyjaśnienia pozycji „odkrywanie”). */
  looseInterestLabel: string | null;
  interestId: string | null;
  interestLabel: string | null;
  similarity: number;
  /** Najsilniejsza konkurencja: dział newsowy albo przodek zainteresowania (do wyjaśnień i diagnostyki). */
  rival: string;
  rivalSimilarity: number;
  prior: number;
}

/**
 * @param evidenceText tytuł + opis (+ początek tekstu); bez niego bramka dowodów jest wyłączona
 *   (np. wstępna ocena przed pobraniem strony).
 */
export function relevance(
  content: number[],
  interests: InterestVector[],
  desks: DeskVectors,
  feedUrl?: string | null,
  evidenceText?: string,
  summaryTags?: readonly string[],
): Relevance {
  const deskSims = desks.vectors.map((v) => cosine(content, v));
  let looseMargin = -Infinity;
  let looseInterestLabel: string | null = null;
  let best: Relevance = { margin: -Infinity, looseMargin: -Infinity, looseInterestLabel: null, interestId: null, interestLabel: null, similarity: 0, rival: '', rivalSimilarity: 0, prior: 0 };
  for (const interest of interests) {
    const skip = overlappingDesks(interest, desks);
    let rival = '';
    let rivalSim = -Infinity;
    deskSims.forEach((s, i) => {
      if (!skip.has(i) && s > rivalSim) {
        rivalSim = s;
        rival = NEWS_DESKS[i]!.text;
      }
    });
    interest.ancestors.forEach((a, i) => {
      const s = cosine(content, a);
      if (s > rivalSim) {
        rivalSim = s;
        rival = i === 0 ? 'rodzic zainteresowania' : 'przodek zainteresowania';
      }
    });
    const sim = cosine(content, interest.vector);
    const prior = sourcePrior(feedUrl, interest);
    const margin = sim + prior - (Number.isFinite(rivalSim) ? rivalSim : 0);
    if (margin > looseMargin) {
      looseMargin = margin;
      looseInterestLabel = interest.label;
    }
    if (!hasEvidence(interest, evidenceText, feedUrl, summaryTags)) continue;
    if (margin > best.margin) {
      best = { margin, looseMargin: 0, looseInterestLabel: null, interestId: interest.id, interestLabel: interest.label, similarity: sim, rival, rivalSimilarity: rivalSim, prior };
    }
  }
  return { ...best, looseMargin, looseInterestLabel };
}

/** Tekst treści do wektora: tytuł + opis (w kalibracji lepszy niż sam tytuł i niż z dodatkowymi fragmentami). */
export function contentText(title: string, description: string | null): string {
  const d = description?.trim();
  if (!d || d.toLowerCase().startsWith(title.toLowerCase().slice(0, 40))) return d && d.length > title.length ? d : title;
  return `${title}. ${d}`;
}
