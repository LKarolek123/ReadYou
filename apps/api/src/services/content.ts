/**
 * Karty, stany (polubienie / przeczytanie / pominięcie) i listy „Twoje artykuły”.
 *
 * Zasady stanów:
 * - Żądanie USTAWIA stan (liked=true), a nie przełącza — retransmisja niczego nie psuje.
 * - Interakcja do uczenia jest zapisywana w tej samej transakcji i tylko przy rzeczywistej zmianie.
 * - Polubienie i przeczytanie są niezależne; usunięcie polubienia nie usuwa historii przeczytania.
 * - Otwarcie streszczenia czy kliknięcie źródła NIE oznacza przeczytania.
 */
import { sql } from 'kysely';
import type { ArticleCard, ContentStatePatch, ContentStateView, InteractionInput, Paged, SummaryView } from '@readyou/shared';
import { getNode, getRoot, type IllustrationKey } from '@readyou/shared';
import { cleanCaveats } from '@readyou/providers';
import { db, type InteractionType } from '../db.ts';
import { env } from '../env.ts';
import { HttpError } from '../http.ts';
import { recomputeLearned } from '../engine/learning.ts';

type StateRow = { liked_at: Date | null; read_at: Date | null; skipped_at: Date | null };

export const stateView = (s: StateRow | undefined | null): ContentStateView => ({
  liked: Boolean(s?.liked_at),
  read: Boolean(s?.read_at),
  skipped: Boolean(s?.skipped_at),
  likedAt: s?.liked_at?.toISOString() ?? null,
  readAt: s?.read_at?.toISOString() ?? null,
});

export function illustrationFor(nodeKeys: (string | null | undefined)[]): IllustrationKey {
  for (const k of nodeKeys) {
    const root = k ? getNode(k)?.rootId : undefined;
    const ill = root ? getRoot(root)?.illustration : undefined;
    if (ill) return ill;
  }
  return 'generic';
}

/** Wiersze kart dla listy treści (bez filtrowania po użytkowniku — stan dołączany osobno). */
async function loadCards(userId: string, ids: string[]): Promise<Map<string, ArticleCard>> {
  if (!ids.length) return new Map();
  const rows = await db
    .selectFrom('content_item as c')
    .leftJoin('user_content_state as s', (j) => j.onRef('s.content_id', '=', 'c.id').on('s.user_id', '=', userId))
    .leftJoin('daily_assignment as a', (j) => j.onRef('a.content_id', '=', 'c.id').on('a.user_id', '=', userId))
    .select([
      'c.id', 'c.title', 'c.description', 'c.url', 'c.source_name', 'c.source_domain', 'c.published_at', 'c.word_count', 'c.image_url',
      's.liked_at', 's.read_at', 's.skipped_at', 'a.kind', 'a.reason',
      sql<string | null>`(select card_description from summary sm where sm.content_id = c.id and sm.sufficient order by sm.created_at desc limit 1)`.as('card_description'),
      sql<boolean | null>`(select sufficient from summary sm where sm.content_id = c.id order by sm.created_at desc limit 1)`.as('summary_sufficient'),
      sql<string[] | null>`(select tags from summary sm where sm.content_id = c.id order by sm.created_at desc limit 1)`.as('tags'),
      sql<string | null>`(select t.node_key from content_topic ct join topic t on t.key = ct.topic_key where ct.content_id = c.id order by ct.relevance desc nulls last limit 1)`.as('topic_node'),
    ])
    .where('c.id', 'in', ids)
    .execute();
  const out = new Map<string, ArticleCard>();
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      title: r.title,
      description: r.card_description ?? r.description,
      url: r.url,
      source: r.source_name ?? r.source_domain,
      publishedAt: r.published_at?.toISOString() ?? null,
      readingMinutes: r.word_count && r.word_count >= 150 ? Math.max(1, Math.round(r.word_count / 200)) : null,
      illustration: illustrationFor([r.reason?.nodeKey, ...(r.tags ?? []), r.topic_node]),
      imageUrl: env.SHOW_SOURCE_IMAGES ? r.image_url : null,
      summaryStatus: r.summary_sufficient === null ? 'pending' : r.summary_sufficient ? 'ready' : 'unavailable',
      state: stateView(r),
      why: r.kind ? { kind: r.kind, interest: r.reason?.interest ?? null, learned: r.reason?.learned ?? false } : null,
    });
  }
  return out;
}

