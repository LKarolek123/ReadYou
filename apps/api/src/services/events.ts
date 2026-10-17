/**
 * Wydarzenia, kluby i miejsca dla osoby: filtry dat w jej strefie, ranking i uczciwe uzasadnienia.
 *
 * Twarde filtry (jednoznaczna niezgodność): wydarzenie zakończone lub odwołane, wykluczony temat,
 * wydarzenie stacjonarne w innym mieście, pominięte przez osobę. Cena powyżej budżetu NIE jest twardym
 * filtrem (budżet to „komfortowa” kwota, nie jawny twardy limit) — obniża ocenę i jest opisana.
 * Nieznana cena nie oznacza wstępu wolnego; nieznany koniec nie potwierdza zgodności z kalendarzem.
 *
 * Ocena (heurystyka startowa, wagi do strojenia):
 *   0,35 zainteresowanie + 0,15 typ aktywności + 0,15 dostępność czasowa + 0,15 budżet
 *   + 0,10 jakość dowodów + 0,10 bliskość terminu (lub końca zapisów).
 * Zainteresowanie pochodzi z powiązań treść–temat liczonych w workerze (`content_topic`), więc API
 * nie potrzebuje modelu wektorowego.
 */
import { DateTime } from 'luxon';
import { sql } from 'kysely';
import type { ArticleCard, EventFeedView, EventRange } from '@readyou/shared';
import { ACTIVITY_TYPES, getNode } from '@readyou/shared';
import { db } from '../db.ts';
import { HttpError } from '../http.ts';
import { topicKey } from '../engine/discovery.ts';
import { exclusionFilter } from '../engine/pool.ts';
import { cityKey, eventSourcesFor } from '../engine/event-sources.ts';
import { ASSUMED_DURATION_H, effectiveEnd } from '../engine/events.ts';
import { scheduleSummary } from '../engine/summaries.ts';
import { loadCards } from './content.ts';

const WEIGHTS = { interest: 0.35, activity: 0.15, time: 0.15, budget: 0.15, quality: 0.1, soon: 0.1 };
const LIMIT = 40;
/** Klucz, który nie pasuje do żadnego miasta (osoba bez miasta widzi tylko wydarzenia online). */
const NO_CITY = '-';
const UPCOMING_DAYS = 60;
const REGISTRATION_SOON_DAYS = 14;
const PLACE_MAX_AGE_DAYS = 30;
/** Ile streszczeń wydarzeń zlecamy przy jednym otwarciu listy (koszt; reszta dojdzie przy kolejnych). */
const SUMMARIES_PER_VIEW = 6;

/** Kategoria główna taksonomii → typ aktywności z profilu. */
const ROOT_ACTIVITY: Record<string, string> = {
  tech: 'tech',
  science: 'tech',
  business: 'tech',
  auto: 'tech',
  mountains: 'outdoor',
  nature: 'outdoor',
  travel: 'outdoor',
  sport: 'sport',
  dance: 'social',
  food: 'social',
  games: 'calm',
  music: 'culture',
  culture: 'culture',
};

