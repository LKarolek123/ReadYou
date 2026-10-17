/**
 * Dzienna pula artykułów: do 20 nowych, różnych pozycji na użytkownika i jego lokalny dzień.
 *
 * - Limit egzekwuje baza: unikalny slot 1..20 na (użytkownik, dzień) + blokada doradcza w transakcji,
 *   więc równoległe odświeżenia, karty przeglądarki i workery go nie przekroczą.
 * - Ta sama treść nie trafia do puli dwa razy (unikalna para użytkownik–treść ponad dniami).
 * - Przeczytanie ani pominięcie nie zwalnia miejsca; odświeżenie uzupełnia tylko niewykorzystane sloty.
 * - Brak wystarczająco trafnych treści = mniejsza pula. Nie dopełniamy słabymi pozycjami.
 *
 * Ocena (heurystyka startowa ze specyfikacji, nie zweryfikowane naukowo wagi):
 *   0,45 zainteresowanie + 0,20 tag + 0,15 świeżość + 0,10 jakość źródła + 0,10 nowość/różnorodność.
 */
import { sql } from 'kysely';
import { DateTime } from 'luxon';
import { cosine, type EmbeddingProvider } from '@readyou/providers';
import { getNode } from '@readyou/shared';
import { db } from '../db.ts';
import { env } from '../env.ts';
import { scheduleSummary } from './summaries.ts';
import { scoreForUser, type ScoredContent } from './personal.ts';
import { mentionsLabel } from './relevance.ts';
import { EVIDENCE } from './sources.ts';

export const POOL_LIMIT = 20;
export const BUILD_POOL_JOB = 'build_pool';
/** Cel eksploracji: ok. 20% puli z tematów sąsiednich (przy pełnej puli 4 z 20). */
export const EXPLORE_SHARE = 0.2;
/**
 * Najwięcej pozycji z jednego zainteresowania — żeby 20 kart nie było o Tesli. Zależy od liczby
 * zainteresowań z kandydatami: ok. 1,5 × równy podział, nie mniej niż 3 (przy 9 zainteresowaniach: 4).
 */
export function perInterestCap(slots: number, interestsWithCandidates: number) {
  return Math.max(3, Math.ceil((1.5 * slots) / Math.max(1, interestsWithCandidates)));
}
/** Minimalna jakość pozycji odkrywania: cel 20% nie jest powodem do publikowania słabych treści. */
export const EXPLORE_MIN_MARGIN = 0.015;
export const EXPLORE_MIN_BASE = 0.45;
/** Powyżej tego podobieństwa dwie treści uznajemy za tę samą historię. */
export const SAME_STORY_SIM = 0.93;
/** Minimalny odstęp między uzupełnieniami puli. */
export const REFRESH_INTERVAL_MS = 15 * 60_000;

const WEIGHTS = { interest: 0.45, tag: 0.2, freshness: 0.15, quality: 0.1, novelty: 0.1 };

