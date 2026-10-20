/**
 * Trending w Polsce — newsy i wydarzenia, liczone osobno i wspólne dla wszystkich osób.
 *
 * Dowody zainteresowania zamiast liczb popularności: nie znamy liczby czytelników ani wyświetleń,
 * więc ich nie pokazujemy. Sygnały:
 * - kilka NIEZALEŻNYCH źródeł tej samej historii (grupy wydawnicze: przedruk w portalu tej samej grupy
 *   nie jest drugim potwierdzeniem),
 * - świeżość,
 * - dla wydarzeń: dane organizatora (JSON-LD/iCal), znany termin zapisów, obecność u kilku źródeł.
 * Pozycje z jednym źródłem oznaczamy „Na radarze” (słabe dowody).
 *
 * Grupowanie historii: e5, kalibracja 18.10.2026 na ~210 nagłówkach z 7 portali (36 h): pary ≥ 0,89
 * to ta sama historia; ~0,88 łączy już różne wypowiedzi tej samej osoby. Średnie podobieństwo
 * do klastra ≥ 0,89 i minimum ≥ 0,85 (bez łańcuchowania).
 */
import { sql } from 'kysely';
import { canonicalizeUrl, cosine, fetchFeed, sourceDomain, type EmbeddingProvider } from '@readyou/providers';
import { db, fromPgVector, type TrendingMember } from '../db.ts';
import { enqueue } from '../jobs/queue.ts';
import { engine } from './context.ts';
import { JOBS, saveEmbedding } from './discovery.ts';
import { contentText } from './relevance.ts';
import { scheduleSummary } from './summaries.ts';

export const TRENDING_JOB = 'ingest_trending';

/** Kanały ogólnopolskie (sprawdzone 18.10.2026) z grupą wydawniczą — niezależność źródeł liczymy po grupach. */
export const TRENDING_FEEDS: { url: string; name: string; group: string }[] = [
  { url: 'https://wiadomosci.wp.pl/rss.xml', name: 'WP', group: 'wp' },
  { url: 'https://www.money.pl/rss/', name: 'money.pl', group: 'wp' },
  { url: 'https://wiadomosci.onet.pl/.feed', name: 'Onet', group: 'ringier-axel-springer' },
  { url: 'https://www.rmf24.pl/fakty/feed', name: 'RMF24', group: 'bauer' },
  { url: 'https://tvn24.pl/najnowsze.xml', name: 'TVN24', group: 'tvn' },
  { url: 'https://www.polsatnews.pl/rss/wszystkie.xml', name: 'Polsat News', group: 'polsat' },
  { url: 'https://wydarzenia.interia.pl/feed', name: 'Interia', group: 'polsat' },
  { url: 'https://rss.gazeta.pl/pub/rss/wiadomosci.xml', name: 'Gazeta.pl', group: 'agora' },
  { url: 'https://www.bankier.pl/rss/wiadomosci.xml', name: 'Bankier.pl', group: 'bankier' },
];
const FEED_BY_URL = new Map(TRENDING_FEEDS.map((f) => [f.url, f]));

export const WINDOW_H = 36;
export const SAME_STORY_AVG = 0.89;
export const SAME_STORY_MIN = 0.85;
export const TOP = 20;
/** Ile pierwszych klastrów dostaje pobranie strony i streszczenie (koszt). */
export const SUMMARIZE_TOP = 10;

const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), level: 'info', msg, ...extra }));

export interface ClusterItem {
  id: string;
  vector: number[];
  group: string;
  publishedAt: Date | null;
}

/**
 * Zachłanne grupowanie: pozycja dołącza do klastra, gdy średnie podobieństwo ≥ 0,89 i minimalne ≥ 0,85
 * (średnia/minimum zamiast „najbliższego członka” — bez łańcuchów A~B~C przy różnych historiach A i C).
 */