const SLOT_OF = (hour: number) => (hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening');
const WEEKDAY_IDS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export interface RangeWindow {
  from: Date;
  to: Date;
}

/** Półotwarte okna czasu lokalnego osoby: [od, do). Tydzień = do poniedziałku 00:00 lokalnie. */
export function rangeWindow(range: 'today' | 'week' | 'upcoming', tz: string, now = new Date()): RangeWindow {
  const local = DateTime.fromJSDate(now).setZone(tz);
  const dayStart = local.startOf('day');
  const nextMonday = local.startOf('week').plus({ weeks: 1 }); // Luxon: tydzień ISO od poniedziałku
  if (range === 'today') return { from: dayStart.toJSDate(), to: dayStart.plus({ days: 1 }).toJSDate() };
  if (range === 'week') return { from: now, to: nextMonday.toJSDate() };
  return { from: nextMonday.toJSDate(), to: local.plus({ days: UPCOMING_DAYS }).toJSDate() };
}

/** Czy wydarzenie należy do okna: trwa lub zaczyna się w oknie i jeszcze się nie skończyło. */
export function inWindow(e: { startsAt: Date | null; endsAt: Date | null; allDay: boolean; timezone: string }, w: RangeWindow, now = new Date()): boolean {
  if (!e.startsAt) return false;
  const end = effectiveEnd(e, e.timezone)!;
  return e.startsAt < w.to && end > w.from && end > now;
}

interface Profile {
  city: string | null;
  timezone: string;
  budget_max_event_price: number | null;
  budget_currency: string;
  available_days: string[];
  available_slots: string[];
  activity_types: string[];
}

export function timeFit(e: { startsAt: Date | null; allDay: boolean; timezone: string }, p: Pick<Profile, 'available_days' | 'available_slots'>): { score: number; ok: boolean | null } {
  if (!p.available_days.length && !p.available_slots.length) return { score: 0.6, ok: null };
  if (!e.startsAt) return { score: 0.5, ok: null };
  const local = DateTime.fromJSDate(e.startsAt).setZone(e.timezone);
  const dayOk = !p.available_days.length || p.available_days.includes(WEEKDAY_IDS[local.weekday - 1]!);
  if (e.allDay) return { score: dayOk ? 0.7 : 0.3, ok: dayOk ? null : false }; // godzina nieznana — bez potwierdzenia
  const slotOk = !p.available_slots.length || p.available_slots.includes(SLOT_OF(local.hour));
  return dayOk && slotOk ? { score: 1, ok: true } : { score: 0.3, ok: false };
}

/** Ile dni może trwać wydarzenie, by uznać je za „trwające” bez sprawdzania wystawy/festiwalu. */
export const LONG_RUNNING_DAYS = 14;
const ONGOING_KIND = /wystaw|ekspozycj|exhibit|festiwal|festival|jarmark|targi|instalacj/i;

export function isLongRunningSeries(e: { startsAt: Date | null; endsAt: Date | null; title: string; description: string | null }): boolean {
  if (!e.startsAt || !e.endsAt) return false;
  if (e.endsAt.getTime() - e.startsAt.getTime() <= LONG_RUNNING_DAYS * 86_400_000) return false;
  return !ONGOING_KIND.test(`${e.title} ${e.description ?? ''}`);
}

export function budgetFit(price: { min: number | null; free: boolean } | null, budget: number | null): { score: number; label: string } {
  if (price?.free) return { score: 1, label: 'Wstęp wolny' };
  if (!price || price.min === null) return { score: 0.5, label: 'Cena nieznana' };
  if (budget === null) return { score: 0.6, label: `Od ${price.min} zł` };
  return price.min <= budget ? { score: 1, label: 'W Twoim budżecie' } : { score: 0.2, label: `Powyżej Twojego budżetu (do ${budget} zł)` };
}

const fmtDay = (d: Date, tz: string) => DateTime.fromJSDate(d).setZone(tz).setLocale('pl').toFormat('d LLLL');

async function loadProfile(userId: string): Promise<Profile> {
  const p = await db
    .selectFrom('user_profile')
    .select(['city', 'timezone', 'budget_max_event_price', 'budget_currency', 'available_days', 'available_slots', 'activity_types'])
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'Brak profilu');
  return p;
}

async function loadInterests(userId: string) {
  const rows = await db.selectFrom('user_interest').select(['label', 'path', 'node_key', 'state', 'weight']).where('user_id', '=', userId).execute();
  const active = rows.filter((r) => r.state !== 'excluded');
  return {
    byTopic: new Map(active.map((r) => [topicKey(r.label, r.path), r])),
    // Od najbardziej szczegółowych — dopasowanie wskazuje „RAG”, a nie „Informatykę”.
    nodes: active
      .filter((r) => r.node_key)
      .map((r) => ({ key: r.node_key!, label: r.label, path: getNode(r.node_key!)?.path ?? [] }))
      .sort((a, b) => b.path.length - a.path.length),
    excluded: exclusionFilter(rows.filter((r) => r.state === 'excluded')),
  };
}

