// Port z Pulse & Go: apps/api/app/adapters/outbound/structured_page.py (JSON-LD Event, iCalendar),
// apps/api/app/domain/services/extraction.py (walidacja wartości dosłownymi cytatami).
/**
 * Wydarzenia ze stron organizatorów: dane strukturalne (schema.org `Event` w JSON-LD, kalendarze
 * iCalendar) oraz walidacja pól wyodrębnionych przez LLM dosłownymi cytatami z tekstu strony.
 *
 * Zasada: niczego nie zgadujemy. Brak godziny = wydarzenie całodniowe albo nieznana godzina, brak ceny =
 * cena nieznana (nie „bezpłatne”), brak końca zapisów = status zapisów nieznany. Daty zwracamy jako
 * surowe napisy — konwersję stref (z poprawnym czasem letnim) robi warstwa aplikacji.
 */
import { parseHTML } from 'linkedom';

export interface RawEvent {
  /** Identyfikator wydarzenia u źródła (`@id`, UID iCalendar), jeśli jest. */
  key: string | null;
  title: string;
  description: string | null;
  /** ISO 8601 z przesunięciem, bez niego (czas lokalny) albo sama data (całodniowe). */
  startsAt: string | null;
  endsAt: string | null;
  /** Strefa podana przez źródło (TZID iCalendar). */
  timezone: string | null;
  rrule: string | null;
  venueName: string | null;
  address: string | null;
  locality: string | null;
  online: boolean;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  /** true = źródło jawnie podaje wstęp wolny (cena 0 lub `isAccessibleForFree`). */
  free: boolean;
  url: string;
  registrationUrl: string | null;
  /** Koniec sprzedaży/zapisów (`offers.validThrough`). */
  registrationEndsAt: string | null;
  /** `offers.availability`: InStock / SoldOut / … */
  availability: string | null;
  organizer: string | null;
  imageUrl: string | null;
  /** EventCancelled / EventPostponed / EventScheduled … */
  status: string | null;
  method: 'json-ld' | 'ical' | 'llm-quotes';
  /** Dla `llm-quotes`: cytaty potwierdzające pola. */
  quotes?: Record<string, string>;
}

const TAG = /<[^>]+>/g;

function text(v: unknown): string | null {
  if (typeof v === 'boolean' || v === null || v === undefined) return null;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.length ? text(v[0]) : null;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return text(o['@value'] ?? o.name);
  }
  if (typeof v === 'string') {
    const decoded = parseHTML(`<p>${v.replace(TAG, ' ')}</p>`).document.querySelector('p')?.textContent ?? v;
    // Część stron koduje HTML encjami (`&lt;p&gt;`) i dosłowne „\n” — po zdekodowaniu zdejmujemy je ponownie.
    const cleaned = decoded.replace(TAG, ' ').replace(/\\[nrt]/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned || null;
  }
  return null;
}

function price(v: unknown): number | null {
  const s = text(v);
  if (s === null) return null;
  const n = Number(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const asList = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function isEvent(node: Record<string, unknown>): boolean {
  return asList(node['@type'] as string | string[]).some((t) => typeof t === 'string' && t.split('/').pop()!.endsWith('Event'));
}

function collectEvents(node: unknown, found: Record<string, unknown>[]) {
  if (Array.isArray(node)) for (const n of node) collectEvents(n, found);
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (isEvent(o)) found.push(o);
    else for (const k of ['@graph', 'itemListElement', 'item', 'mainEntity', 'subEvent']) collectEvents(o[k], found);
  }
}

function addressOf(v: unknown): { address: string | null; locality: string | null } {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const locality = text(o.addressLocality);
    const city = [text(o.postalCode), locality].filter(Boolean).join(' ');
    return { address: [text(o.streetAddress), city].filter(Boolean).join(', ') || null, locality };
  }
  return { address: text(v), locality: null };
}

