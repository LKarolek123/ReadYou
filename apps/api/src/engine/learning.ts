/**
 * Uczenie z interakcji: wyuczone zainteresowania (`user_interest.state = 'learned'`).
 *
 * Wyuczone tematy nie są zwiększane przyrostowo przy każdym kliknięciu, tylko liczone od nowa
 * z bieżącego stanu (polubienia i przeczytania z `user_content_state`, różne treści z otwarciem
 * streszczenia lub kliknięciem źródła z `interaction`). Dzięki temu:
 * - wielokrotne kliknięcie serca, retransmisja czy ponowne otwarcie nie zawyżają wag,
 * - cofnięcie polubienia lub przeczytania wycofuje dokładnie jego wkład,
 * - pominięcie nie ma żadnej wagi tematu (ukrywa tylko pozycję).
 *
 * Temat treści to najbardziej szczegółowe tagi taksonomii z jej AI-streszczenia (a bez streszczenia:
 * węzeł tematu, przez który ją znaleźliśmy).
 *
 * Reguły (heurystyka startowa, do strojenia):
 * - wkład pozycji: polubienie 1,0; przeczytanie 0,4; kliknięcie źródła 0,3; otwarcie streszczenia 0,1;
 *   najwyżej 1,5 na pozycję; wygaszanie wykładnicze (połowa po ~3 tygodniach) od ostatniego sygnału,
 * - temat powstaje dopiero po polubieniu (słabe sygnały same nie tworzą tematu) — jako ukryty,
 *   z małą wagą, używany umiarkowanie (najwyżej 1 pozycja w puli),
 * - widocznym tagiem „Na podstawie polubionych treści” staje się po polubieniu 3 różnych pozycji
 *   (i wyniku ≥ 1,5 po wygaszaniu),
 * - znika, gdy wynik spadnie poniżej progu (brak aktywności); jawne zainteresowania nigdy nie wygasają,
 * - wykluczenia mają pierwszeństwo: wykluczonego tematu (ani jego poddrzewa) nie uczymy,
 * - nie uczymy tematów już pokrytych jawnym wyborem (ten sam węzeł albo jego przodek wybrany wprost
 *   jako liść — np. przy jawnym „RAG” nie dodajemy wyuczonego „Agenci AI”).
 */
import { sql } from 'kysely';
import { getNode, normalizeTag } from '@readyou/shared';
import { db } from '../db.ts';
import { bumpProfileVersion } from '../services/profile.ts';

export const LEARN_WINDOW_DAYS = 120;
export const SIGNAL_WEIGHTS = { like: 1, read: 0.4, source_click: 0.3, summary_open: 0.1 } as const;
export const MAX_PER_ITEM = 1.5;
export const DECAY_DAYS = 30; // e^(−21/30) ≈ 0,5 po trzech tygodniach
export const PROMOTE_LIKED_ITEMS = 3;
/** Poniżej tego wyniku (po wygaszaniu) temat znika; widoczny tag przy spadku wraca do sygnału ukrytego. */
export const MIN_HIDDEN_SCORE = 0.5;
export const MIN_VISIBLE_SCORE = 1.5;
export const HIDDEN_WEIGHT = 0.3;

const DAY_MS = 86_400_000;

export interface ItemSignals {
  contentId: string;
  /** Najbardziej szczegółowe węzły taksonomii treści. */
  nodes: string[];
  likedAt: Date | null;
  readAt: Date | null;
  sourceClickAt: Date | null;
  summaryOpenAt: Date | null;
}

export interface LearnedTopic {
  nodeKey: string;
  score: number;
  likedItems: number;
  visible: boolean;
  weight: number;
}

/** Usuwa z listy tagi będące przodkami innych tagów z listy (zostają najbardziej szczegółowe). */
export function mostSpecific(tags: readonly string[]): string[] {
  const known = tags.filter((t) => getNode(t));
  return [...new Set(known.filter((t) => !known.some((o) => o !== t && getNode(o)!.path.includes(t))))];
}