export async function eventFeed(userId: string, range: EventRange, cursor?: string): Promise<EventFeedView> {
  const profile = await loadProfile(userId);
  const city = profile.city;
  const sourcesConfigured = eventSourcesFor(city).length > 0;
  if (range === 'saved') return savedEvents(userId, city, sourcesConfigured, cursor);
  if (range === 'places') return placesFeed(userId, profile, sourcesConfigured);
  const now = new Date();
  const win = rangeWindow(range, profile.timezone, now);
  const ck = cityKey(city);
  const regSoon = new Date(now.getTime() + REGISTRATION_SOON_DAYS * 86_400_000);

  let q = db
    .selectFrom('content_item as c')
    .innerJoin('event_details as e', 'e.content_id', 'c.id')
    .leftJoin('user_content_state as s', (j) => j.onRef('s.content_id', '=', 'c.id').on('s.user_id', '=', userId))
    .select([
      'c.id', 'c.title', 'c.description', 'e.starts_at', 'e.ends_at', 'e.all_day', 'e.timezone', 'e.online', 'e.price_min', 'e.free',
      'e.registration_ends_at', 'e.method', 'e.availability', 'e.status', 'e.rrule',
      sql<string[] | null>`(select tags from summary sm where sm.content_id = c.id and sm.sufficient order by sm.created_at desc limit 1)`.as('tags'),
    ])
    .where('c.kind', '=', 'event')
    .where((eb) => eb.or([eb('e.online', '=', true), eb('e.city_normalized', '=', ck || NO_CITY)]))
    .where((eb) => eb.or([eb('s.skipped_at', 'is', null), eb('s.content_id', 'is', null)]))
    .where((eb) => eb.or([eb('e.status', 'is', null), eb('e.status', 'not like', '%Cancelled%')]));
  // Wstępne zawężenie w bazie (dokładny test okna z założonym czasem trwania — niżej).
  const slack = new Date(win.from.getTime() - 3 * 86_400_000);
  if (range === 'upcoming') {
    q = q.where((eb) =>
      eb.or([
        eb.and([eb('e.starts_at', '>=', win.from), eb('e.starts_at', '<', win.to)]),
        eb.and([eb('e.registration_ends_at', '>', now), eb('e.registration_ends_at', '<=', regSoon)]),
      ]),
    );
  } else {
    q = q.where('e.starts_at', '<', win.to).where((eb) => eb.or([eb('e.ends_at', '>', now), eb.and([eb('e.ends_at', 'is', null), eb('e.starts_at', '>', slack)])]));
  }
  const rows = await q.limit(500).execute();

  const interests = await loadInterests(userId);
  const ids = rows.map((r) => r.id);
  const links = ids.length
    ? await db.selectFrom('content_topic').select(['content_id', 'topic_key', 'relevance']).where('content_id', 'in', ids).execute()
    : [];
  const bestTopic = new Map<string, { label: string; margin: number; nodeKey: string | null }>();
  for (const l of links) {
    const ui = interests.byTopic.get(l.topic_key);
    if (!ui) continue;
    const margin = (l.relevance ?? 0) * (ui.weight ?? 1);
    const prev = bestTopic.get(l.content_id);
    if (!prev || margin > prev.margin) bestTopic.set(l.content_id, { label: ui.label, margin, nodeKey: ui.node_key });
  }
  const activityLabel = new Map(ACTIVITY_TYPES.map((a) => [a.id as string, a.label]));

  const scored: { id: string; score: number; why: NonNullable<ArticleCard['why']> }[] = [];
  for (const r of rows) {
    const ev = { startsAt: r.starts_at, endsAt: r.ends_at, allDay: r.all_day, timezone: r.timezone };
    const registrationSoon = Boolean(r.registration_ends_at && r.registration_ends_at > now && r.registration_ends_at <= regSoon);
    const inRange = range === 'upcoming' ? (r.starts_at ? r.starts_at >= win.from && r.starts_at < win.to : false) || registrationSoon : inWindow(ev, win, now);
    if (!inRange) continue;
    if (range === 'upcoming' && r.starts_at && effectiveEnd(ev, ev.timezone)! <= now) continue;
    if (interests.excluded(r.title, r.tags ?? [])) continue;
    // Długi okres bez konkretnych sesji (np. „cykliczne spotkania, kwiecień–grudzień”) nie mówi, czy coś
    // dzieje się dziś lub w tym tygodniu. Trwające wystawy i festiwale — tak.
    if (range !== 'upcoming' && isLongRunningSeries({ ...ev, title: r.title, description: r.description })) continue;
    const reasons: string[] = [];
    let topic = bestTopic.get(r.id);
    if (r.tags?.length) {
      // Tagi AI-streszczenia (z pełnego tekstu strony) rozstrzygają: temat tylko wtedy, gdy tag leży
      // w poddrzewie zainteresowania (najbardziej szczegółowego).
      const byTag = interests.nodes.find((n) => r.tags!.some((t) => getNode(t)?.path.includes(n.key)));
      topic = byTag ? { label: byTag.label, margin: 0.05, nodeKey: byTag.key } : undefined;
    }
    const interest = topic ? Math.min(1, Math.max(0, topic.margin / 0.06)) : 0;
    if (topic) reasons.push(`Pasuje do: ${topic.label}`);
    const root = topic?.nodeKey ? getNode(topic.nodeKey)?.rootId : r.tags?.[0] ? getNode(r.tags[0])?.rootId : undefined;
    const act = root ? ROOT_ACTIVITY[root] : undefined;
    const activity = act && profile.activity_types.includes(act) ? 1 : profile.activity_types.length ? 0.3 : 0.5;
    if (act && profile.activity_types.includes(act)) reasons.push(`Lubisz: ${activityLabel.get(act)}`);
    const tf = timeFit(ev, profile);
    if (tf.ok === true) reasons.push('Pasuje do Twojej dostępności');
    const bf = budgetFit({ min: r.price_min === null ? null : Number(r.price_min), free: r.free }, profile.budget_max_event_price);
    reasons.push(bf.label);
    const quality = (r.method === 'json-ld' ? 1 : r.method === 'ical' ? 0.9 : 0.7) * (r.availability && /SoldOut/i.test(r.availability) ? 0.5 : 1);
    let soon = 0.5;
    if (registrationSoon) {
      soon = 1;
      reasons.push(`Zapisy do ${fmtDay(r.registration_ends_at!, profile.timezone)}`);
    } else if (r.starts_at) {
      soon = Math.exp(-Math.max(0, r.starts_at.getTime() - now.getTime()) / (7 * 86_400_000));
    }
    reasons.push(r.online ? 'Online' : 'W Twoim mieście');
    const score =
      WEIGHTS.interest * interest + WEIGHTS.activity * activity + WEIGHTS.time * tf.score + WEIGHTS.budget * bf.score + WEIGHTS.quality * quality + WEIGHTS.soon * soon;
    scored.push({ id: r.id, score, why: { kind: 'matched', interest: topic?.label ?? null, reasons } });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, LIMIT);
  const cards = await loadCards(userId, top.map((t) => t.id), new Map(top.map((t) => [t.id, t.why])));
  const items = top.map((t) => cards.get(t.id)!).filter(Boolean);
  for (const c of items.filter((c) => c.summaryStatus === 'pending').slice(0, SUMMARIES_PER_VIEW)) await scheduleSummary(c.id);
  return {
    range,
    city,
    items,
    sourcesConfigured,
    notice: !city
      ? 'Ustaw miasto w Profilu, żeby zobaczyć wydarzenia w okolicy. Na razie pokazujemy tylko wydarzenia online.'
      : !sourcesConfigured
        ? `Dla miasta ${city} nie mamy jeszcze stron organizatorów — pokazujemy wydarzenia znalezione w wyszukiwarce i online.`
        : null,
    nextCursor: null,
  };
}

