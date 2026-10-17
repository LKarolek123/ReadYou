/**
 * Odkrywanie treści — wspólne dla wszystkich użytkowników, według tematów (nie według osób).
 *
 * 1. `syncTopics`: tematy = ścieżki aktywnych zainteresowań (jawnych i wyuczonych) osób po onboardingu.
 * 2. `ingestFeed`: kanał RSS → nowe pozycje (tytuł/opis od wydawcy) → wektor → trafność względem tematów
 *    → trafne do pobrania strony, nietrafne zapamiętane jako `irrelevant` (bez ponownej oceny).
 * 3. `searchTopic`: zapytania Brave dla tematu (w ramach limitu) → wyniki TYLKO w pamięci → wstępna
 *    trafność z tytułu i opisu wyszukiwarki → pobranie najlepszych stron → zapis metadanych ZE STRONY.
 * 4. `extractContent`: pobranie strony pozycji z kanału (robots.txt, SSRF, limity) i zapis tekstu
 *    z terminem usunięcia.
 *
 * Profil użytkownika nie trafia do zapytań: wyszukujemy tematy, a ranking per osoba liczony jest osobno.
 */
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import {
  canonicalizeUrl,
  fetchFeed,
  FetchRejectedError,
  ProviderNotConfiguredError,
  sourceDomain,
  type EmbeddingProvider,
  type ExtractedArticle,
  type SearchHit,
} from '@readyou/providers';
import { normalizeTag } from '@readyou/shared';
import { db, fromPgVector, toPgVector } from '../db.ts';
import { env } from '../env.ts';
import { enqueue } from '../jobs/queue.ts';
import { interestText } from '../services/embeddings.ts';
import { engine } from './context.ts';
import { ancestorVectors, contentText, deskVectors, relevance, type InterestVector } from './relevance.ts';
import { feedsFor, queriesFor } from './sources.ts';
import { reserveCall } from './usage.ts';

export const JOBS = {
  ingestFeed: 'ingest_feed',
  searchTopic: 'search_topic',
  extractContent: 'extract_content',
} as const;

const DAY_MS = 86_400_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), level: 'info', msg, ...extra }));

export function topicKey(label: string, path: readonly string[]) {
  return normalizeTag(interestText(label, path));
}

type TopicRow = { key: string; label: string; path: string[]; node_key: string | null; embedding: string | null };

/** Klucze aktywnych tematów: jawne i wyuczone zainteresowania osób po onboardingu. */
export async function activeTopics() {
  const interests = await db
    .selectFrom('user_interest as ui')
    .innerJoin('user_profile as up', 'up.user_id', 'ui.user_id')
    .select(['ui.label', 'ui.path', 'ui.node_key'])
    .where('ui.state', 'in', ['explicit', 'learned'])
    .where('up.onboarding_completed_at', 'is not', null)
    .execute();
  const byKey = new Map<string, { label: string; path: string[]; node_key: string | null }>();
  for (const i of interests) byKey.set(topicKey(i.label, i.path), i);
  return byKey;
}

/** Uzupełnia tabelę tematów o aktywne zainteresowania i liczy brakujące wektory tematów. */
export async function syncTopics(provider: EmbeddingProvider) {
  const byKey = await activeTopics();
  for (const [key, t] of byKey) {
    await db
      .insertInto('topic')
      .values({ key, label: t.label, path: t.path, node_key: t.node_key, created_at: new Date() })
      .onConflict((oc) => oc.column('key').doNothing())
      .execute();
  }
  const missing = await db
    .selectFrom('topic')
    .select(['key', 'label', 'path'])
    .where((eb) => eb.or([eb('embedding', 'is', null), eb('model', '!=', provider.model)]))
    .execute();
  for (const t of missing) {
    const v = await provider.embedQuery(interestText(t.label, t.path));
    await sql`update topic set model = ${provider.model}, embedding = ${toPgVector(v)}::vector where key = ${t.key}`.execute(db);
  }
  return [...byKey.keys()];
}

type LoadedTopic = TopicRow & { vector: number[]; ancestors: number[][] };

async function loadTopics(provider: EmbeddingProvider, keys?: string[]): Promise<LoadedTopic[]> {
  // Tylko wektory tego samego modelu — nigdy nie porównujemy niekompatybilnych wektorów.
  let q = db
    .selectFrom('topic')
    .select(['key', 'label', 'path', 'node_key', sql<string>`embedding::text`.as('embedding')])
    .where('embedding', 'is not', null)
    .where('model', '=', provider.model);
  if (keys) {
    if (!keys.length) return [];
    q = q.where('key', 'in', keys);
  }
  const rows = await q.execute();
  const out: LoadedTopic[] = [];
  for (const r of rows) out.push({ ...r, vector: fromPgVector(r.embedding!), ancestors: await ancestorVectors(r.path, provider) });
  return out;
}