export function clusterStories<T extends ClusterItem>(items: T[]): T[][] {
  const sorted = [...items].sort((a, b) => (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0));
  const clusters: T[][] = [];
  for (const it of sorted) {
    let best: { c: T[]; avg: number } | null = null;
    for (const c of clusters) {
      const sims = c.map((m) => cosine(m.vector, it.vector));
      const avg = sims.reduce((s, x) => s + x, 0) / sims.length;
      if (avg >= SAME_STORY_AVG && Math.min(...sims) >= SAME_STORY_MIN && (!best || avg > best.avg)) best = { c, avg };
    }
    if (best) best.c.push(it);
    else clusters.push([it]);
  }
  return clusters;
}

/** Powyżej tego podobieństwa dwa teksty to ten sam materiał (np. depesza agencyjna w kilku portalach). */
export const SAME_MATERIAL_SIM = 0.975;

/**
 * Liczba niezależnych źródeł: członkowie tej samej grupy wydawniczej ORAZ niemal identyczne teksty
 * (przedruk depeszy) łączą się w jedno źródło — przedruk nie jest drugim potwierdzeniem.
 */
export function independentSources(c: ClusterItem[]): number {
  const parent = c.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < c.length; i++) {
    for (let j = i + 1; j < c.length; j++) {
      if (c[i]!.group === c[j]!.group || cosine(c[i]!.vector, c[j]!.vector) >= SAME_MATERIAL_SIM) parent[find(i)] = find(j);
    }
  }
  return new Set(c.map((_, i) => find(i))).size;
}

/** Ocena klastra: niezależne źródła dominują; świeżość rozstrzyga przy równej liczbie źródeł. */
export function clusterScore(c: ClusterItem[], now = Date.now()) {
  const groups = independentSources(c);
  const latest = Math.max(...c.map((m) => m.publishedAt?.getTime() ?? 0));
  const freshness = latest ? Math.exp(-Math.max(0, now - latest) / (12 * 3_600_000)) : 0;
  return { groups, freshness, score: groups + 0.5 * freshness };
}

// ---------------------------------------------------------------- newsy