function eventFromJsonLd(node: Record<string, unknown>, pageUrl: string): RawEvent | null {
  const title = text(node.name);
  if (!title) return null;
  let venueName: string | null = null;
  let address: string | null = null;
  let locality: string | null = null;
  let online = /OnlineEventAttendanceMode/i.test(String(node.eventAttendanceMode ?? ''));
  for (const loc of asList(node.location as unknown)) {
    if (loc && typeof loc === 'object') {
      const o = loc as Record<string, unknown>;
      if (asList(o['@type'] as string).some((t) => /VirtualLocation/i.test(String(t)))) {
        online = true;
        continue;
      }
      venueName ??= text(o.name);
      if (!address) ({ address, locality } = addressOf(o.address));
    } else if (typeof loc === 'string') venueName ??= text(loc);
  }
  const offers = asList(node.offers as unknown).filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === 'object');
  const prices = offers.flatMap((o) => [price(o.price), price(o.lowPrice), price(o.highPrice)]).filter((p): p is number => p !== null);
  const free = node.isAccessibleForFree === true || String(node.isAccessibleForFree).toLowerCase() === 'true' || (prices.length > 0 && Math.max(...prices) === 0);
  const offer = offers[0];
  const url = text(node.url);
  const id = typeof node['@id'] === 'string' && node['@id'].trim() ? node['@id'] : null;
  const organizer = asList(node.organizer as unknown).map(text).find(Boolean) ?? null;
  const image = asList(node.image as unknown).map((i) => (typeof i === 'string' ? i : text((i as Record<string, unknown>)?.url))).find(Boolean) ?? null;
  const resolve = (u: string | null) => {
    if (!u) return null;
    try {
      return new URL(u, pageUrl).toString();
    } catch {
      return null;
    }
  };
  return {
    key: id,
    title,
    description: text(node.description),
    startsAt: text(node.startDate),
    endsAt: text(node.endDate),
    timezone: null,
    rrule: null,
    venueName,
    address,
    locality,
    online,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    currency: offer ? text(offer.priceCurrency) : null,
    free,
    url: resolve(url) ?? pageUrl,
    registrationUrl: offer ? resolve(text(offer.url)) : null,
    registrationEndsAt: offer ? text(offer.validThrough) : null,
    availability: offer ? (text(offer.availability)?.split('/').pop() ?? null) : null,
    organizer,
    imageUrl: resolve(image),
    status: text(node.eventStatus)?.split('/').pop() ?? null,
    method: 'json-ld',
  };
}

/** Wydarzenia z bloków JSON-LD strony (schema.org `Event` i podtypy). Błędny blok jest pomijany. */
export function parseHtmlEvents(html: string, pageUrl: string): RawEvent[] {
  const { document } = parseHTML(html);
  const nodes: Record<string, unknown>[] = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      collectEvents(JSON.parse(s.textContent ?? ''), nodes);
    } catch {
      /* zły JSON jednego bloku nie przekreśla strony */
    }
  }
  return nodes.map((n) => eventFromJsonLd(n, pageUrl)).filter((e): e is RawEvent => e !== null);
}

// ---------------------------------------------------------------- iCalendar (RFC 5545)

function unfold(ics: string): string[] {
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

const icsUnescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').replace(/\s+/g, ' ').trim();

/** Wartość daty iCalendar → ISO: `20261025` (całodniowe), `20261025T190000` (lokalny), `…Z` (UTC). */
function icsMoment(value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return `${y}-${mo}-${d}`;
  return `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}${z ? 'Z' : ''}`;
}

export function parseIcsEvents(ics: string, pageUrl: string): RawEvent[] {
  const events: RawEvent[] = [];
  let cur: Record<string, { value: string; params: Record<string, string> }> | null = null;
  for (const line of unfold(ics)) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT' && cur) {
      const get = (k: string) => cur![k]?.value;
      const title = get('SUMMARY') ? icsUnescape(get('SUMMARY')!) : null;
      if (title) {
        const start = cur.DTSTART;
        events.push({
          key: get('UID') ?? null,
          title,
          description: get('DESCRIPTION') ? icsUnescape(get('DESCRIPTION')!).slice(0, 2000) : null,
          startsAt: start ? icsMoment(start.value) : null,
          endsAt: cur.DTEND ? icsMoment(cur.DTEND.value) : null,
          timezone: start?.params.TZID ?? null,
          rrule: get('RRULE') ?? null,
          venueName: get('LOCATION') ? icsUnescape(get('LOCATION')!) : null,
          address: null,
          locality: null,
          online: false,
          priceMin: null,
          priceMax: null,
          currency: null,
          free: false,
          url: get('URL') ?? pageUrl,
          registrationUrl: null,
          registrationEndsAt: null,
          availability: null,
          organizer: null,
          imageUrl: null,
          status: get('STATUS') === 'CANCELLED' ? 'EventCancelled' : null,
          method: 'ical',
        });
      }
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(':');
      if (idx <= 0) continue;
      const [name, ...paramParts] = line.slice(0, idx).split(';');
      const params = Object.fromEntries(paramParts.map((p) => p.split('=') as [string, string]));
      cur[name!.toUpperCase()] = { value: line.slice(idx + 1), params };
    }
  }
  return events;
}

// ---------------------------------------------------------------- walidacja ekstrakcji LLM