const asInterest = (t: LoadedTopic): InterestVector => ({ id: t.key, label: t.label, nodeKey: t.node_key, vector: t.vector, ancestors: t.ancestors });

function tooOld(d: Date | null) {
  return d !== null && Date.now() - d.getTime() > env.CONTENT_MAX_AGE_DAYS * DAY_MS;
}

async function existingUrls(urls: string[]): Promise<Set<string>> {
  if (!urls.length) return new Set();
  const rows = await db.selectFrom('content_item').select('canonical_url').where('canonical_url', 'in', urls).execute();
  return new Set(rows.map((r) => r.canonical_url));
}

async function saveEmbedding(contentId: string, provider: EmbeddingProvider, text: string, vector: number[]) {
  await sql`
    insert into content_embedding (content_id, model, dim, source_hash, embedding)
    values (${contentId}, ${provider.model}, ${provider.dim}, ${sha(`${provider.model}\n${text}`)}, ${toPgVector(vector)}::vector)
    on conflict (content_id) do update set model = excluded.model, dim = excluded.dim,
      source_hash = excluded.source_hash, embedding = excluded.embedding, created_at = now()`.execute(db);
}

async function linkTopics(contentId: string, via: 'feed' | 'search', links: { key: string; margin: number }[]) {
  for (const l of links) {
    await db
      .insertInto('content_topic')
      .values({ content_id: contentId, topic_key: l.key, via, relevance: l.margin, discovered_at: new Date() })
      .onConflict((oc) => oc.columns(['content_id', 'topic_key']).doUpdateSet({ relevance: l.margin }))
      .execute();
  }
}

/** Marginesy treści względem każdego tematu z listy (do powiązań content_topic). */
async function topicMargins(vector: number[], topics: LoadedTopic[], provider: EmbeddingProvider, feedUrl: string | null) {
  const desks = await deskVectors(provider);
  return topics
    // Katalog przyjmuje treść bliską tematowi bez bramki dowodów (pełny tekst może jeszcze nie być
    // pobrany). Bramka dowodów działa w rankingu per osoba.
    .map((t) => ({ key: t.key, margin: relevance(vector, [asInterest(t)], desks, feedUrl).looseMargin }))
    .sort((a, b) => b.margin - a.margin);
}

// ---------------------------------------------------------------- kanały RSS

