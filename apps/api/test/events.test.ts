/**
 * Wydarzenia, kluby i miejsca: parsery, czas (strefy, zmiana czasu), walidacja cytatami, filtry dat,
 * ranking oraz API (lokalna baza, bez sieci).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { dateConfirmed, elementToPlace, normalizeForQuote, OSM_SELECTORS, parseHtmlEvents, parseIcsEvents, placesQuery, type RawEvent } from '@readyou/providers';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  /* zmienne mogą pochodzić z CI */
}
process.env.NODE_ENV = 'test';
process.env.EMAIL_PROVIDER = 'disabled';

const { toInstant, normalizeEvent, validateExtracted, cityFromAddress, fixSeriesEnds } = await import('../src/engine/events.ts');
const { rangeWindow, inWindow, timeFit, budgetFit, isLongRunningSeries } = await import('../src/services/events.ts');
const { cityKey } = await import('../src/engine/event-sources.ts');

const TZ = 'Europe/Warsaw';
const raw = (over: Partial<RawEvent> = {}): RawEvent => ({
  key: null,
  title: 'Turniej szachowy',
  description: null,
  startsAt: '2026-10-20T18:00',
  endsAt: null,
  timezone: null,
  rrule: null,
  venueName: null,
  address: null,
  locality: null,
  online: false,
  priceMin: null,
  priceMax: null,
  currency: null,
  free: false,
  url: 'https://org.example/e/1',
  registrationUrl: null,
  registrationEndsAt: null,
  availability: null,
  organizer: null,
  imageUrl: null,
  status: null,
  method: 'json-ld',
  ...over,
});
const NOW = new Date('2026-10-18T10:00:00Z');

