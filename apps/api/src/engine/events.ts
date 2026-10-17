/**
 * Odkrywanie wydarzeń, klubów i miejsc — wspólne dla wszystkich osób, według miast i tematów.
 *
 * 1. `ingestEventSource`: strona programu organizatora albo kalendarz iCal →
 *    iCal / JSON-LD → (brak) JSON-LD na stronach szczegółów → (brak) ekstrakcja AI potwierdzona cytatami.
 *    Ekstrakcję AI uruchamiamy tylko, gdy strona się zmieniła (hash tekstu), w dziennym limicie stron
 *    i w budżecie LLM.
 * 2. `searchEvents`: wyszukiwarka (wyniki tylko w pamięci, regulamin Brave) → strony wydarzeń → jak wyżej.
 *    Wydarzenie z wyszukiwarki musi mieć dowód miejsca (miasto osoby) albo być online.
 * 3. `ingestPlaces`: OpenStreetMap (Overpass) → kluby i miejsca dla aktywnych tematów w mieście.
 *
 * Czego nie robimy: nie zgadujemy godziny (brak godziny = wydarzenie całodniowe), ceny (brak = nieznana,
 * nie „bezpłatne”) ani statusu zapisów. Zakończone i odwołane wydarzenia odpadają.
 */
import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import {
  canonicalizeUrl,
  detailLinks,
  visibleText,
  freeInQuote,
  numberInQuote,
  normalizeForQuote,
  OverpassPlacesProvider,
  osmSelectorsFor,
  OSM_SELECTORS,
  parseHtmlEvents,
  parseIcsEvents,
  ProviderNotConfiguredError,
  quoteInText,
  sourceDomain,
  timeInQuote,
  dateConfirmed,
  timeNearTitle,
  type EmbeddingProvider,
  type EventExtractor,
  type ExtractedEvent,
  type RawEvent,
} from '@readyou/providers';
import { getNode } from '@readyou/shared';
import { db } from '../db.ts';
import { env } from '../env.ts';
import { enqueue } from '../jobs/queue.ts';
import { engine } from './context.ts';
import { contentText, deskVectors, relevance } from './relevance.ts';
import { activeTopics, linkTopics, loadTopics, saveEmbedding, type LoadedTopic } from './discovery.ts';
import { CITY_NAMES, cityKey, DETAIL_LINK, eventQueriesFor, eventSourcesFor, EVENT_SOURCES } from './event-sources.ts';
import { estimateCostUsd, reserveLlm, settleLlm } from './llm-budget.ts';
import { reserveCall } from './usage.ts';

export const EVENT_JOBS = {
  ingestSource: 'ingest_event_source',
  searchEvents: 'search_events',
  ingestPlaces: 'ingest_places',
} as const;

export const DEFAULT_EVENT_TZ = 'Europe/Warsaw';
/** Bez podanego końca zakładamy 3 h trwania — tylko do decyzji „czy już się skończyło”, nie do wyświetlania. */
export const ASSUMED_DURATION_H = 3;
/** Wydarzenia dalej niż tyle dni w przód pomijamy (strona programu na cały rok to nie „ten tydzień”). */
export const MAX_AHEAD_DAYS = 120;
const MAX_DETAIL_PAGES = 8;
const DAY_MS = 86_400_000;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), level: 'info', msg, ...extra }));

// ---------------------------------------------------------------- czas

export interface Instant {
  at: Date;
  allDay: boolean;
}

/**
 * Surowa data → chwila. Sama data = całodniowe (lokalna północ w strefie wydarzenia).
 * Czas bez przesunięcia = czas lokalny strefy wydarzenia (z poprawnym czasem letnim/zimowym).
 */
export function toInstant(raw: string | null | undefined, tz: string): Instant | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = DateTime.fromISO(s, { zone: tz });
    return d.isValid ? { at: d.toJSDate(), allDay: true } : null;
  }
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const d = hasOffset ? DateTime.fromISO(s, { setZone: true }) : DateTime.fromISO(s, { zone: tz });
  return d.isValid ? { at: d.toJSDate(), allDay: false } : null;
}