export function itemContribution(s: ItemSignals, now = Date.now()) {
  let raw = 0;
  let last = 0;
  const add = (at: Date | null, w: number) => {
    if (!at) return;
    raw += w;
    last = Math.max(last, at.getTime());
  };
  add(s.likedAt, SIGNAL_WEIGHTS.like);
  add(s.readAt, SIGNAL_WEIGHTS.read);
  add(s.sourceClickAt, SIGNAL_WEIGHTS.source_click);
  add(s.summaryOpenAt, SIGNAL_WEIGHTS.summary_open);
  if (!raw) return 0;
  const ageDays = Math.max(0, (now - last) / DAY_MS);
  return Math.min(MAX_PER_ITEM, raw) * Math.exp(-ageDays / DECAY_DAYS);
}

/**
 * Czysta funkcja: sygnały pozycji → pożądane wyuczone tematy.
 * Bez stanu: ten sam zbiór sygnałów daje zawsze ten sam wynik, więc cofnięcie polubienia wycofuje
 * dokładnie jego wkład.
 * @param blocked czy węzeł jest zablokowany (wykluczony lub pokryty jawnym wyborem)
 */
export function learnTopics(items: ItemSignals[], blocked: (nodeKey: string) => boolean, now = Date.now()): LearnedTopic[] {
  const acc = new Map<string, { score: number; liked: Set<string> }>();
  for (const it of items) {
    const c = itemContribution(it, now);
    if (!c) continue;
    for (const node of it.nodes) {
      if (blocked(node)) continue;
      const a = acc.get(node) ?? { score: 0, liked: new Set<string>() };
      a.score += c;
      if (it.likedAt) a.liked.add(it.contentId);
      acc.set(node, a);
    }
  }
  const out: LearnedTopic[] = [];
  for (const [nodeKey, a] of acc) {
    if (!a.liked.size) continue; // bez polubienia temat nie powstaje
    if (a.score < MIN_HIDDEN_SCORE) continue;
    const visible = a.liked.size >= PROMOTE_LIKED_ITEMS && a.score >= MIN_VISIBLE_SCORE;
    out.push({ nodeKey, score: a.score, likedItems: a.liked.size, visible, weight: visible ? Math.min(1, Math.max(0.5, a.score / 4)) : HIDDEN_WEIGHT });
  }
  return out;
}

/** Zbiera sygnały pozycji użytkownika z okna uczenia. */
async function loadSignals(userId: string): Promise<ItemSignals[]> {
  const since = new Date(Date.now() - LEARN_WINDOW_DAYS * DAY_MS);
  const rows = await sql<{
    content_id: string;
    liked_at: Date | null;
    read_at: Date | null;
    click_at: Date | null;
    open_at: Date | null;
    tags: string[] | null;
    topic_node: string | null;
  }>`
    with signals as (
      select content_id,
             max(created_at) filter (where type = 'source_click') as click_at,
             max(created_at) filter (where type = 'summary_open') as open_at
      from interaction
      where user_id = ${userId} and content_id is not null and created_at >= ${since}
        and type in ('source_click', 'summary_open')
      group by content_id
    ), items as (
      select coalesce(s.content_id, g.content_id) as content_id,
             s.liked_at, s.read_at, g.click_at, g.open_at
      from (select content_id, liked_at, read_at from user_content_state
            where user_id = ${userId} and (liked_at >= ${since} or read_at >= ${since})) s
      full join signals g on g.content_id = s.content_id
    )
    select i.content_id, i.liked_at, i.read_at, i.click_at, i.open_at,
      (select sm.tags from summary sm where sm.content_id = i.content_id and sm.sufficient order by sm.created_at desc limit 1) as tags,
      (select t.node_key from content_topic ct join topic t on t.key = ct.topic_key
        where ct.content_id = i.content_id and t.node_key is not null order by ct.relevance desc nulls last limit 1) as topic_node
    from items i`.execute(db);
  return rows.rows.map((r) => ({
    contentId: r.content_id,
    nodes: mostSpecific(r.tags?.length ? r.tags : r.topic_node ? [r.topic_node] : []),
    likedAt: r.liked_at && r.liked_at >= since ? r.liked_at : null,
    readAt: r.read_at && r.read_at >= since ? r.read_at : null,
    sourceClickAt: r.click_at,
    summaryOpenAt: r.open_at,
  }));
}

/**
 * Przelicza wyuczone tematy osoby i zapisuje różnicę. Idempotentne i bezpieczne współbieżnie
 * (blokada doradcza per osoba). Zmiana zbioru tematów podbija wersję profilu i zleca wektory.
 */