export async function ingestFeed(feedUrl: string, provider: EmbeddingProvider) {
  const topics = await loadTopics(provider, await syncTopics(provider));
  // Kanał pobieramy, gdy obsługuje choć jeden aktywny temat, ale trafność oceniamy względem WSZYSTKICH
  // tematów (artykuł o grze z portalu technologicznego pasuje do „Gier”).
  const served = topics.filter((t) => feedsFor(t.node_key).includes(feedUrl));
  if (!served.length) return { skipped: 'kanał nie obsługuje żadnego aktywnego tematu' };

  const items = await fetchFeed(engine().fetcher, feedUrl);
  const fresh = items
    .map((i) => ({ ...i, canonical: safeCanonical(i.url) }))
    .filter((i): i is typeof i & { canonical: string } => i.canonical !== null && !tooOld(i.publishedAt));
  const known = await existingUrls(fresh.map((i) => i.canonical));
  const todo = fresh.filter((i) => !known.has(i.canonical));

  const texts = todo.map((i) => contentText(i.title, i.summary));
  const vectors = await provider.embedPassages(texts);
  const toExtract: { id: string; margin: number }[] = [];
  let relevant = 0;
  for (const [n, item] of todo.entries()) {
    const margins = await topicMargins(vectors[n]!, topics, provider, feedUrl);
    const best = margins[0]!;
    const ok = best.margin >= env.RELEVANCE_THRESHOLD;
    const row = await db
      .insertInto('content_item')
      .values({
        canonical_url: item.canonical,
        url: item.url,
        source_domain: sourceDomain(item.canonical),
        title: item.title.slice(0, 500),
        description: item.summary,
        published_at: item.publishedAt,
        image_url: item.imageUrl,
        discovered_via: 'feed',
        feed_url: feedUrl,
        status: ok ? 'discovered' : 'irrelevant',
        status_note: ok ? null : `margines ${best.margin.toFixed(3)} < próg`,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict((oc) => oc.column('canonical_url').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!row) continue; // równoległy przebieg już ją dodał
    await saveEmbedding(row.id, provider, texts[n]!, vectors[n]!);
    if (ok) {
      relevant++;
      await linkTopics(row.id, 'feed', margins.filter((m) => m.margin >= env.RELEVANCE_THRESHOLD));
      toExtract.push({ id: row.id, margin: best.margin });
    }
  }
  for (const c of toExtract.sort((a, b) => b.margin - a.margin)) {
    await enqueue(JOBS.extractContent, { contentId: c.id }, { dedupeKey: `${JOBS.extractContent}:${c.id}` });
  }
  await db.updateTable('topic').set({ last_feeds_at: new Date() }).where('key', 'in', served.map((t) => t.key)).execute();
  return { feed: feedUrl, items: items.length, new: todo.length, relevant, irrelevant: todo.length - relevant };
}

function safeCanonical(url: string) {
  try {
    return canonicalizeUrl(url);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- wyszukiwarka

export async function searchTopic(key: string, provider: EmbeddingProvider) {
  const [topic] = await loadTopics(provider, [key]);
  if (!topic) return { skipped: 'temat nieznany lub bez wektora' };
  const queries = queriesFor(topic);
  if (!queries.length) return { skipped: 'temat bez zapytań (pokrywają go kanały)' };
  const { search, extractor } = engine();

  // Wyniki wyszukiwarki żyją tylko w tej funkcji (regulamin Brave): po zakończeniu nic z nich nie zostaje.
  const hits = new Map<string, SearchHit>();
  let calls = 0;
  let budgetExhausted = false;
  for (const q of queries) {
    if (!(await reserveCall(search.name, { daily: env.BRAVE_DAILY_QUERY_LIMIT, monthly: env.BRAVE_MONTHLY_QUERY_LIMIT }))) {
      budgetExhausted = true;
      break;
    }
    calls++;
    try {
      for (const h of await search.searchNews({ ...q, freshness: 'pw', count: 20 })) {
        const c = safeCanonical(h.url);
        if (c && !hits.has(c) && !tooOld(h.publishedAt)) hits.set(c, h);
      }
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) return { skipped: e.message };
      throw e;
    }
  }
  const known = await existingUrls([...hits.keys()]);
  const candidates = [...hits.entries()].filter(([c]) => !known.has(c));

  // Wstępna ocena z tytułu i opisu wyszukiwarki — tylko do wyboru stron do pobrania.
  const desks = await deskVectors(provider);
  const preVectors = await provider.embedPassages(candidates.map(([, h]) => contentText(stripTags(h.title), stripTags(h.snippet))));
  const ranked = candidates
    .map(([c, h], i) => ({ canonical: c, url: h.url, pre: relevance(preVectors[i]!, [asInterest(topic)], desks).looseMargin }))
    .filter((x) => x.pre >= env.RELEVANCE_THRESHOLD)
    .sort((a, b) => b.pre - a.pre)
    .slice(0, env.EXTRACT_PER_RUN);
  hits.clear();

  const others = await loadTopics(provider, [...(await activeTopics()).keys()]);
  const scoringTopics = others.some((t) => t.key === key) ? others : [...others, topic];
  const stats = { calls, budgetExhausted, hits: candidates.length, preRelevant: ranked.length, saved: 0, irrelevant: 0, rejected: 0 };
  for (const cand of ranked) {
    let page: ExtractedArticle;
    try {
      page = await extractor.extract(cand.url);
    } catch (e) {
      stats.rejected++;
      log('Pominięto stronę', { url: cand.url, reason: e instanceof FetchRejectedError ? e.reason : (e as Error).message });
      continue;
    }
    const verdict = await storeExtracted(page, 'search', null, provider, scoringTopics);
    if (verdict === 'saved') stats.saved++;
    else if (verdict === 'irrelevant') stats.irrelevant++;
  }
  await db.updateTable('topic').set({ last_search_at: new Date() }).where('key', '=', key).execute();
  return { topic: key, ...stats };
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ');

/**
 * Zapisuje treść ze strony wydawcy. Ocena trafności na metadanych STRONY (nie wyszukiwarki).
 * Zwraca, co się stało, do statystyk.
 */
async function storeExtracted(
  page: ExtractedArticle,
  via: 'feed' | 'search',
  feedUrl: string | null,
  provider: EmbeddingProvider,
  topics: LoadedTopic[],
): Promise<'saved' | 'irrelevant' | 'skipped'> {
  if (!page.title) return 'skipped';
  if (page.language && !env.CONTENT_LANGUAGES.includes(page.language)) return 'skipped';
  if (tooOld(page.publishedAt)) return 'skipped';
  if (page.tdmReserved) return 'skipped'; // wydawca zastrzegł eksplorację tekstu (TDM)

  const text = contentText(page.title, page.description);
  const [vector] = await provider.embedPassages([text]);
  const margins = await topicMargins(vector!, topics, provider, feedUrl);
  const ok = margins[0]!.margin >= env.RELEVANCE_THRESHOLD;
  const row = await db
    .insertInto('content_item')
    .values({
      canonical_url: page.canonicalUrl,
      url: page.url,
      source_domain: page.sourceDomain,
      source_name: page.siteName,
      title: page.title.slice(0, 500),
      description: page.description,
      language: page.language,
      published_at: page.publishedAt,
      author: page.author,
      image_url: page.imageUrl,
      discovered_via: via,
      feed_url: feedUrl,
      status: !ok ? 'irrelevant' : page.partial ? 'partial' : 'extracted',
      status_note: ok ? null : `margines ${margins[0]!.margin.toFixed(3)} < próg`,
      word_count: page.wordCount,
      content_hash: page.text ? sha(page.text) : null,
      fetched_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    })
    .onConflict((oc) => oc.column('canonical_url').doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!row) return 'skipped';
  await saveEmbedding(row.id, provider, text, vector!);
  if (!ok) return 'irrelevant';
  await linkTopics(row.id, via, margins.filter((m) => m.margin >= env.RELEVANCE_THRESHOLD));
  if (page.text) await saveText(row.id, page.text);
  return 'saved';
}

async function saveText(contentId: string, text: string) {
  const expires = new Date(Date.now() + env.CONTENT_TEXT_TTL_DAYS * DAY_MS);
  await db
    .insertInto('content_text')
    .values({ content_id: contentId, text, expires_at: expires })
    .onConflict((oc) => oc.column('content_id').doUpdateSet({ text, expires_at: expires }))
    .execute();
}

// ---------------------------------------------------------------- ekstrakcja pozycji z kanałów

export async function extractContent(contentId: string, provider: EmbeddingProvider) {
  const item = await db.selectFrom('content_item').selectAll().where('id', '=', contentId).executeTakeFirst();
  if (!item || item.status !== 'discovered') return { skipped: item?.status ?? 'brak' };
  let page: ExtractedArticle;
  try {
    page = await engine().extractor.extract(item.url);
  } catch (e) {
    const blocked = e instanceof FetchRejectedError;
    // Odmowa wydawcy (HTTP 4xx) jest ostateczna — nie ponawiamy. Błędy sieci i 5xx: ponowienie z kolejki.
    const clientError = /^HTTP 4\d\d$/.test((e as Error).message);
    if (clientError) {
      await db
        .updateTable('content_item')
        .set({ status: 'failed', status_note: (e as Error).message, updated_at: new Date() })
        .where('id', '=', contentId)
        .execute();
      return { status: 'failed', reason: (e as Error).message };
    }
    await db
      .updateTable('content_item')
      .set({ status: blocked ? 'blocked' : 'failed', status_note: (e as Error).message.slice(0, 300), updated_at: new Date() })
      .where('id', '=', contentId)
      .execute();
    if (blocked) return { status: 'blocked', reason: (e as FetchRejectedError).reason };
    throw e; // błąd sieci — kolejka ponowi
  }
  if (page.tdmReserved) {
    await db.updateTable('content_item').set({ status: 'blocked', status_note: 'zastrzeżenie TDM wydawcy', updated_at: new Date() }).where('id', '=', contentId).execute();
    return { status: 'blocked', reason: 'tdm' };
  }
  if (page.language && !env.CONTENT_LANGUAGES.includes(page.language)) {
    await db.updateTable('content_item').set({ status: 'irrelevant', status_note: `język ${page.language}`, updated_at: new Date() }).where('id', '=', contentId).execute();
    return { status: 'irrelevant', reason: 'language' };
  }
  // Metadane kanału zostają; strona uzupełnia braki (data, obraz, opis, język, wydawca).
  const description = item.description && item.description.length >= 60 ? item.description : (page.description ?? item.description);
  await db
    .updateTable('content_item')
    .set({
      status: page.partial ? 'partial' : 'extracted',
      status_note: null,
      source_name: page.siteName ?? item.source_name,
      description,
      language: page.language ?? item.language,
      published_at: item.published_at ?? page.publishedAt,
      author: page.author ?? item.author,
      image_url: item.image_url ?? page.imageUrl,
      word_count: page.wordCount,
      content_hash: page.text ? sha(page.text) : null,
      fetched_at: new Date(),
      updated_at: new Date(),
    })
    .where('id', '=', contentId)
    .execute();
  if (description !== item.description) {
    const text = contentText(item.title, description);
    const [v] = await provider.embedPassages([text]);
    await saveEmbedding(contentId, provider, text, v!);
  }
  if (page.text) await saveText(contentId, page.text);
  return { status: page.partial ? 'partial' : 'extracted', words: page.wordCount };
}

// ---------------------------------------------------------------- harmonogram

const FEED_INTERVAL_MS = 2 * 60 * 60_000;
const SEARCH_INTERVAL_MS = 20 * 60 * 60_000;

/** Zleca należne przebiegi: kanały co 2 h, wyszukiwanie tematu raz na ~dobę (w ramach limitu Brave). */
export async function scheduleDiscovery(provider: EmbeddingProvider) {
  const keys = await syncTopics(provider);
  const topics = await db.selectFrom('topic').selectAll().where('key', 'in', keys.length ? keys : ['']).execute();
  const slot = Math.floor(Date.now() / FEED_INTERVAL_MS);
  const feeds = new Set(topics.flatMap((t) => feedsFor(t.node_key)));
  for (const f of feeds) await enqueue(JOBS.ingestFeed, { feedUrl: f }, { dedupeKey: `${JOBS.ingestFeed}:${f}:${slot}` });
  let searches = 0;
  if (env.BRAVE_SEARCH_SECRET_KEY) {
    const day = new Date().toISOString().slice(0, 10);
    for (const t of topics) {
      if (!queriesFor(t).length) continue;
      if (t.last_search_at && Date.now() - t.last_search_at.getTime() < SEARCH_INTERVAL_MS) continue;
      await enqueue(JOBS.searchTopic, { topicKey: t.key }, { dedupeKey: `${JOBS.searchTopic}:${t.key}:${day}` });
      searches++;
    }
  }
  const pools = await schedulePools();
  const retried = await retryStaleExtractions();
  const { scheduleLearning } = await import('./learning.ts');
  const learning = await scheduleLearning();
  return { topics: keys.length, feeds: feeds.size, searches, pools, retried, learning };
}

/** Usuwa przeterminowany pełny tekst (zostają metadane, wektor i hash). */
export async function purgeExpiredText() {
  const res = await db.deleteFrom('content_text').where('expires_at', '<', new Date()).executeTakeFirst();
  return Number(res.numDeletedRows);
}

/** Pula na dziś dla osób po onboardingu: od 6:00 lokalnego czasu, raz dziennie (deduplikacja zadania). */
async function schedulePools() {
  const { BUILD_POOL_JOB, localDay } = await import('./pool.ts');
  const { DateTime } = await import('luxon');
  const users = await db
    .selectFrom('user_profile')
    .select(['user_id', 'timezone'])
    .where('onboarding_completed_at', 'is not', null)
    .execute();
  let n = 0;
  for (const u of users) {
    if (DateTime.now().setZone(u.timezone).hour < 6) continue;
    const day = localDay(u.timezone);
    const has = await db.selectFrom('daily_assignment').select('slot').where('user_id', '=', u.user_id).where('local_day', '=', day).limit(1).executeTakeFirst();
    if (has) continue;
    await enqueue(BUILD_POOL_JOB, { userId: u.user_id }, { dedupeKey: `${BUILD_POOL_JOB}:${u.user_id}:${day}` });
    n++;
  }
  return n;
}

/**
 * Pozycje trafne, których strony nie udało się pobrać (np. brak sieci w nocy wyczerpał próby),
 * wracają do kolejki. Deduplikacja per treść i godzina — bez zalewu zadaniami.
 */
async function retryStaleExtractions() {
  const stale = await db
    .selectFrom('content_item')
    .select('id')
    .where('status', '=', 'discovered')
    .where('created_at', '>', new Date(Date.now() - env.CONTENT_MAX_AGE_DAYS * DAY_MS))
    .where('created_at', '<', new Date(Date.now() - 30 * 60_000))
    .limit(200)
    .execute();
  const hour = new Date().toISOString().slice(0, 13);
  for (const s of stale) {
    await enqueue(JOBS.extractContent, { contentId: s.id }, { dedupeKey: `${JOBS.extractContent}:${s.id}:${hour}` });
  }
  return stale.length;
}