/** Normalizacja do porównania cytatu z tekstem: małe litery, pojedyncze spacje, ujednolicone myślniki i cudzysłowy. */
export function normalizeForQuote(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[‐-―−]/g, '-')
    .replace(/[„”“"«»]/g, '"')
    .replace(/[‘’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export const quoteInText = (quote: unknown, normText: string) => typeof quote === 'string' && normalizeForQuote(quote).length > 0 && normText.includes(normalizeForQuote(quote));

/** Godzina z wartości występuje w cytacie: 19:00, 19.00, 7pm, 7:30 p.m. */
export function timeInQuote(hour: number, minute: number, quote: string): boolean {
  const q = quote.toLowerCase();
  if (new RegExp(`(?<!\\d)0?${hour}[:.]${String(minute).padStart(2, '0')}(?!\\d)`).test(q)) return true;
  for (const m of q.matchAll(/(?<![\d:.])(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m\b/g)) {
    if ((Number(m[1]) % 12) + (m[3] === 'p' ? 12 : 0) === hour && Number(m[2] ?? 0) === minute) return true;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(quote) ? false : false;
}

/**
 * Godzina potwierdzona przy tytule: gdy cytat to sama data („23.10 2026”), a godzina stoi w opisie
 * pozycji („… Fokus & Rahim wejście: 19:00 start: 20:00”). Okno jest wąskie (krótko przed tytułem,
 * nieco dłużej po nim), żeby nie sięgać po godzinę sąsiedniej pozycji programu.
 */
export function timeNearTitle(hour: number, minute: number, normText: string, title: string): boolean {
  const anchor = normalizeForQuote(title).slice(0, 24);
  for (let t = normText.indexOf(anchor); t >= 0; t = normText.indexOf(anchor, t + 1)) {
    if (timeInQuote(hour, minute, normText.slice(Math.max(0, t - 80), t + anchor.length + 160))) return true;
  }
  return false;
}

/** Dzień miesiąca z wartości występuje w cytacie (cyfrą). Chroni przed pomyloną datą. */
export function dayInQuote(day: number, quote: string): boolean {
  return new RegExp(`(?<!\\d)0?${day}(?!\\d)`).test(quote);
}

const NUMBER = /\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

/** Liczba występuje w cytacie: 25, 25,00, 25.5, „1 000”, „1,000”. */
export function numberInQuote(value: number, quote: string): boolean {
  for (const tok of quote.match(NUMBER) ?? []) {
    const clean = tok.replace(/[   ]/g, '');
    const candidates = [Number(clean.replace(',', '.'))];
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(clean)) candidates.push(Number(clean.replace(/[.,]/g, '')));
    if (candidates.some((c) => Math.abs(c - value) < 1e-9)) return true;
  }
  return false;
}

const FREE_WORDS = /woln|bezpłat|nieodpłat|darm|gratis|\bfree\b/i;
const ZERO = /(?<![\d:.,])0(?:[.,]0{1,2})?(?![\d:.,])/;

/** Cena 0 wymaga słów „wstęp wolny/bezpłatnie/free” albo samodzielnego zera w cytacie (nie „19:00”). */
export const freeInQuote = (quote: string) => FREE_WORDS.test(quote) || ZERO.test(quote);

const PL_MONTHS = ['stycz', 'lut', 'mar', 'kwie', 'maj', 'czerw', 'lip', 'sierp', 'wrze', 'październik|paźdz|paź', 'listop|lis', 'grud'];
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DATE_MENTION = new RegExp(
  String.raw`(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)|(?<![\d.])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d])|(?<!\d)(\d{1,2})\s+([a-ząćęłńóśźż]{3,})`,
  'giu',
);

function monthOf(word: string): number | null {
  const w = word.toLowerCase();
  const pl = PL_MONTHS.findIndex((m) => m.split('|').some((p) => w.startsWith(p)));
  if (pl >= 0) return pl + 1;
  const en = EN_MONTHS.findIndex((m) => w.startsWith(m));
  return en >= 0 ? en + 1 : null;
}

/** Wzmianki dat (dzień, miesiąc) z pozycją w tekście: 2026-10-18, 18.10, 18/10/2026, 18 października, 18 Oct. */
export function dateMentions(text: string): { index: number; day: number; month: number }[] {
  const out: { index: number; day: number; month: number }[] = [];
  // „19-10-2026” → „19.10.2026” (ta sama długość, więc pozycje się nie przesuwają). Tylko z rokiem —
  // „2-4” w adresie to numer domu, nie data.
  text = text.replace(/(?<!\d)(\d{1,2})-(\d{1,2})-(\d{4})(?!\d)/g, '$1.$2.$3');
  const headerMonths = monthHeaders(text);
  for (const m of text.matchAll(DATE_MENTION)) {
    let day: number;
    let month: number | null;
    if (m[1]) [day, month] = [Number(m[3]), Number(m[2])];
    else if (m[4]) [day, month] = [Number(m[4]), Number(m[5])];
    else {
      day = Number(m[7]);
      month = monthOf(m[8]!);
      // „18 niedziela” pod nagłówkiem „październik” — miesiąc z najbliższego wcześniejszego nagłówka.
      if (!month && WEEKDAY.test(m[8]!)) month = headerMonths.filter((h) => h.index < m.index!).at(-1)?.month ?? null;
    }
    if (month && month >= 1 && month <= 12 && day >= 1 && day <= 31) out.push({ index: m.index!, day, month });
  }
  return out;
}

const WEEKDAY = /^(poniedzia|wtor|środ|czwart|piąt|sobot|niedziel|pon$|wt$|śr$|czw$|pt$|sob$|nd$|niedz|mon|tue|wed|thu|fri|sat|sun)/i;
const MONTH_HEADER = /(?<![\p{L}])(stycze[nń]|luty|marzec|kwiecie[nń]|maj|czerwiec|lipiec|sierpie[nń]|wrzesie[nń]|październik|listopad|grudzie[nń])(?![\p{L}])/giu;

/** Pozycje nagłówków miesięcy (mianownik: „październik”) — kontekst dla dat w formie „18 niedziela”. */
function monthHeaders(text: string) {
  return [...text.matchAll(MONTH_HEADER)].map((m) => ({ index: m.index!, month: monthOf(m[1]!)! }));
}

/**
 * Czy data (dzień i miesiąc) wartości jest potwierdzona tekstem: w samym cytacie albo — gdy cytat to sama
 * godzina z listy programu („17:00” pod nagłówkiem „18.10 niedziela”) — jako NAJBLIŻSZA wcześniejsza
 * wzmianka daty przed którymkolwiek wystąpieniem cytatu (w obrębie 800 znaków).
 */
export function dateConfirmed(day: number, month: number, quote: string, normText: string, title?: string): boolean {
  const own = dateMentions(normalizeForQuote(quote));
  if (own.length) return own.some((d) => d.day === day && d.month === month);
  const q = normalizeForQuote(quote);
  const mentions = dateMentions(normText);
  // Ten sam cytat („19:00”) bywa przy wielu pozycjach — wymagamy też tytułu wydarzenia w pobliżu,
  // żeby model nie mógł przenieść daty z innej pozycji programu.
  const dateBefore = (pos: number) => mentions.filter((d) => d.index < pos && pos - d.index <= 800).at(-1);
  const matches = (d: { day: number; month: number } | undefined) => Boolean(d && d.day === day && d.month === month);
  if (!title) {
    for (let pos = normText.indexOf(q); pos >= 0; pos = normText.indexOf(q, pos + 1)) if (matches(dateBefore(pos))) return true;
    return false;
  }
  // Z tytułem: najbliższa data przed TYTUŁEM musi być tą datą, a cytat (godzina) — stać przy tytule.
  const anchor = normalizeForQuote(title).slice(0, 24);
  for (let t = normText.indexOf(anchor); t >= 0; t = normText.indexOf(anchor, t + 1)) {
    if (!matches(dateBefore(t))) continue;
    const near = normText.slice(Math.max(0, t - 300), t + anchor.length + 300);
    if (near.includes(q)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- tekst i linki strony

/** Widoczny tekst strony (bez skryptów, stylów i nawigacji) — materiał dla ekstrakcji i cytatów. */
export function visibleText(html: string): string {
  const { document } = parseHTML(html);
  for (const el of document.querySelectorAll('script, style, noscript, svg, nav, footer, header form')) el.remove();
  return (document.body?.textContent ?? '').replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** Linki do stron szczegółów (ta sama domena, ścieżka pasująca do wzorca). */
export function detailLinks(html: string, pageUrl: string, pattern: RegExp, max: number): string[] {
  const { document } = parseHTML(html);
  const base = new URL(pageUrl);
  const out = new Set<string>();
  for (const a of document.querySelectorAll('a[href]')) {
    try {
      const u = new URL(a.getAttribute('href')!, base);
      if (u.hostname !== base.hostname || !pattern.test(u.pathname) || u.pathname === base.pathname) continue;
      u.hash = '';
      out.add(u.toString());
    } catch {
      /* zły link */
    }
  }
  return [...out].slice(0, max);
}