async function placesFeed(userId: string, profile: Profile, sourcesConfigured: boolean): Promise<EventFeedView> {
  const interests = await loadInterests(userId);
  const since = new Date(Date.now() - PLACE_MAX_AGE_DAYS * 86_400_000);
  const rows = await db
    .selectFrom('content_item as c')
    .innerJoin('place_details as p', 'p.content_id', 'c.id')
    .leftJoin('user_content_state as s', (j) => j.onRef('s.content_id', '=', 'c.id').on('s.user_id', '=', userId))
    .select(['c.id', 'c.title', 'p.node_key', 'p.category', 'p.verified_at'])
    .where('p.city_normalized', '=', cityKey(profile.city) || NO_CITY)
    .where('p.verified_at', '>', since)
    .where((eb) => eb.or([eb('s.skipped_at', 'is', null), eb('s.content_id', 'is', null)]))
    .execute();
  const scored: { id: string; score: number; why: NonNullable<ArticleCard['why']> }[] = [];
  for (const r of rows) {
    if (!r.node_key || interests.excluded(r.title, [r.node_key])) continue;
    // Tylko miejsca związane z tematami tej osoby (zapytanie OSM łączy tematy wszystkich osób z miasta).
    const match = interests.nodes.find((n) => n.path.includes(r.node_key!) || getNode(r.node_key!)?.path.includes(n.key));
    if (!match) continue;
    const exact = match.key === r.node_key || match.path.includes(r.node_key!);
    scored.push({ id: r.id, score: (exact ? 1 : 0.7) + (r.verified_at.getTime() - since.getTime()) / (PLACE_MAX_AGE_DAYS * 86_400_000) * 0.1, why: { kind: 'matched', interest: match.label, reasons: [`Pasuje do: ${match.label}`, r.category] } });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 60);
  const cards = await loadCards(userId, top.map((t) => t.id), new Map(top.map((t) => [t.id, t.why])));
  return {
    range: 'places',
    city: profile.city,
    items: top.map((t) => cards.get(t.id)!).filter(Boolean),
    sourcesConfigured,
    notice: profile.city ? null : 'Ustaw miasto w Profilu, żeby zobaczyć kluby i miejsca w okolicy.',
    nextCursor: null,
  };
}