export interface EventRecord {
  title: string;
  description: string | null;
  url: string;
  sourcePage: string;
  key: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  allDay: boolean;
  timezone: string;
  rrule: string | null;
  venueName: string | null;
  address: string | null;
  city: string | null;
  online: boolean;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  free: boolean;
  registrationUrl: string | null;
  registrationEndsAt: Date | null;
  availability: string | null;
  status: string | null;
  organizer: string | null;
  imageUrl: string | null;
  method: RawEvent['method'];
  quotes: Record<string, string>;
}

/** Miejscowość z polskiego adresu: „…, 30-072 Kraków” → „Kraków”. */
export function cityFromAddress(address: string | null): string | null {
  const m = address ? /\b\d{2}-\d{3}\s+(\p{L}[\p{L} .'-]*?)\s*$/u.exec(address) : null;
  return m?.[1]?.trim() ?? null;
}

/** Koniec do filtrowania: podany koniec, a bez niego początek + założony czas trwania (lub cały dzień). */
export function effectiveEnd(e: { startsAt: Date | null; endsAt: Date | null; allDay: boolean }, tz: string): Date | null {
  if (e.endsAt) return e.endsAt;
  if (!e.startsAt) return null;
  if (e.allDay) return DateTime.fromJSDate(e.startsAt).setZone(tz).plus({ days: 1 }).startOf('day').toJSDate();
  return new Date(e.startsAt.getTime() + ASSUMED_DURATION_H * 3_600_000);
}

/**
 * Surowe wydarzenie → rekord albo null (odwołane, zakończone, bez terminu i bez terminu zapisów,
 * za daleko w przyszłości). `sourceCity` = miasto skonfigurowanego źródła (strona organizatora w Krakowie).
 */
export function normalizeEvent(raw: RawEvent, ctx: { sourcePage: string; sourceCity: string | null; now?: Date }): EventRecord | null {
  const now = ctx.now ?? new Date();
  if (raw.status && /Cancelled/i.test(raw.status)) return null;
  const tz = raw.timezone && DateTime.local().setZone(raw.timezone).isValid ? raw.timezone : DEFAULT_EVENT_TZ;
  const start = toInstant(raw.startsAt, tz);
  const endRaw = toInstant(raw.endsAt, tz);
  let endsAt = endRaw?.at ?? null;
  // Data końca bez godziny w JSON-LD jest włącznie („do 26.10”), w iCal — wyłącznie (DTEND następnego dnia).
  if (endRaw?.allDay && raw.method !== 'ical') endsAt = DateTime.fromJSDate(endRaw.at).setZone(tz).plus({ days: 1 }).toJSDate();
  const allDay = start?.allDay ?? false;
  if (start && endsAt && endsAt < start.at) endsAt = null;
  const registrationEndsAt = toInstant(raw.registrationEndsAt, tz)?.at ?? null;

  const rec: EventRecord = {
    title: raw.title.slice(0, 300),
    description: raw.description?.slice(0, 1200) ?? null,
    url: raw.url,
    sourcePage: ctx.sourcePage,
    key: raw.key,
    startsAt: start?.at ?? null,
    endsAt,
    allDay,
    timezone: tz,
    rrule: raw.rrule,
    venueName: raw.venueName,
    address: raw.address,
    // Miasto: z danych wydarzenia (miejscowość, kod pocztowy w adresie), a dopiero potem z siedziby organizatora.
    city: raw.locality ?? cityFromAddress(raw.address) ?? ctx.sourceCity,
    online: raw.online,
    priceMin: raw.free ? 0 : raw.priceMin,
    priceMax: raw.free ? 0 : raw.priceMax,
    // Waluta nieznana przy znanej cenie: źródło polskie → PLN (strony organizatorów w Polsce podają złote).
    currency: raw.currency ?? (raw.priceMin !== null || raw.free ? 'PLN' : null),
    free: raw.free,
    registrationUrl: raw.registrationUrl,
    registrationEndsAt,
    availability: raw.availability,
    status: raw.status,
    organizer: raw.organizer,
    imageUrl: raw.imageUrl,
    method: raw.method,
    quotes: raw.quotes ?? {},
  };
  const end = effectiveEnd(rec, tz);
  if (!rec.startsAt && !(registrationEndsAt && registrationEndsAt > now)) return null; // bez terminu nie pokażemy
  if (end && end <= now && !raw.rrule) return null; // zakończone
  if (rec.startsAt && rec.startsAt.getTime() - now.getTime() > MAX_AHEAD_DAYS * DAY_MS) return null;
  return rec;
}

// ---------------------------------------------------------------- walidacja ekstrakcji AI cytatami

/**
 * Pole AI → wartość tylko, jeśli cytat jest w tekście strony, a wartość (godzina, dzień, kwota) w cytacie.
 * Zwraca surowe wydarzenie i listę odrzuconych pól (do diagnostyki).
 */
export function validateExtracted(e: ExtractedEvent, pageText: string, pageUrl: string, tz: string): { raw: RawEvent | null; rejected: Record<string, string> } {
  const norm = normalizeForQuote(pageText);
  const rejected: Record<string, string> = {};
  const quotes: Record<string, string> = {};
  const take = <T>(name: string, f: { value: T | null; quote: string | null }, check?: (v: T, q: string) => boolean): T | null => {
    if (f.value === null || f.value === undefined || (typeof f.value === 'string' && !f.value.trim())) return null;
    if (!quoteInText(f.quote, norm)) {
      rejected[name] = 'quote_not_found';
      return null;
    }
    if (check && !check(f.value, f.quote!)) {
      rejected[name] = 'quote_mismatch';
      return null;
    }
    quotes[name] = f.quote!;
    return f.value;
  };
  const dateCheck = (v: string, q: string) => {
    const inst = toInstant(v, tz);
    if (!inst) return false;
    const local = DateTime.fromJSDate(inst.at).setZone(tz);
    if (!dateConfirmed(local.day, local.month, q, norm, e.title.value ?? undefined)) return false;
    return inst.allDay || timeInQuote(local.hour, local.minute, q) || (e.title.value ? timeNearTitle(local.hour, local.minute, norm, e.title.value) : false);
  };
  const title = take('title', e.title);
  if (!title) return { raw: null, rejected };
  const startsAt = take('starts_at', e.starts_at, dateCheck);
  const endsAt = take('ends_at', e.ends_at, dateCheck);
  const registrationEndsAt = take('registration_ends_at', e.registration_ends_at, dateCheck);
  const priceMin = take('price_min', e.price_min, (v, q) => (v === 0 ? freeInQuote(q) : v > 0 && numberInQuote(v, q)));
  const priceMax = take('price_max', e.price_max, (v, q) => v >= 0 && numberInQuote(v, q));
  const online = take('online', e.online) ?? false;
  return {
    raw: {
      key: null,
      title,
      // Opis to parafraza modelu (bez dat i cen) — pokazujemy go jako opis karty, nie jako fakt.
      description: e.description.value?.slice(0, 300) ?? null,
      startsAt,
      endsAt,
      timezone: tz,
      rrule: null,
      venueName: take('venue_name', e.venue_name),
      address: take('address', e.address),
      locality: take('city', e.city),
      online,
      priceMin,
      priceMax: priceMax !== null && priceMin !== null && priceMax < priceMin ? null : priceMax,
      currency: null,
      free: priceMin === 0,
      url: pageUrl,
      registrationUrl: null,
      registrationEndsAt,
      availability: null,
      organizer: null,
      imageUrl: null,
      status: null,
      method: 'llm-quotes',
      quotes,
    },
    rejected,
  };
}

/**
 * Cykl sesji (np. cotygodniowy jam): źródło podaje przy każdej sesji ten sam `endDate` — koniec cyklu,
 * a nie sesji. Bez poprawki sesja z początku miesiąca „trwałaby” do końca cyklu. Takim sesjom
 * usuwamy koniec (sesja jednodniowa / z założonym czasem trwania).
 */
export function fixSeriesEnds(events: RawEvent[]): RawEvent[] {
  const groups = countBy(events.filter((e) => e.endsAt).map((e) => `${e.title}|${e.endsAt}`));
  return events.map((e) => {
    if (!e.endsAt || (groups.get(`${e.title}|${e.endsAt}`) ?? 0) < 2) return e;
    return { ...e, endsAt: null };
  });
}

/** Najmniejszy margin powiązania wydarzenia z tematem (krótkie teksty — ostrzej niż artykuły). */
export const EVENT_TOPIC_MIN_MARGIN = 0.01;
/** Minimalna liczba słów tytułu i opisu, przy której wektor wydarzenia mówi coś o temacie. */
export const MIN_WORDS_FOR_TOPICS = 6;

/**
 * Trafność wydarzenia względem tematów: konkurencją są działy newsowe ORAZ działy wydarzeń
 * (koncert, spektakl, konferencja…), z bramką dowodów słownych dla szczegółowych tematów.
 */
export async function eventTopicMargins(vector: number[], topics: LoadedTopic[], provider: EmbeddingProvider, evidence: string) {
  const desks = await deskVectors(provider, 'events');
  return topics
    .map((t) => ({ key: t.key, margin: relevance(vector, [{ id: t.key, label: t.label, nodeKey: t.node_key, vector: t.vector, ancestors: t.ancestors }], desks, null, evidence).margin }))
    .filter((m) => m.margin >= EVENT_TOPIC_MIN_MARGIN)
    .sort((a, b) => b.margin - a.margin);
}

// ---------------------------------------------------------------- zapis

/** Klucz katalogu: kanoniczny adres wydarzenia; kilka wydarzeń z jednej strony programu różni fragment. */
function eventCanonical(rec: EventRecord, sharedPage: boolean): string {
  const base = canonicalizeUrl(rec.url);
  if (!sharedPage) return base;
  const id = rec.key ?? `${rec.title}|${rec.startsAt?.toISOString() ?? ''}`;
  return `${base}#ev-${sha(id).slice(0, 12)}`;
}

export async function upsertEvent(rec: EventRecord, ctx: { sharedPage: boolean; provider: EmbeddingProvider; topics: LoadedTopic[]; via: 'organizer' | 'search'; pageText?: string | null }) {
  const canonical = eventCanonical(rec, ctx.sharedPage);
  const now = new Date();
  const row = await db
    .insertInto('content_item')
    .values({
      kind: 'event',
      canonical_url: canonical,
      url: rec.url,
      source_domain: sourceDomain(rec.sourcePage),
      source_name: rec.organizer,
      title: rec.title,
      description: rec.description,
      language: 'pl',
      image_url: rec.imageUrl,
      discovered_via: ctx.via,
      status: 'extracted',
      word_count: ctx.pageText ? ctx.pageText.split(/\s+/).length : null,
      fetched_at: now,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) => oc.column('canonical_url').doUpdateSet({ title: rec.title, description: rec.description, fetched_at: now, updated_at: now }))
    .returning('id')
    .executeTakeFirstOrThrow();
  const details = {
    starts_at: rec.startsAt,
    ends_at: rec.endsAt,
    all_day: rec.allDay,
    timezone: rec.timezone,
    rrule: rec.rrule,
    venue_name: rec.venueName,
    address: rec.address,
    city: rec.city,
    city_normalized: rec.city ? cityKey(rec.city) : null,
    online: rec.online,
    price_min: rec.priceMin,
    price_max: rec.priceMax,
    currency: rec.currency,
    free: rec.free,
    registration_url: rec.registrationUrl,
    registration_ends_at: rec.registrationEndsAt,
    availability: rec.availability,
    status: rec.status,
    organizer: rec.organizer,
    method: rec.method,
    quotes: JSON.stringify(rec.quotes),
    source_page: rec.sourcePage,
    verified_at: now,
  };
  await db
    .insertInto('event_details')
    .values({ content_id: row.id, ...details })
    .onConflict((oc) => oc.column('content_id').doUpdateSet(details))
    .execute();
  const text = contentText(rec.title, [rec.description, rec.venueName].filter(Boolean).join('. ') || null);
  const [vector] = await ctx.provider.embedPassages([text]);
  await saveEmbedding(row.id, ctx.provider, text, vector!);
  const margins = await eventTopicMargins(vector!, ctx.topics, ctx.provider, [rec.title, rec.description ?? '', rec.venueName ?? ''].join('\n'));
  // Sam tytuł („Korn”, „Mrozu”) nie wystarcza do oceny tematu — bez opisu nie łączymy z tematami
  // (dopasowanie może przyjść później z tagów AI-streszczenia strony wydarzenia).
  const words = `${rec.title} ${rec.description ?? ''}`.split(/\s+/).filter(Boolean).length;
  await linkTopics(row.id, ctx.via, words >= MIN_WORDS_FOR_TOPICS ? margins.slice(0, 3) : []);
  if (ctx.pageText && ctx.pageText.length >= 400) {
    const expires = new Date(Date.now() + env.CONTENT_TEXT_TTL_DAYS * DAY_MS);
    const t = ctx.pageText.slice(0, 20_000);
    await db
      .insertInto('content_text')
      .values({ content_id: row.id, text: t, expires_at: expires })
      .onConflict((oc) => oc.column('content_id').doUpdateSet({ text: t, expires_at: expires }))
      .execute();
  }
  return row.id;
}

// ---------------------------------------------------------------- pobieranie

const ACCEPT = ['text/html', 'application/xhtml+xml', 'text/calendar'];

async function fetchPage(url: string) {
  const { fetcher } = engine();
  await engine().robots.assertAllowed(url);
  const res = await fetcher.fetch(url, ACCEPT);
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return { body: res.body.toString('utf8'), contentType: res.contentType, finalUrl: res.finalUrl };
}

/** Ekstrakcja AI z limitem stron dziennie i w budżecie LLM. null = niedostępna (limit, brak klucza). */
async function extractWithAi(extractor: EventExtractor, text: string, url: string, tz: string): Promise<{ events: RawEvent[]; rejected: number } | null> {
  if (!(await reserveCall('event-llm', { daily: env.EVENT_LLM_PAGES_PER_DAY, monthly: env.EVENT_LLM_PAGES_PER_DAY * 31 }))) return null;
  const input = text.slice(0, 24_000);
  const reserved = estimateCostUsd(Math.ceil((input.length + 3000) / 3.5), 4000);
  if (!(await reserveLlm(extractor.model, reserved))) return null;
  let out;
  try {
    out = await extractor.extract({ text: input, url, today: DateTime.now().setZone(tz).toISODate()!, timezone: tz });
  } catch (e) {
    await settleLlm(extractor.model, reserved, null);
    if (e instanceof ProviderNotConfiguredError) return null;
    throw e;
  }
  await settleLlm(extractor.model, reserved, out.usage);
  let rejected = 0;
  const events: RawEvent[] = [];
  for (const ev of out.events) {
    const v = validateExtracted(ev, input, url, tz);
    rejected += Object.keys(v.rejected).length;
    if (v.raw) events.push(v.raw);
  }
  return { events, rejected };
}

/** Wydarzenia ze strony: iCal → JSON-LD → JSON-LD stron szczegółów → (opcjonalnie) AI z cytatami. */
async function eventsFromPage(
  url: string,
  extractor: EventExtractor | null,
  opts: { allowAi: boolean; previousHash?: string | null },
): Promise<{ events: RawEvent[]; method: string; hash: string; pageText: string | null; detail: Map<string, string> }> {
  const page = await fetchPage(url);
  const detail = new Map<string, string>(); // URL szczegółów → tekst strony (do streszczeń)
  if (page.contentType === 'text/calendar' || /\.ics$|vcalendar/i.test(new URL(page.finalUrl).pathname)) {
    return { events: parseIcsEvents(page.body, url), method: 'ical', hash: sha(page.body), pageText: null, detail };
  }
  const text = visibleText(page.body);
  const hash = sha(text);
  let events = parseHtmlEvents(page.body, url);
  if (events.length) return { events, method: 'json-ld', hash, pageText: events.length === 1 ? text : null, detail };
  for (const link of detailLinks(page.body, page.finalUrl, DETAIL_LINK, MAX_DETAIL_PAGES)) {
    try {
      const d = await fetchPage(link);
      const found = parseHtmlEvents(d.body, link);
      if (found.length) {
        events = events.concat(found);
        detail.set(link, visibleText(d.body));
      }
    } catch {
      /* odmowa robots lub błąd jednej strony szczegółów — pomijamy ją */
    }
  }
  if (events.length) return { events, method: 'json-ld-detail', hash, pageText: null, detail };
  if (!opts.allowAi || !extractor) return { events: [], method: 'none', hash, pageText: null, detail };
  if (opts.previousHash === hash) return { events: [], method: 'unchanged', hash, pageText: null, detail };
  const ai = await extractWithAi(extractor, text, url, DEFAULT_EVENT_TZ);
  if (!ai) return { events: [], method: 'ai-unavailable', hash, pageText: null, detail };
  return { events: ai.events, method: 'llm-quotes', hash, pageText: null, detail };
}

export async function ingestEventSource(url: string, city: string, provider: EmbeddingProvider, extractor: EventExtractor | null) {
  const src = eventSourcesFor(city).find((s) => s.url === url);
  if (!src) return { skipped: 'źródło nieskonfigurowane' };
  const prev = await db.selectFrom('event_source').selectAll().where('url', '=', url).executeTakeFirst();
  const topics = await loadTopics(provider, [...(await activeTopics()).keys()]);
  const now = new Date();
  let result;
  try {
    result = await eventsFromPage(url, extractor, { allowAi: true, previousHash: prev?.last_status === 'ok' ? prev.content_hash : null });
  } catch (e) {
    await saveSource(url, city, src.kind, { last_status: `błąd: ${(e as Error).message.slice(0, 200)}`, last_fetched_at: now });
    throw e;
  }
  if (result.method === 'unchanged') {
    // Strona bez zmian: wydarzenia z niej są nadal ogłaszane — odświeżamy datę weryfikacji.
    await db.updateTable('event_details').set({ verified_at: now }).where('source_page', '=', url).execute();
    await saveSource(url, city, src.kind, { last_status: 'ok', last_fetched_at: now });
    return { url, method: 'unchanged' };
  }
  let saved = 0;
  const dropped = { date: 0, place: 0 };
  const events = fixSeriesEnds(result.events);
  const perUrl = countBy(events.map((e) => e.url));
  for (const raw of events) {
    const rec = normalizeEvent(raw, { sourcePage: url, sourceCity: src.regional ? null : city });
    if (!rec) {
      dropped.date++; // zakończone, odwołane, bez terminu albo zbyt daleko
      continue;
    }
    if (!rec.online && cityKey(rec.city) !== cityKey(city)) {
      dropped.place++; // poza miastem albo bez dowodu miejsca
      log('Wydarzenie poza miastem', { url, title: rec.title, city: rec.city });
      continue;
    }
    await upsertEvent(rec, { sharedPage: (perUrl.get(raw.url) ?? 0) > 1, provider, topics, via: 'organizer', pageText: result.detail.get(raw.url) ?? result.pageText });
    saved++;
  }
  const ok = !['ai-unavailable'].includes(result.method);
  await saveSource(url, city, src.kind, { last_status: ok ? 'ok' : result.method, content_hash: ok ? result.hash : prev?.content_hash ?? null, last_fetched_at: now, events_found: saved });
  return { url, method: result.method, found: result.events.length, saved, dropped };
}

const countBy = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());

async function saveSource(url: string, city: string, kind: 'ics' | 'page', patch: { last_status: string; last_fetched_at: Date; content_hash?: string | null; events_found?: number }) {
  await db
    .insertInto('event_source')
    .values({ url, city_normalized: cityKey(city), kind, ...patch, updated_at: new Date() })
    .onConflict((oc) => oc.column('url').doUpdateSet({ ...patch, updated_at: new Date() }))
    .execute();
}

/** Aktywne tematy osób z danego miasta (ścieżki węzłów taksonomii). */
async function cityTopicPaths(city: string): Promise<string[][]> {
  const rows = await db
    .selectFrom('user_interest as ui')
    .innerJoin('user_profile as up', 'up.user_id', 'ui.user_id')
    .select(['ui.node_key', 'up.city'])
    .where('ui.state', 'in', ['explicit', 'learned'])
    .where('ui.node_key', 'is not', null)
    .where('up.onboarding_completed_at', 'is not', null)
    .execute();
  const paths = new Map<string, string[]>();
  for (const r of rows) {
    if (cityKey(r.city) !== cityKey(city)) continue;
    const n = getNode(r.node_key!);
    if (n) paths.set(r.node_key!, n.path);
  }
  // Najpierw najbardziej szczegółowe (więcej konkretnych zapytań, np. hackathony przed „Informatyką”).
  return [...paths.values()].sort((a, b) => b.length - a.length);
}

export async function searchEvents(city: string, provider: EmbeddingProvider, extractor: EventExtractor | null) {
  const { search } = engine();
  const queries = eventQueriesFor(city, await cityTopicPaths(city));
  if (!queries.length) return { skipped: 'brak tematów z zapytaniami o wydarzenia' };
  const hits = new Map<string, string>(); // kanoniczny URL → URL (tylko w pamięci zadania)
  let calls = 0;
  for (const q of queries) {
    if (!(await reserveCall('brave-events', { daily: env.EVENT_SEARCH_DAILY_QUERIES, monthly: env.EVENT_SEARCH_DAILY_QUERIES * 31 }))) break;
    if (!(await reserveCall(search.name, { daily: env.BRAVE_DAILY_QUERY_LIMIT, monthly: env.BRAVE_MONTHLY_QUERY_LIMIT }))) break;
    calls++;
    try {
      for (const h of await search.searchWeb({ ...q, count: 10 })) {
        try {
          const c = canonicalizeUrl(h.url);
          if (!hits.has(c)) hits.set(c, h.url);
        } catch {
          /* zły URL */
        }
      }
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) return { skipped: e.message };
      throw e;
    }
  }
  const known = new Set(
    (await db.selectFrom('event_details').select('source_page').where('source_page', 'in', [...hits.values()].length ? [...hits.values()] : ['']).execute()).map((r) => r.source_page),
  );
  const pages = [...hits.values()].filter((u) => !known.has(u)).slice(0, env.EVENT_SEARCH_PAGES_PER_RUN);
  hits.clear();
  const topics = await loadTopics(provider, [...(await activeTopics()).keys()]);
  const stats = { calls, pages: pages.length, saved: 0, noLocation: 0, rejected: 0 };
  for (const url of pages) {
    let result;
    try {
      result = await eventsFromPage(url, extractor, { allowAi: true });
    } catch (e) {
      stats.rejected++;
      log('Pominięto stronę wydarzenia', { url, reason: (e as Error).message });
      continue;
    }
    for (const raw of fixSeriesEnds(result.events)) {
      const rec = normalizeEvent(raw, { sourcePage: url, sourceCity: null });
      if (!rec) continue;
      // Z wyszukiwarki: wymagany dowód miejsca (miasto osoby) albo wydarzenie online.
      if (!rec.online && cityKey(rec.city) !== cityKey(city)) {
        stats.noLocation++;
        continue;
      }
      await upsertEvent(rec, { sharedPage: result.events.filter((e) => e.url === raw.url).length > 1, provider, topics, via: 'search', pageText: result.detail.get(raw.url) ?? result.pageText });
      stats.saved++;
    }
  }
  return { city, ...stats };
}