async function ensureContent(contentId: string) {
  const c = await db.selectFrom('content_item').select('id').where('id', '=', contentId).executeTakeFirst();
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Nie znaleziono artykułu');
}

/** Ustawia stany; zwraca stan po zmianie. Interakcje tylko dla rzeczywistych zmian. */
export async function setContentState(userId: string, contentId: string, patch: ContentStatePatch): Promise<ContentStateView> {
  await ensureContent(contentId);
  const { view, events } = await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('user_content_state')
      .values({ user_id: userId, content_id: contentId, updated_at: new Date() })
      .onConflict((oc) => oc.columns(['user_id', 'content_id']).doNothing())
      .execute();
    const cur = await trx
      .selectFrom('user_content_state')
      .select(['liked_at', 'read_at', 'skipped_at'])
      .where('user_id', '=', userId)
      .where('content_id', '=', contentId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const now = new Date();
    const next = { ...cur };
    const events: InteractionType[] = [];
    const apply = (field: keyof StateRow, want: boolean | undefined, on: InteractionType, off: InteractionType) => {
      if (want === undefined || Boolean(cur[field]) === want) return;
      next[field] = want ? now : null;
      events.push(want ? on : off);
    };
    apply('liked_at', patch.liked, 'like', 'unlike');
    apply('read_at', patch.read, 'read', 'unread');
    apply('skipped_at', patch.skipped, 'skip', 'unskip');
    if (events.length) {
      await trx
        .updateTable('user_content_state')
        .set({ ...next, updated_at: now })
        .where('user_id', '=', userId)
        .where('content_id', '=', contentId)
        .execute();
      await trx
        .insertInto('interaction')
        .values(events.map((type) => ({ user_id: userId, content_id: contentId, type, idempotency_key: null, created_at: now })))
        .execute();
    }
    return { view: stateView(next), events };
  });
  // Pominięcie nie zmienia wag tematów; polubienie i przeczytanie (oraz ich cofnięcie) tak.
  if (events.some((e) => e !== 'skip' && e !== 'unskip')) await relearn(userId);
  return view;
}

/** Przeliczenie wyuczonych tematów po zmianie sygnałów. Błąd uczenia nie psuje zapisu stanu. */
async function relearn(userId: string) {
  try {
    await recomputeLearned(userId);
  } catch (e) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'Przeliczenie wyuczonych tematów nieudane', error: (e as Error).message }));
  }
}

/** Słabe sygnały (otwarcie streszczenia, kliknięcie źródła). Idempotentne po kluczu klienta. */
export async function logInteraction(userId: string, input: InteractionInput) {
  await ensureContent(input.contentId);
  const res = await db
    .insertInto('interaction')
    .values({ user_id: userId, content_id: input.contentId, type: input.type, idempotency_key: input.idempotencyKey, created_at: new Date() })
    .onConflict((oc) => oc.columns(['user_id', 'idempotency_key']).doNothing())
    .executeTakeFirst();
  // Samo wyświetlenie nie jest oceną; otwarcie streszczenia i kliknięcie źródła to słabe sygnały.
  if (input.type !== 'exposure' && Number(res.numInsertedOrUpdatedRows ?? 0n) > 0) await relearn(userId);
}

const encodeCursor = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
function decodeCursor(c: string | undefined): { at: Date; id: string } | null {
  if (!c) return null;
  const [at, id] = Buffer.from(c, 'base64url').toString().split('|');
  const d = new Date(at ?? '');
  if (!id || Number.isNaN(d.getTime())) throw new HttpError(400, 'VALIDATION_ERROR', 'Niepoprawny kursor');
  return { at: d, id };
}