const encodeCursor = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');

async function savedEvents(userId: string, city: string | null, sourcesConfigured: boolean, cursor?: string): Promise<EventFeedView> {
  let after: { at: Date; id: string } | null = null;
  if (cursor) {
    const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
    const d = new Date(at ?? '');
    if (!id || Number.isNaN(d.getTime())) throw new HttpError(400, 'VALIDATION_ERROR', 'Niepoprawny kursor');
    after = { at: d, id };
  }
  let q = db
    .selectFrom('user_content_state as s')
    .innerJoin('content_item as c', 'c.id', 's.content_id')
    .select(['s.content_id', 's.liked_at'])
    .where('s.user_id', '=', userId)
    .where('s.liked_at', 'is not', null)
    .where('c.kind', 'in', ['event', 'club', 'place'])
    .orderBy('s.liked_at', 'desc')
    .orderBy('s.content_id', 'desc')
    .limit(21);
  if (after) q = q.where((eb) => eb.or([eb('s.liked_at', '<', after!.at), eb.and([eb('s.liked_at', '=', after!.at), eb('s.content_id', '<', after!.id)])]));
  const rows = await q.execute();
  const page = rows.slice(0, 20);
  const cards = await loadCards(userId, page.map((r) => r.content_id));
  const last = page.at(-1);
  return {
    range: 'saved',
    city,
    items: page.map((r) => cards.get(r.content_id)!).filter(Boolean),
    sourcesConfigured,
    notice: null,
    nextCursor: rows.length > 20 && last ? encodeCursor(last.liked_at!, last.content_id) : null,
  };
}

export { ASSUMED_DURATION_H };