// ---------------------------------------------------------------- kluby i miejsca (OpenStreetMap)

export async function ingestPlaces(city: string, provider: EmbeddingProvider) {
  const paths = await cityTopicPaths(city);
  const byFilter = new Map<string, string>(); // selektor → węzeł, który go wymagał
  for (const p of paths) for (const s of osmSelectorsFor(p)) if (!byFilter.has(s.filter)) byFilter.set(s.filter, Object.keys(OSM_SELECTORS).find((k) => OSM_SELECTORS[k]!.some((o) => o.filter === s.filter) && p.includes(k)) ?? p.at(-1)!);
  const selectors = paths.flatMap((p) => osmSelectorsFor(p)).filter((s, i, all) => all.findIndex((o) => o.filter === s.filter) === i);
  if (!selectors.length) return { skipped: 'brak tematów z klubami/miejscami w OSM' };
  const places = await new OverpassPlacesProvider(engine().osmFetcher).places(city, selectors);
  const topics = await loadTopics(provider, [...(await activeTopics()).keys()]);
  const now = new Date();
  let saved = 0;
  for (const p of places) {
    const osmUrl = `https://www.openstreetmap.org/${p.osmRef}`;
    const row = await db
      .insertInto('content_item')
      .values({
        kind: p.kind,
        canonical_url: osmUrl,
        url: p.website ?? osmUrl,
        source_domain: 'openstreetmap.org',
        source_name: 'OpenStreetMap',
        title: p.name.slice(0, 300),
        // Opis z OSM albo sama kategoria z tagów OSM (bez dopisywania ofert ani godzin).
        description: p.description ?? p.category,
        language: 'pl',
        discovered_via: 'osm',
        status: 'extracted',
        fetched_at: now,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) => oc.column('canonical_url').doUpdateSet({ title: p.name.slice(0, 300), url: p.website ?? osmUrl, description: p.description ?? p.category, updated_at: now }))
      .returning('id')
      .executeTakeFirstOrThrow();
    const details = {
      osm_ref: p.osmRef,
      category: p.category,
      osm_filter: p.filter,
      node_key: byFilter.get(p.filter) ?? null,
      lat: p.lat,
      lon: p.lon,
      address: p.address,
      website: p.website,
      opening_hours: p.openingHours,
      city_normalized: cityKey(city),
      price_min: p.priceMin,
      price_max: p.priceMax,
      free: p.free,
      verified_at: now,
    };
    await db.insertInto('place_details').values({ content_id: row.id, ...details }).onConflict((oc) => oc.column('content_id').doUpdateSet(details)).execute();
    const text = `${p.name}. ${p.category}${p.description ? `. ${p.description}` : ''}`;
    const [vector] = await provider.embedPassages([text]);
    await saveEmbedding(row.id, provider, text, vector!);
    saved++;
  }
  return { city, selectors: selectors.length, places: places.length, saved };
}