export async function recomputeLearned(userId: string) {
  const items = await loadSignals(userId);
  const changed = await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`learn:${userId}`}))`.execute(trx);
    const interests = await trx
      .selectFrom('user_interest')
      .select(['id', 'node_key', 'normalized', 'state', 'visible', 'weight', 'path'])
      .where('user_id', '=', userId)
      .execute();
    const excluded = interests.filter((i) => i.state === 'excluded');
    const explicitNodes = new Set(interests.filter((i) => i.state === 'explicit' && i.node_key).map((i) => i.node_key!));
    const blocked = (nodeKey: string) => {
      const n = getNode(nodeKey)!;
      const label = normalizeTag(n.node.label);
      // Wykluczenie tematu albo któregoś z jego przodków („Sport” wyklucza też „Siatkówkę”).
      if (excluded.some((e) => (e.node_key && n.path.includes(e.node_key)) || e.normalized === label)) return true;
      if (explicitNodes.has(nodeKey)) return true;
      // Węzeł jest przodkiem jawnego wyboru — ogólniejszy temat już pokrywa jawna gałąź.
      for (const k of explicitNodes) if (getNode(k)?.path.includes(nodeKey)) return true;
      // Kolizja etykiety z jawnym tagiem spoza taksonomii.
      return interests.some((i) => i.state === 'explicit' && i.normalized === label);
    };
    const current = interests.filter((i) => i.state === 'learned');
    const want = learnTopics(items, blocked);
    const wantBy = new Map(want.map((t) => [t.nodeKey, t]));

    let structural = false;
    const stale = current.filter((i) => !i.node_key || !wantBy.has(i.node_key)).map((i) => i.id);
    if (stale.length) {
      await trx.deleteFrom('user_interest').where('user_id', '=', userId).where('id', 'in', stale).execute();
      structural = true;
    }
    for (const t of want) {
      const n = getNode(t.nodeKey)!;
      const label = n.node.label;
      const path = n.path.map((id) => getNode(id)!.node.label);
      const prev = current.find((i) => i.node_key === t.nodeKey);
      if (!prev) structural = true;
      else if (prev.visible !== t.visible) structural = true;
      const now = new Date();
      await trx
        .insertInto('user_interest')
        .values({
          user_id: userId,
          node_key: t.nodeKey,
          label,
          normalized: normalizeTag(label),
          path,
          state: 'learned',
          origin: 'behavior',
          weight: t.weight,
          visible: t.visible,
          learned_score: Number(t.score.toFixed(3)),
          learned_items: t.likedItems,
          created_at: now,
          updated_at: now,
        })
        // Nigdy nie nadpisujemy jawnego wyboru ani wykluczenia o tej samej etykiecie.
        .onConflict((oc) =>
          oc
            .columns(['user_id', 'normalized'])
            .doUpdateSet({
              weight: t.weight,
              visible: t.visible,
              learned_score: Number(t.score.toFixed(3)),
              learned_items: t.likedItems,
              updated_at: now,
            })
            .where('user_interest.state', '=', 'learned'),
        )
        .execute();
    }
    return { structural, topics: want.length, removed: stale.length };
  });
  // Nowy lub usunięty temat = nowy wektor i nowa wersja profilu (zadania async wykrywają nieaktualność).
  if (changed.structural) await bumpProfileVersion(userId);
  return changed;
}

/** Zleca dzienne przeliczenie (wygaszanie) dla osób z wyuczonymi tematami. */
export const RECOMPUTE_LEARNED_JOB = 'recompute_learned';

/** Raz na dobę (UTC) przelicza tematy osób z wyuczonymi zainteresowaniami — wygasza nieaktywne. */
export async function scheduleLearning() {
  const { enqueue } = await import('../jobs/queue.ts');
  const users = await db.selectFrom('user_interest').select('user_id').distinct().where('state', '=', 'learned').execute();
  const day = new Date().toISOString().slice(0, 10);
  for (const u of users) await enqueue(RECOMPUTE_LEARNED_JOB, { userId: u.user_id }, { dedupeKey: `${RECOMPUTE_LEARNED_JOB}:${u.user_id}:${day}` });
  return users.length;
}