/** Pobiera kanały ogólnopolskie: nowe pozycje (tytuł i lead od wydawcy) + wektor. Bez pobierania stron. */
export async function ingestTrendingFeeds(provider: EmbeddingProvider) {
  let added = 0;
  for (const feed of TRENDING_FEEDS) {
    let items;
    try {
      items = await fetchFeed(engine().fetcher, feed.url);
    } catch (e) {
      log('Kanał Trending niedostępny', { feed: feed.url, error: (e as Error).message });
      continue;
    }
    const fresh = items.filter((i) => i.publishedAt && Date.now() - i.publishedAt.getTime() < WINDOW_H * 3_600_000);
    const withUrl = fresh.flatMap((i) => {
      try {
        return [{ ...i, canonical: canonicalizeUrl(i.url) }];
      } catch {
        return [];
      }
    });
    if (!withUrl.length) continue;
    const known = new Set(
      (await db.selectFrom('content_item').select('canonical_url').where('canonical_url', 'in', withUrl.map((i) => i.canonical)).execute()).map((r) => r.canonical_url),
    );
    const todo = withUrl.filter((i) => !known.has(i.canonical));
    const texts = todo.map((i) => contentText(i.title, i.summary));
    const vectors = todo.length ? await provider.embedPassages(texts) : [];
    for (const [n, i] of todo.entries()) {
      const row = await db
        .insertInto('content_item')
        .values({
          kind: 'news',
          canonical_url: i.canonical,
          url: i.url,
          source_domain: sourceDomain(i.canonical),
          source_name: feed.name,
          title: i.title.slice(0, 500),
          description: i.summary,
          language: 'pl',
          published_at: i.publishedAt,
          image_url: i.imageUrl,
          discovered_via: 'feed',
          feed_url: feed.url,
          status: 'discovered',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict((oc) => oc.column('canonical_url').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!row) continue;
      await saveEmbedding(row.id, provider, texts[n]!, vectors[n]!);
      added++;
    }
  }
  return added;
}

export async function buildNewsSnapshot(provider: EmbeddingProvider, now = new Date()) {
  const since = new Date(now.getTime() - WINDOW_H * 3_600_000);
  const rows = await db
    .selectFrom('content_item as c')
    .innerJoin('content_embedding as e', 'e.content_id', 'c.id')
    .select(['c.id', 'c.url', 'c.source_name', 'c.feed_url', 'c.published_at', 'c.status', sql<string>`e.embedding::text`.as('v')])
    .where('c.feed_url', 'in', TRENDING_FEEDS.map((f) => f.url))
    .where('c.published_at', '>=', since)
    .where('e.model', '=', provider.model)
    .execute();
  const items = rows.map((r) => ({ ...r, vector: fromPgVector(r.v), group: FEED_BY_URL.get(r.feed_url!)!.group, publishedAt: r.published_at }));
  const clusters = clusterStories(items)
    .map((c) => ({ members: c, ...clusterScore(c, now.getTime()) }))
    .sort((a, b) => b.score - a.score);
  // Najpierw historie z kilku niezależnych źródeł; „Na radarze” (jedno źródło) tylko do uzupełnienia, najświeższe.
  const multi = clusters.filter((c) => c.groups >= 2);
  const radar = clusters.filter((c) => c.groups < 2).slice(0, Math.max(0, Math.min(5, TOP - multi.length)));
  const top = [...multi.slice(0, TOP), ...radar].slice(0, TOP);

  const summaries = new Set(
    (await db.selectFrom('summary').select('content_id').where('sufficient', '=', true).where('content_id', 'in', items.length ? items.map((i) => i.id) : ['00000000-0000-0000-0000-000000000000']).execute()).map((s) => s.content_id),
  );
  const snapshot = await db.transaction().execute(async (trx) => {
    const s = await trx
      .insertInto('trending_snapshot')
      .values({ kind: 'news', method: `rss:${TRENDING_FEEDS.length} kanałów, klastry e5 (śr. ≥ ${SAME_STORY_AVG}), niezależne grupy wydawnicze`, items_considered: items.length, created_at: now })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const [rank, c] of top.entries()) {
      // Przedstawiciel: pozycja ze streszczeniem, potem z pobraną stroną, potem najwcześniejsza.
      const rep =
        c.members.find((m) => summaries.has(m.id)) ?? c.members.find((m) => m.status === 'extracted' || m.status === 'partial') ?? c.members[0]!;
      const members: TrendingMember[] = c.members.map((m) => ({ contentId: m.id, url: m.url, source: m.source_name ?? sourceDomain(m.url), group: m.group, publishedAt: m.published_at?.toISOString() ?? null }));
      await trx
        .insertInto('trending_item')
        .values({
          snapshot_id: s.id,
          rank: rank + 1,
          content_id: rep.id,
          label: c.groups >= 2 ? 'multi' : 'radar',
          independent_sources: c.groups,
          members: JSON.stringify(members),
          signals: JSON.stringify({ groups: c.groups, freshness: Number(c.freshness.toFixed(3)), articles: c.members.length }),
        })
        .execute();
    }
    return s.id;
  });
  // Streszczenia dla czołówki: pobranie strony (z robots.txt) albo — gdy już pobrana — streszczenie.
  for (const c of top.slice(0, SUMMARIZE_TOP)) {
    if (c.members.some((m) => summaries.has(m.id))) continue;
    const ready = c.members.find((m) => m.status === 'extracted' || m.status === 'partial');
    if (ready) await scheduleSummary(ready.id);
    else for (const m of c.members.filter((m) => m.status === 'discovered').slice(0, 2)) await enqueue(JOBS.extractContent, { contentId: m.id }, { dedupeKey: `${JOBS.extractContent}:${m.id}` });
  }
  return { snapshot, considered: items.length, clusters: clusters.length, multi: multi.length, shown: top.length };
}

// ---------------------------------------------------------------- wydarzenia

const normTitle = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Wydarzenia na najbliższe 14 dni ze wszystkich miast z katalogu. Ranking dowodów: liczba różnych stron
 * (organizator + inne źródła, ten sam tytuł i dzień), dane strukturalne organizatora, znany termin zapisów.
 * Ogólnopolski temat medialny nie staje się wydarzeniem — to osobna lista z osobną logiką.
 */
export async function buildEventsSnapshot(now = new Date()) {
  const until = new Date(now.getTime() + 14 * 86_400_000);
  const rows = await db
    .selectFrom('content_item as c')
    .innerJoin('event_details as e', 'e.content_id', 'c.id')
    .select(['c.id', 'c.title', 'c.url', 'c.source_domain', 'e.starts_at', 'e.ends_at', 'e.method', 'e.registration_ends_at', 'e.timezone', 'e.city', 'e.source_page'])
    .where('c.kind', '=', 'event')
    .where('e.starts_at', '>=', now)
    .where('e.starts_at', '<', until)
    .where((eb) => eb.or([eb('e.status', 'is', null), eb('e.status', 'not like', '%Cancelled%')]))
    .execute();
  // Grupa = ten sam tytuł (także cykl sesji — pokazujemy go raz, z najbliższą sesją jako przedstawicielem).
  const byKey = new Map<string, typeof rows>();
  for (const r of [...rows].sort((a, b) => a.starts_at!.getTime() - b.starts_at!.getTime())) {
    const key = normTitle(r.title).slice(0, 40);
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  const scored = [...byKey.values()].map((g) => {
    const sources = new Set(g.map((r) => r.source_domain)).size;
    const structured = g.some((r) => r.method === 'json-ld' || r.method === 'ical') ? 1 : 0;
    const registration = g.some((r) => r.registration_ends_at) ? 1 : 0;
    const days = (g[0]!.starts_at!.getTime() - now.getTime()) / 86_400_000;
    const soon = Math.exp(-days / 5);
    return { g, sources, signals: { sources, structured, registration, soon: Number(soon.toFixed(3)) }, score: sources * 2 + structured + registration * 0.5 + soon };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, TOP);
  const id = await db.transaction().execute(async (trx) => {
    const s = await trx
      .insertInto('trending_snapshot')
      .values({ kind: 'events', method: 'katalog wydarzeń (strony organizatorów, 14 dni), te same tytuł i dzień u kilku źródeł', items_considered: rows.length, created_at: now })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const [rank, t] of top.entries()) {
      const rep = t.g[0]!; // najbliższa sesja
      await trx
        .insertInto('trending_item')
        .values({
          snapshot_id: s.id,
          rank: rank + 1,
          content_id: rep.id,
          label: t.sources >= 2 ? 'multi' : 'radar',
          independent_sources: t.sources,
          members: JSON.stringify(t.g.map((r) => ({ contentId: r.id, url: r.url, source: r.source_domain, group: r.source_domain, publishedAt: null }))),
          signals: JSON.stringify(t.signals),
        })
        .execute();
    }
    return s.id;
  });
  return { snapshot: id, considered: rows.length, shown: top.length };
}

/** Pełny przebieg: kanały, migawka newsów i wydarzeń, sprzątanie starych migawek (zostaje 48 h). */
export async function runTrending(provider: EmbeddingProvider) {
  const added = await ingestTrendingFeeds(provider);
  const news = await buildNewsSnapshot(provider);
  const events = await buildEventsSnapshot();
  await db.deleteFrom('trending_snapshot').where('created_at', '<', new Date(Date.now() - 48 * 3_600_000)).execute();
  return { added, news, events };
}

/** Co godzinę (deduplikacja per godzina UTC). */
export async function scheduleTrending() {
  const hour = new Date().toISOString().slice(0, 13);
  await enqueue(TRENDING_JOB, {}, { dedupeKey: `${TRENDING_JOB}:${hour}`, oncePerKey: { retryFailedAfterMs: 20 * 60_000 } });
}