// ---------------------------------------------------------------- harmonogram

/** Miasta osób po onboardingu (oryginalna pisownia pierwszej osoby z danym kluczem). */
async function activeCities(): Promise<string[]> {
  const rows = await db.selectFrom('user_profile').select('city').where('onboarding_completed_at', 'is not', null).where('city', 'is not', null).execute();
  const byKey = new Map<string, string>();
  for (const r of rows) if (r.city && !byKey.has(cityKey(r.city))) byKey.set(cityKey(r.city), r.city);
  return [...byKey.values()];
}

/** Strony organizatorów raz na dobę, wyszukiwarka raz na dobę, OSM raz w tygodniu — dla aktywnych miast. */
export async function scheduleEvents() {
  const cities = await activeCities();
  const day = new Date().toISOString().slice(0, 10);
  const week = DateTime.utc().toFormat("kkkk-'W'WW");
  let sources = 0;
  for (const city of cities) {
    for (const s of eventSourcesFor(city)) {
      await enqueue(EVENT_JOBS.ingestSource, { url: s.url, city }, { dedupeKey: `${EVENT_JOBS.ingestSource}:${s.url}:${day}` });
      sources++;
    }
    if (env.BRAVE_SEARCH_SECRET_KEY && env.EVENT_SEARCH_DAILY_QUERIES > 0) {
      await enqueue(EVENT_JOBS.searchEvents, { city }, { dedupeKey: `${EVENT_JOBS.searchEvents}:${cityKey(city)}:${day}` });
    }
    await enqueue(EVENT_JOBS.ingestPlaces, { city }, { dedupeKey: `${EVENT_JOBS.ingestPlaces}:${cityKey(city)}:${week}` });
  }
  return { cities: cities.length, sources };
}

/** Nazwy miast ze skonfigurowanymi źródłami (do komunikatów). */
export const configuredCities = () => Object.keys(EVENT_SOURCES).map((k) => CITY_NAMES[k] ?? k);