export function localDay(timezone: string, now = new Date()): string {
  return DateTime.fromJSDate(now).setZone(timezone).toISODate()!;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface Candidate {
  item: ScoredContent;
  kind: 'matched' | 'explore';
  vector: number[];
  base: number;
  parts: Record<string, number>;
  interestKey: string;
  /** Dla eksploracji: ogólniejsza kategoria, do której temat jest zbliżony (bez twierdzenia o liściu). */
  exploreLabel?: string | null;
  /** Węzeł taksonomii zainteresowania (do ilustracji kategorii). */
  nodeKey?: string | null;
  /** Waga zainteresowania (< 1 dla świeżo wyuczonych) — ogranicza liczbę jego pozycji w puli. */
  interestWeight?: number;
  /** Zainteresowanie wyuczone z polubień (do wyjaśnienia „Dlaczego dla Ciebie”). */
  learned?: boolean;
}

/** Limit pozycji dla zainteresowania: świeżo wyuczone (waga < 1) dostaje proporcjonalnie mniej, co najmniej 1. */
export function capFor(c: Pick<Candidate, 'interestWeight'>, cap: number) {
  const w = c.interestWeight ?? 1;
  return w >= 1 ? cap : Math.max(1, Math.floor(cap * w));
}

/** Składniki oceny bez nowości (ta zależy od już wybranych). */
export function baseScore(
  c: { item: ScoredContent; kind: 'matched' | 'explore'; depth: number; weight: number; wordCount: number | null; status: string; summaryTags: string[]; nodeKey: string | null },
  now = Date.now(),
) {
  const r = c.item.relevance;
  const margin = c.kind === 'matched' ? r.margin : r.looseMargin;
  const interest = clamp01(margin / 0.06) * (c.kind === 'explore' ? 0.7 : 1);
  const specificity = c.depth >= 2 ? 1 : c.depth === 1 ? 0.8 : 0.6;
  const tagged = c.nodeKey && c.summaryTags.some((t) => t === c.nodeKey || getNode(t)?.path.includes(c.nodeKey!)) ? 1 : 0;
  const tag = c.kind === 'explore' ? 0 : clamp01(Math.max(specificity * Math.min(1, c.weight), tagged));
  const ageH = c.item.publishedAt ? (now - c.item.publishedAt.getTime()) / 3_600_000 : null;
  const freshness = ageH === null ? 0.4 : Math.exp(-Math.max(0, ageH) / 36);
  const quality = (c.status === 'extracted' ? 1 : 0.5) * ((c.wordCount ?? 0) >= 250 ? 1 : 0.8);
  const parts = { interest, tag, freshness, quality };
  const base = WEIGHTS.interest * interest + WEIGHTS.tag * tag + WEIGHTS.freshness * freshness + WEIGHTS.quality * quality;
  return { base, parts };
}

/**
 * Dobór różnorodny (zachłanny, w stylu MMR): w każdym kroku pozycja o najwyższej ocenie z nowością,
 * z pominięciem tej samej historii i z limitem na zainteresowanie. Najpierw dopasowane, potem eksploracja,
 * a niewykorzystany udział jednej grupy może przejąć druga.
 */
export function selectDiverse(candidates: Candidate[], slots: number, alreadyPicked: number[][] = []): Candidate[] {
  const picked: Candidate[] = [];
  const vectors = [...alreadyPicked];
  const cap = perInterestCap(slots, new Set(candidates.filter((c) => c.kind === 'matched').map((c) => c.interestKey)).size);
  const perInterest = new Map<string, number>();
  const exploreTarget = Math.round(slots * EXPLORE_SHARE);
  const pool = [...candidates];

  const pickFrom = (kind: 'matched' | 'explore' | 'any', limit: number) => {
    while (picked.length < slots && limit > 0) {
      let best: { c: Candidate; total: number; idx: number } | null = null;
      for (let i = 0; i < pool.length; i++) {
        const c = pool[i]!;
        if (kind !== 'any' && c.kind !== kind) continue;
        if ((perInterest.get(c.interestKey) ?? 0) >= capFor(c, cap)) continue;
        const maxSim = vectors.length ? Math.max(...vectors.map((v) => cosine(v, c.vector))) : 0;
        if (maxSim >= SAME_STORY_SIM) continue;
        const novelty = clamp01((SAME_STORY_SIM - maxSim) / 0.15);
        const total = c.base + WEIGHTS.novelty * novelty;
        if (!best || total > best.total) best = { c, total, idx: i };
      }
      if (!best) return;
      pool.splice(best.idx, 1);
      best.c.parts.novelty = best.total - best.c.base;
      best.c.base = best.total;
      picked.push(best.c);
      vectors.push(best.c.vector);
      perInterest.set(best.c.interestKey, (perInterest.get(best.c.interestKey) ?? 0) + 1);
      limit--;
    }
  };
  pickFrom('matched', slots - exploreTarget);
  pickFrom('explore', exploreTarget);
  pickFrom('any', slots); // uzupełnienie, jeśli którejś grupy zabrakło
  return picked;
}

export interface PoolResult {
  day: string;
  added: number;
  total: number;
  reason?: string;
}

/** Uzupełnia dzisiejszą pulę do limitu (tylko wolne sloty). Idempotentne i bezpieczne współbieżnie. */
export async function fillDailyPool(userId: string, provider: EmbeddingProvider, opts: { force?: boolean } = {}): Promise<PoolResult> {
  const profile = await db.selectFrom('user_profile').select(['timezone', 'profile_version']).where('user_id', '=', userId).executeTakeFirst();
  if (!profile) return { day: '', added: 0, total: 0, reason: 'brak profilu' };
  const day = localDay(profile.timezone);

  const existing = await db
    .selectFrom('daily_assignment')
    .select([(eb) => eb.fn.countAll<number>().as('n'), (eb) => eb.fn.max('created_at').as('last')])
    .where('user_id', '=', userId)
    .where('local_day', '=', day)
    .executeTakeFirstOrThrow();
  const have = Number(existing.n);
  if (have >= POOL_LIMIT) return { day, added: 0, total: have, reason: 'pula pełna' };
  const last = existing.last as Date | null;
  if (!opts.force && last && Date.now() - new Date(last).getTime() < REFRESH_INTERVAL_MS) {
    return { day, added: 0, total: have, reason: 'zbyt częste odświeżanie' };
  }

  const candidates = await buildCandidates(userId, provider);
  const todayVectors = await assignedVectors(userId, day, provider.model);
  const chosen = selectDiverse(candidates, POOL_LIMIT - have, todayVectors);
  if (!chosen.length) return { day, added: 0, total: have, reason: 'brak wystarczająco trafnych treści' };

  const added = await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`pool:${userId}:${day}`}))`.execute(trx);
    const taken = await trx
      .selectFrom('daily_assignment')
      .select(['slot', 'content_id'])
      .where('user_id', '=', userId)
      .where((eb) => eb.or([eb('local_day', '=', day), eb('content_id', 'in', chosen.map((c) => c.item.id))]))
      .execute();
    const usedSlots = new Set(taken.map((t) => t.slot));
    const assignedIds = new Set(taken.map((t) => t.content_id));
    const free = Array.from({ length: POOL_LIMIT }, (_, i) => i + 1).filter((s) => !usedSlots.has(s));
    let n = 0;
    for (const c of chosen) {
      if (assignedIds.has(c.item.id)) continue;
      const slot = free.shift();
      if (slot === undefined) break;
      await trx
        .insertInto('daily_assignment')
        .values({
          user_id: userId,
          local_day: day,
          slot,
          content_id: c.item.id,
          kind: c.kind,
          score: c.base,
          reason: JSON.stringify({
            interest: c.kind === 'matched' ? c.item.relevance.interestLabel : c.exploreLabel ?? null,
            learned: c.learned ?? false,
            nodeKey: c.nodeKey ?? null,
            margin: Number((c.kind === 'matched' ? c.item.relevance.margin : c.item.relevance.looseMargin).toFixed(4)),
            parts: Object.fromEntries(Object.entries(c.parts).map(([k, v]) => [k, Number(v.toFixed(3))])),
          }),
          profile_version: profile.profile_version,
          created_at: new Date(),
        })
        .execute();
      n++;
    }
    return n;
  });
  // Streszczenia przed publikacją kart (wspólne, z cache — każda treść streszczana raz).
  for (const c of chosen) await scheduleSummary(c.item.id);
  return { day, added, total: have + added };
}

async function assignedVectors(userId: string, day: string, model: string): Promise<number[][]> {
  const rows = await db
    .selectFrom('daily_assignment as a')
    .innerJoin('content_embedding as e', 'e.content_id', 'a.content_id')
    .select(sql<string>`e.embedding::text`.as('v'))
    .where('a.user_id', '=', userId)
    .where('a.local_day', '=', day)
    .where('e.model', '=', model)
    .execute();
  return rows.map((r) => JSON.parse(r.v) as number[]);
}

/**
 * Twardy filtr wykluczeń: tag streszczenia w poddrzewie wykluczonego węzła, dowód słowny węzła
 * w tytule albo nazwa wykluczonego tematu spoza taksonomii w tytule.
 */
export function exclusionFilter(excluded: { node_key: string | null; label: string }[]) {
  return (title: string, tags: readonly string[]) =>
    excluded.some((e) => {
      if (e.node_key && getNode(e.node_key)) {
        if (tags.some((t) => getNode(t)?.path.includes(e.node_key!))) return true;
        const re = EVIDENCE[e.node_key];
        return re ? re.test(title) : false;
      }
      return mentionsLabel(e.label, title);
    });
}

/** Kandydaci: dopasowani (z dowodem) i sąsiedni (eksploracja), bez już przydzielonych, przeczytanych i pominiętych. */
export async function buildCandidates(userId: string, provider: EmbeddingProvider): Promise<Candidate[]> {
  const { interests, items } = await scoreForUser(userId, provider);
  const threshold = env.RELEVANCE_THRESHOLD;
  const relevant = items.filter((i) => i.status !== 'discovered' && (i.relevance.margin >= threshold || i.relevance.looseMargin >= threshold));
  if (!relevant.length) return [];
  const ids = relevant.map((i) => i.id);

  const [excluded, meta, vectors, summaries, userInterests] = await Promise.all([
    db
      .selectFrom('daily_assignment')
      .select('content_id')
      .where('user_id', '=', userId)
      .union(
        db
          .selectFrom('user_content_state')
          .select('content_id')
          .where('user_id', '=', userId)
          .where((eb) => eb.or([eb('read_at', 'is not', null), eb('skipped_at', 'is not', null)])),
      )
      .execute(),
    db.selectFrom('content_item').select(['id', 'word_count', 'status']).where('id', 'in', ids).execute(),
    db.selectFrom('content_embedding').select(['content_id', sql<string>`embedding::text`.as('v')]).where('content_id', 'in', ids).where('model', '=', provider.model).execute(),
    db.selectFrom('summary').select(['content_id', 'sufficient', 'tags', 'created_at']).where('content_id', 'in', ids).orderBy('created_at', 'desc').execute(),
    db.selectFrom('user_interest').select(['id', 'path', 'weight', 'node_key', 'state', 'label']).where('user_id', '=', userId).execute(),
  ]);
  const skip = new Set(excluded.map((e) => e.content_id));
  const metaBy = new Map(meta.map((m) => [m.id, m]));
  const vecBy = new Map(vectors.map((v) => [v.content_id, JSON.parse(v.v) as number[]]));
  const sumBy = new Map<string, { sufficient: boolean; tags: string[] }>();
  for (const s of summaries) if (!sumBy.has(s.content_id)) sumBy.set(s.content_id, s);
  const interestBy = new Map(userInterests.map((i) => [i.id, i]));
  const excludedTopic = exclusionFilter(userInterests.filter((i) => i.state === 'excluded'));
  void interests;

  const now = Date.now();
  const out: Candidate[] = [];
  for (const item of relevant) {
    if (skip.has(item.id)) continue;
    const s = sumBy.get(item.id);
    if (s && !s.sufficient) continue; // za słaby materiał na streszczenie — nie pokazujemy
    if (excludedTopic(item.title, s?.tags ?? [])) continue; // wykluczony temat ma pierwszeństwo
    const vector = vecBy.get(item.id);
    const m = metaBy.get(item.id);
    if (!vector || !m) continue;
    const kind: 'matched' | 'explore' = item.relevance.margin >= threshold ? 'matched' : 'explore';
    if (kind === 'explore' && item.relevance.looseMargin < EXPLORE_MIN_MARGIN) continue;
    const ui = item.relevance.interestId ? interestBy.get(item.relevance.interestId) : undefined;
    const looseUi = userInterests.find((i) => i.path.at(-1) === item.relevance.looseInterestLabel);
    const exploreLabel = looseUi?.path[0] ?? null;
    const { base, parts } = baseScore(
      {
        item,
        kind,
        depth: ui ? ui.path.length - 1 : 0,
        weight: ui?.weight ?? 1,
        wordCount: m.word_count,
        status: m.status,
        summaryTags: s?.tags ?? [],
        nodeKey: ui?.node_key ?? null,
      },
      now,
    );
    if (kind === 'explore' && base < EXPLORE_MIN_BASE) continue;
    out.push({
      item,
      kind,
      vector,
      base,
      parts,
      interestKey: kind === 'matched' ? (item.relevance.interestId ?? '?') : 'explore',
      exploreLabel,
      nodeKey: (kind === 'matched' ? ui : looseUi)?.node_key ?? null,
      interestWeight: kind === 'matched' ? (ui?.weight ?? 1) : 1,
      learned: kind === 'matched' && ui?.state === 'learned',
    });
  }
  return out;
}