/**
 * „Twoje artykuły”: Polubione = polubione i NIEprzeczytane (wg czasu polubienia),
 * Przeczytane = wszystkie przeczytane, także niepolubione (wg czasu przeczytania). Filtry w bazie.
 */
export async function listMyArticles(userId: string, list: 'liked-unread' | 'read', cursor?: string, limit = 20): Promise<Paged<ArticleCard>> {
  const col = list === 'read' ? 'read_at' : 'liked_at';
  const after = decodeCursor(cursor);
  let q = db
    .selectFrom('user_content_state')
    .select(['content_id', col])
    .where('user_id', '=', userId)
    .where(col, 'is not', null)
    .orderBy(col, 'desc')
    .orderBy('content_id', 'desc')
    .limit(limit + 1);
  if (list === 'liked-unread') q = q.where('read_at', 'is', null);
  if (after) q = q.where((eb) => eb.or([eb(col, '<', after.at), eb.and([eb(col, '=', after.at), eb('content_id', '<', after.id)])]));
  const rows = await q.execute();
  const page = rows.slice(0, limit);
  const cards = await loadCards(userId, page.map((r) => r.content_id));
  const last = page.at(-1);
  return {
    items: page.map((r) => cards.get(r.content_id)!).filter(Boolean),
    nextCursor: rows.length > limit && last ? encodeCursor(last[col] as Date, last.content_id) : null,
  };
}

/** Karty dzisiejszej puli; przeczytane i pominięte nie zajmują miejsca w „Dla Ciebie”. */
export async function todaysCards(userId: string, day: string) {
  const rows = await db
    .selectFrom('daily_assignment')
    .select(['content_id', 'slot'])
    .where('user_id', '=', userId)
    .where('local_day', '=', day)
    .orderBy('slot')
    .execute();
  const cards = await loadCards(userId, rows.map((r) => r.content_id));
  const all = rows.map((r) => cards.get(r.content_id)!).filter(Boolean);
  return { assigned: rows.length, items: interleaveByInterest(all.filter((c) => !c.state.read && !c.state.skipped)) };
}

/**
 * Kolejność wyświetlania: tematy na przemian (round-robin), a w obrębie tematu kolejność wg oceny.
 * Pula już jest zróżnicowana, ale trzy karty o Tesli na górze wyglądałyby monotonnie.
 */
export function interleaveByInterest(cards: ArticleCard[]): ArticleCard[] {
  const groups = new Map<string, ArticleCard[]>();
  for (const c of cards) {
    const key = c.why?.kind === 'explore' ? 'explore' : (c.why?.interest ?? '?');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  const out: ArticleCard[] = [];
  const queues = [...groups.values()];
  while (out.length < cards.length) for (const q of queues) if (q.length) out.push(q.shift()!);
  return out;
}

export async function getCard(userId: string, contentId: string): Promise<ArticleCard> {
  const card = (await loadCards(userId, [contentId])).get(contentId);
  if (!card) throw new HttpError(404, 'NOT_FOUND', 'Nie znaleziono artykułu');
  return card;
}

/** Zapisane streszczenie (bez wywołania modelu). „Dlaczego dla Ciebie” osobno od faktów. */
export async function getSummaryView(userId: string, contentId: string): Promise<SummaryView> {
  const card = await getCard(userId, contentId);
  const s = await db
    .selectFrom('summary')
    .selectAll()
    .where('content_id', '=', contentId)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return {
    contentId,
    title: card.title,
    status: !s ? 'pending' : s.sufficient ? 'ready' : 'unavailable',
    cardDescription: s?.card_description ?? null,
    summary: s?.summary ?? null,
    keyFacts: s?.key_facts ?? [],
    caveats: cleanCaveats(s?.caveats ?? []),
    basis: s?.basis ?? null,
    model: s?.model ?? null,
    source: { name: card.source, url: card.url, publishedAt: card.publishedAt },
    why: card.why,
    state: card.state,
  };
}