describe('parsery wydarzeń', () => {
  it('JSON-LD: Event w @graph, miejsce, cena, koniec zapisów, online', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@graph': [
        { '@type': 'WebPage', name: 'x' },
        {
          '@type': 'MusicEvent',
          name: 'Koncert &amp; jam',
          startDate: '2026-10-24T20:00:00+02:00',
          location: { '@type': 'Place', name: 'Klub', address: { streetAddress: 'Rynek 1', postalCode: '31-010', addressLocality: 'Kraków' } },
          offers: { price: '40', priceCurrency: 'PLN', validThrough: '2026-10-23', url: '/bilety' },
        },
        { '@type': 'Event', name: 'Webinar', startDate: '2026-10-25', eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode', isAccessibleForFree: true },
      ],
    })}</script><script type="application/ld+json">{zły json</script>`;
    const [a, b] = parseHtmlEvents(html, 'https://org.example/program');
    expect(a).toMatchObject({ title: 'Koncert & jam', venueName: 'Klub', locality: 'Kraków', priceMin: 40, currency: 'PLN', registrationEndsAt: '2026-10-23', registrationUrl: 'https://org.example/bilety' });
    expect(b).toMatchObject({ title: 'Webinar', online: true, free: true, priceMin: null });
    const [enc] = parseHtmlEvents(`<script type="application/ld+json">{"@type":"Event","name":"Dimash","description":"&lt;p&gt;Arena Główna&lt;/p&gt;\\n"}</script>`, 'https://x.example');
    expect(enc!.description).toBe('Arena Główna');
  });

  it('iCalendar: zawijanie linii, TZID, data całodniowa, odwołane', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nSUMMARY:Długi\r\n  tytuł\r\nDTSTART;TZID=Europe/Warsaw:20261024T193000\r\nLOCATION:Klub Studio\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Cały dzień\r\nDTSTART;VALUE=DATE:20261025\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR';
    const [a, b] = parseIcsEvents(ics, 'https://x.example/cal.ics');
    expect(a).toMatchObject({ title: 'Długi tytuł', startsAt: '2026-10-24T19:30:00', timezone: 'Europe/Warsaw', venueName: 'Klub Studio' });
    expect(b).toMatchObject({ startsAt: '2026-10-25', status: 'EventCancelled' });
  });

  it('OSM: element → klub, cena z tagu, „fee=no” = wstęp wolny; zapytanie po obszarze miasta', () => {
    const place = elementToPlace({ type: 'node', id: 1, lat: 50, lon: 19, tags: { name: 'Szkoła tańca X', leisure: 'dance', website: 'x.pl', 'addr:street': 'Długa', 'addr:housenumber': '5', charge: '30 zł' } }, OSM_SELECTORS.dance!);
    expect(place).toMatchObject({ kind: 'club', category: 'Szkoła lub sala tańca', website: 'https://x.pl', address: 'Długa 5', priceMin: 30 });
    expect(elementToPlace({ type: 'node', id: 2, lat: 1, lon: 1, tags: { leisure: 'dance' } }, OSM_SELECTORS.dance!)).toBeNull(); // bez nazwy
    expect(placesQuery('Kraków', OSM_SELECTORS.dance!)).toContain('area["name"="Kraków"]["admin_level"="8"]');
  });
});

describe('czas wydarzeń', () => {
  it('czas lokalny bez przesunięcia uwzględnia zmianę czasu (25.10.2026: CEST → CET)', () => {
    expect(toInstant('2026-10-24T19:00', TZ)!.at.toISOString()).toBe('2026-10-24T17:00:00.000Z');
    expect(toInstant('2026-10-26T19:00', TZ)!.at.toISOString()).toBe('2026-10-26T18:00:00.000Z');
    expect(toInstant('2026-10-25', TZ)).toMatchObject({ allDay: true });
    expect(toInstant('2026-10-24T19:00:00+02:00', TZ)!.at.toISOString()).toBe('2026-10-24T17:00:00.000Z');
    expect(toInstant('nie data', TZ)).toBeNull();
  });

  it('normalizacja: odrzuca zakończone i odwołane; nieznana cena ≠ bezpłatne; miasto z adresu', () => {
    expect(normalizeEvent(raw({ startsAt: '2026-10-17T18:00' }), { sourcePage: 'p', sourceCity: 'Kraków', now: NOW })).toBeNull();
    expect(normalizeEvent(raw({ status: 'EventCancelled' }), { sourcePage: 'p', sourceCity: 'Kraków', now: NOW })).toBeNull();
    const e = normalizeEvent(raw(), { sourcePage: 'p', sourceCity: 'Kraków', now: NOW })!;
    expect(e).toMatchObject({ priceMin: null, free: false, currency: null, city: 'Kraków' });
    const sacz = normalizeEvent(raw({ address: 'Batorego 23, 33-340 Stary Sącz' }), { sourcePage: 'p', sourceCity: null, now: NOW })!;
    expect(sacz.city).toBe('Stary Sącz');
    expect(cityFromAddress('Rynek Glówny 28, 31-010 Kraków')).toBe('Kraków');
    expect(cityFromAddress('Nadwiślańska 2-4')).toBeNull();
  });

  it('bez terminu — tylko z przyszłym końcem zapisów; koniec całodniowy JSON-LD włącznie', () => {
    expect(normalizeEvent(raw({ startsAt: null }), { sourcePage: 'p', sourceCity: 'Kraków', now: NOW })).toBeNull();
    const reg = normalizeEvent(raw({ startsAt: null, registrationEndsAt: '2026-10-22T23:59' }), { sourcePage: 'p', sourceCity: 'Kraków', now: NOW })!;
    expect(reg.registrationEndsAt!.toISOString()).toBe('2026-10-22T21:59:00.000Z');
    const multi = normalizeEvent(raw({ startsAt: '2026-10-17', endsAt: '2026-10-18' }), { sourcePage: 'p', sourceCity: 'Kraków', now: NOW })!;
    expect(multi.endsAt!.toISOString()).toBe('2026-10-18T22:00:00.000Z'); // do końca 18.10 lokalnie
  });

  it('cykl sesji z tym samym końcem cyklu: sesje stają się jednodniowe', () => {
    const series = fixSeriesEnds([raw({ title: 'Jam', startsAt: '2026-10-06', endsAt: '2026-11-07' }), raw({ title: 'Jam', startsAt: '2026-10-13', endsAt: '2026-11-07' }), raw({ title: 'Wystawa', startsAt: '2026-10-01', endsAt: '2026-11-30' })]);
    expect(series.map((e) => e.endsAt)).toEqual([null, null, '2026-11-30']);
  });
});

describe('walidacja ekstrakcji AI cytatami', () => {
  const page = 'Repertuar październik › 18 niedziela 17:00 Duża scena FOLWARK ZWIERZĘCY kup bilet 19:00 TRAMWAJ ZWANY POŻĄDANIEM 23 piątek 19:00 CALINECZKA bilety 40 zł. Wstęp wolny na próbę otwartą.';
  const f = (value: string | null, quote: string | null) => ({ value, quote });
  const ev = (over: Record<string, unknown>) => ({
    title: f('FOLWARK ZWIERZĘCY', 'FOLWARK ZWIERZĘCY'),
    description: f(null, null),
    starts_at: f('2026-10-18T17:00', '17:00'),
    ends_at: f(null, null),
    venue_name: f(null, null),
    address: f(null, null),
    city: f(null, null),
    online: { value: null, quote: null },
    price_min: { value: null, quote: null },
    price_max: { value: null, quote: null },
    registration_ends_at: f(null, null),
    ...over,
  });

  it('godzina z cytatu i data z nagłówka programu przy tytule wydarzenia', () => {
    const v = validateExtracted(ev({}) as never, page, 'https://t.example', TZ);
    expect(v.rejected).toEqual({});
    expect(v.raw).toMatchObject({ title: 'FOLWARK ZWIERZĘCY', startsAt: '2026-10-18T17:00', method: 'llm-quotes' });
  });

  it('odrzuca: cytat spoza tekstu, inną godzinę, datę z innej pozycji, cenę bez liczby w cytacie', () => {
    const v = validateExtracted(
      ev({
        starts_at: f('2026-10-18T18:00', '17:00'),
        venue_name: f('Mała scena', 'Mała scena'),
        price_min: { value: 50, quote: 'bilety 40 zł' },
      }) as never,
      page,
      'https://t.example',
      TZ,
    );
    expect(v.rejected).toMatchObject({ starts_at: 'quote_mismatch', venue_name: 'quote_not_found', price_min: 'quote_mismatch' });
    // CALINECZKA jest 23.10 — model nie może przypisać jej daty 18.10, choć „19:00” stoi też pod 18.10.
    const wrong = validateExtracted(ev({ title: f('CALINECZKA', 'CALINECZKA'), starts_at: f('2026-10-18T19:00', '19:00') }) as never, page, 'https://t.example', TZ);
    expect(wrong.rejected.starts_at).toBe('quote_mismatch');
    const right = validateExtracted(ev({ title: f('CALINECZKA', 'CALINECZKA'), starts_at: f('2026-10-23T19:00', '19:00') }) as never, page, 'https://t.example', TZ);
    expect(right.rejected).toEqual({});
  });

  it('cytat z samą datą: godzina potwierdzona tuż przy tytule, ale nie z sąsiedniej pozycji', () => {
    const list = 'Wszystkie 23.10 2026 FOKUS & RAHIM wejście: 19:00 start: 20:00 cena od: 95 zł 25.10 2026 NASI KAJDASZI wejście: 18:00 start: 19:00';
    const ok = validateExtracted(ev({ title: f('FOKUS & RAHIM', 'FOKUS & RAHIM'), starts_at: f('2026-10-23T20:00', '23.10 2026') }) as never, list, 'https://k.example', TZ);
    expect(ok.rejected).toEqual({});
    const bad = validateExtracted(ev({ title: f('FOKUS & RAHIM', 'FOKUS & RAHIM'), starts_at: f('2026-10-23T21:00', '23.10 2026') }) as never, list, 'https://k.example', TZ);
    expect(bad.rejected.starts_at).toBe('quote_mismatch');
  });

  it('cena 0 tylko z cytatem o wolnym wstępie; tytuł spoza tekstu = brak wydarzenia', () => {
    const free = validateExtracted(ev({ price_min: { value: 0, quote: 'Wstęp wolny' } }) as never, page, 'https://t.example', TZ);
    expect(free.raw).toMatchObject({ priceMin: 0, free: true });
    expect(validateExtracted(ev({ title: f('Zmyślony koncert', 'Zmyślony koncert') }) as never, page, 'https://t.example', TZ).raw).toBeNull();
    expect(dateConfirmed(19, 10, '19-10-2026, godz. 10:30', normalizeForQuote('19-10-2026, godz. 10:30 Bajki'))).toBe(true);
  });
});

describe('filtry dat i ranking', () => {
  it('„Dzisiaj” = półotwarty lokalny dzień; tydzień kończy się w poniedziałek 00:00 lokalnie', () => {
    const w = rangeWindow('today', TZ, NOW);
    expect(w.from.toISOString()).toBe('2026-10-17T22:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-10-18T22:00:00.000Z');
    const week = rangeWindow('week', TZ, new Date('2026-10-24T10:00:00Z'));
    expect(week.to.toISOString()).toBe('2026-10-25T23:00:00.000Z'); // po zmianie czasu: CET (+1)
  });

  it('trwające wydarzenie należy do „Dzisiaj”; zakończone nie; bez końca — założone 3 h', () => {
    const w = rangeWindow('today', TZ, NOW);
    const at = (s: string) => new Date(s);
    expect(inWindow({ startsAt: at('2026-10-16T10:00:00Z'), endsAt: at('2026-10-20T10:00:00Z'), allDay: false, timezone: TZ }, w, NOW)).toBe(true);
    expect(inWindow({ startsAt: at('2026-10-18T05:00:00Z'), endsAt: null, allDay: false, timezone: TZ }, w, NOW)).toBe(false); // 05:00 + 3 h < 10:00
    expect(inWindow({ startsAt: at('2026-10-18T09:00:00Z'), endsAt: null, allDay: false, timezone: TZ }, w, NOW)).toBe(true);
    expect(inWindow({ startsAt: at('2026-10-18T22:00:00Z'), endsAt: null, allDay: false, timezone: TZ }, w, NOW)).toBe(false); // jutro lokalnie
  });

  it('cykl kwiecień–grudzień bez sesji nie jest „dziś”; długa wystawa — tak', () => {
    const span = { startsAt: new Date('2026-04-17T00:00:00Z'), endsAt: new Date('2026-12-18T00:00:00Z') };
    expect(isLongRunningSeries({ ...span, title: 'Planszówki w bibliotece', description: 'Cykliczne spotkania' })).toBe(true);
    expect(isLongRunningSeries({ ...span, title: 'Godność osoby ludzkiej', description: 'Plenerowa wystawa' })).toBe(false);
    expect(isLongRunningSeries({ startsAt: new Date('2026-10-16T10:00:00Z'), endsAt: new Date('2026-10-20T10:00:00Z'), title: 'Konferencja', description: null })).toBe(false);
  });

  it('budżet: nieznana cena nie jest „za darmo”, przekroczenie obniża, ale nie wyklucza', () => {
    expect(budgetFit(null, 50)).toMatchObject({ label: 'Cena nieznana' });
    expect(budgetFit({ min: 0, free: true }, 0)).toMatchObject({ score: 1, label: 'Wstęp wolny' });
    expect(budgetFit({ min: 80, free: false }, 50)).toMatchObject({ score: 0.2 });
    expect(budgetFit({ min: 40, free: false }, 50)).toMatchObject({ score: 1 });
  });

  it('dostępność: dzień i pora; całodniowe bez potwierdzenia godziny', () => {
    const p = { available_days: ['sat'], available_slots: ['evening'] };
    expect(timeFit({ startsAt: new Date('2026-10-24T18:00:00Z'), allDay: false, timezone: TZ }, p)).toMatchObject({ ok: true });
    expect(timeFit({ startsAt: new Date('2026-10-24T08:00:00Z'), allDay: false, timezone: TZ }, p)).toMatchObject({ ok: false });
    expect(timeFit({ startsAt: new Date('2026-10-23T22:00:00Z'), allDay: true, timezone: TZ }, p)).toMatchObject({ ok: null });
  });
});

describe('wydarzenia przez API', () => {
  const ORIGIN = 'http://localhost:5173';
  const host = `ev-${randomUUID().slice(0, 8)}.example`;
  let app: FastifyInstance;
  let db: typeof import('../src/db.ts').db;
  const users: { cookie: string; id: string }[] = [];
  const ids: Record<string, string> = {};

  const call = (u: { cookie: string }, method: 'GET' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { cookie: u.cookie, origin: ORIGIN, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: payload as object | undefined });

  async function addEvent(name: string, startsAt: Date | null, extra: { city?: string | null; online?: boolean; registration?: Date | null } = {}) {
    const row = await db
      .insertInto('content_item')
      .values({ kind: 'event', canonical_url: `https://${host}/${name}`, url: `https://${host}/${name}`, source_domain: host, title: name, discovered_via: 'organizer', status: 'extracted', created_at: new Date(), updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('event_details')
      .values({
        content_id: row.id,
        starts_at: startsAt,
        city: extra.city === undefined ? 'Kraków' : extra.city,
        city_normalized: extra.city === undefined ? 'krakow' : extra.city ? cityKey(extra.city) : null,
        online: extra.online ?? false,
        registration_ends_at: extra.registration ?? null,
        method: 'json-ld',
        quotes: '{}',
        source_page: `https://${host}/program`,
        verified_at: new Date(),
      })
      .execute();
    ids[name] = row.id;
  }

  beforeAll(async () => {
    const { buildServer } = await import('../src/server.ts');
    ({ db } = await import('../src/db.ts'));
    app = await buildServer();
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        payload: { name: 'Test', email: `e-${randomUUID()}@example.com`, password: 'testowehaslo123' },
      });
      const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
      const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
      users.push({ cookie, id: me.json().user.id });
    }
    expect((await call(users[0]!, 'PATCH', '/api/me/profile', { city: 'Kraków' })).statusCode).toBe(200);
    expect((await call(users[1]!, 'PATCH', '/api/me/profile', { city: 'Gdańsk' })).statusCode).toBe(200);
    const soon = new Date(Date.now() + 2 * 3_600_000);
    await addEvent('dzis-krakow', soon);
    await addEvent('dzis-gdansk', soon, { city: 'Gdańsk' });
    await addEvent('dzis-online', soon, { city: null, online: true });
    await addEvent('zakonczone', new Date(Date.now() - 5 * 3_600_000));
    await addEvent('za-miesiac-zapisy', new Date(Date.now() + 30 * 86_400_000), { registration: new Date(Date.now() + 3 * 86_400_000) });
  });

  afterAll(async () => {
    for (const u of users) await call(u, 'DELETE', '/api/me');
    if (db) {
      await db.deleteFrom('job').where((eb) => eb.or(Object.values(ids).map((id) => eb('dedupe_key', 'like', `%${id}%`)))).execute();
      await db.deleteFrom('content_item').where('source_domain', '=', host).execute();
    }
    await app?.close();
    const { pool } = await import('../src/db.ts');
    await pool.end();
  });

  const titles = async (u: { cookie: string }, range: string) =>
    ((await call(u, 'GET', `/api/feed/events?range=${range}`)).json().items as { title: string }[]).map((i) => i.title).filter((t) => Object.keys(ids).includes(t));

  it('„Dzisiaj”: tylko własne miasto i online, bez zakończonych; szczegóły i uzasadnienie', async () => {
    expect(new Set(await titles(users[0]!, 'today'))).toEqual(new Set(['dzis-krakow', 'dzis-online']));
    expect(await titles(users[1]!, 'today')).toEqual(expect.arrayContaining(['dzis-gdansk', 'dzis-online']));
    expect(await titles(users[1]!, 'today')).not.toContain('dzis-krakow');
    const item = (await call(users[0]!, 'GET', '/api/feed/events?range=today')).json().items.find((i: { title: string }) => i.title === 'dzis-krakow');
    expect(item.event).toMatchObject({ price: null, city: 'Kraków', method: 'json-ld' });
    expect(item.why.reasons).toContain('Cena nieznana');
  });

  it('„Nadchodzące”: wydarzenie za miesiąc z zapisami kończącymi się w tym tygodniu', async () => {
    const res = (await call(users[0]!, 'GET', '/api/feed/events?range=upcoming')).json();
    const item = res.items.find((i: { title: string }) => i.title === 'za-miesiac-zapisy');
    expect(item.why.reasons.some((r: string) => r.startsWith('Zapisy do'))).toBe(true);
  });

  it('zapisane wydarzenia osobno od „Twoich artykułów”; pominięcie ukrywa tylko u tej osoby', async () => {
    await call(users[0]!, 'PUT', `/api/me/content/${ids['dzis-online']}/state`, { liked: true });
    const saved = (await call(users[0]!, 'GET', '/api/me/saved')).json().items.map((i: { id: string }) => i.id);
    expect(saved).toContain(ids['dzis-online']);
    const articles = (await call(users[0]!, 'GET', '/api/me/articles?state=liked-unread')).json().items.map((i: { id: string }) => i.id);
    expect(articles).not.toContain(ids['dzis-online']);
    expect((await call(users[1]!, 'GET', '/api/me/saved')).json().items).toHaveLength(0);
    await call(users[0]!, 'PUT', `/api/me/content/${ids['dzis-krakow']}/state`, { skipped: true });
    expect(await titles(users[0]!, 'today')).not.toContain('dzis-krakow');
    expect(await titles(users[1]!, 'today')).toContain('dzis-online');
  });

  it('osoba bez miasta: tylko wydarzenia online i podpowiedź, bez błędu', async () => {
    await call(users[1]!, 'PATCH', '/api/me/profile', { city: null });
    const res = await call(users[1]!, 'GET', '/api/feed/events?range=today');
    expect(res.statusCode).toBe(200);
    expect(res.json().notice).toMatch(/Ustaw miasto/);
    expect(await titles(users[1]!, 'today')).toEqual(['dzis-online']);
    expect((await call(users[1]!, 'GET', '/api/feed/events?range=places')).statusCode).toBe(200);
  });

  it('walidacja zakresu', async () => {
    expect((await call(users[0]!, 'GET', '/api/feed/events?range=jutro')).statusCode).toBe(400);
  });
});
