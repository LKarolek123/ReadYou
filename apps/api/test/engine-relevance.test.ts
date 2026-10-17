/**
 * Reguła trafności (czyste funkcje na wektorach testowych) i twardy limit zapytań dostawcy (baza).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  /* zmienne mogą pochodzić z CI */
}
process.env.NODE_ENV = 'test';

const { relevance, NEWS_DESKS, SOURCE_PRIOR } = await import('../src/engine/relevance.ts');
const { reserveCall } = await import('../src/engine/usage.ts');
const { db, pool } = await import('../src/db.ts');

// Wektory w 4 wymiarach: [tech, hackathon, polityka, szachy] — znormalizowane ręcznie nie trzeba (kosinus).
const v = (...xs: number[]) => xs;
const desks = { model: 'test', vectors: NEWS_DESKS.map((_, i) => (i === 0 ? v(0, 0, 1, 0) : v(0, 0, 0.2, 0))) };
const tech = { id: 'tech', label: 'Informatyka i technologia', nodeKey: 'tech', vector: v(1, 0, 0, 0), ancestors: [] };
const hack = { id: 'hack', label: 'Hackathony', nodeKey: 'tech.hackathons', vector: v(1, 0.6, 0, 0), ancestors: [v(1, 0, 0, 0)] };
const chess = { id: 'chess', label: 'Szachy', nodeKey: 'games.chess', vector: v(0, 0, 0, 1), ancestors: [v(0.2, 0, 0, 1)] };

describe('reguła trafności', () => {
  it('treść polityczna przegrywa z działem newsowym', () => {
    const r = relevance(v(0.2, 0, 1, 0), [tech, chess], desks);
    expect(r.margin).toBeLessThan(0);
  });

  it('ogólny news technologiczny nie trafia do liścia „Hackathony” bez słowa-dowodu', () => {
    const gadget = v(1, 0.5, 0, 0); // wektorowo bliżej liścia niż rodzica
    const r = relevance(gadget, [hack], desks, null, 'Nowy smartfon z ekranem 144 Hz');
    expect(r.interestId).toBeNull();
    expect(r.looseMargin).toBeGreaterThan(0); // ale jest „sąsiedni” — kandydat do odkrywania
  });

  it('z dowodem słownym liść jest przypisany', () => {
    const r = relevance(v(1, 0.5, 0, 0), [hack], desks, null, 'Zapisy na HackYeah 2026 ruszyły');
    expect(r.interestId).toBe('hack');
    expect(r.margin).toBeGreaterThan(0);
  });

  it('bez dowodu treść wraca do wybranego rodzica', () => {
    const r = relevance(v(1, 0.5, 0, 0), [tech, hack], desks, null, 'Nowy smartfon');
    expect(r.interestId).toBe('tech');
  });

  it('liść musi być bliżej niż jego przodek', () => {
    const generic = v(1, 0.05, 0, 0);
    const r = relevance(generic, [hack], desks, null, 'hackathon'); // dowód jest, ale treść bliżej rodzica
    expect(r.margin).toBeLessThan(0);
    expect(r.rival).toBe('rodzic zainteresowania');
  });

  it('kanał tematyczny daje bonus i zastępuje dowód słowny', () => {
    const item = v(0.1, 0, 0.1, 1);
    const plain = relevance(item, [chess], desks, null, 'Nakamura bije rekord');
    const fromFeed = relevance(item, [chess], desks, 'https://www.chess.com/rss/news', 'Nakamura bije rekord');
    expect(fromFeed.interestId).toBe('chess');
    expect(fromFeed.prior).toBe(SOURCE_PRIOR);
    expect(plain.interestId).toBe('chess'); // „Nakamura” jest na liście dowodów szachowych
    expect(fromFeed.margin - plain.margin).toBeCloseTo(SOURCE_PRIOR);
  });

  it('tagi ze streszczenia rozstrzygają przypisanie (piłka nożna ≠ siatkówka)', () => {
    const volley = { id: 'v', label: 'Siatkówka', nodeKey: 'sport.volleyball', vector: v(0, 0, 0, 1), ancestors: [] };
    const football = { id: 'f', label: 'Piłka nożna', nodeKey: 'sport.football', vector: v(0, 0, 0.1, 1), ancestors: [] };
    const sport = { id: 's', label: 'Sport', nodeKey: 'sport', vector: v(0, 0, 0.3, 1), ancestors: [] };
    const item = v(0, 0, 0, 1); // wektorowo najbliżej siatkówki
    expect(relevance(item, [volley, football], desks).interestId).toBe('v');
    expect(relevance(item, [volley, football], desks, null, 'Liga Mistrzów', ['sport.football']).interestId).toBe('f');
    expect(relevance(item, [volley, sport], desks, null, 'Liga Mistrzów', ['sport.football']).interestId).toBe('s');
    // Tag ogólniejszy (auto.ev) przy zainteresowaniu „Tesla” — decyduje dowód słowny.
    expect(relevance(v(1, 0.5, 0, 0), [{ ...hack, nodeKey: 'auto.ev.tesla' }], desks, null, 'Nowe auto elektryczne BYD', ['auto.ev']).interestId).toBeNull();
    expect(relevance(v(1, 0.5, 0, 0), [{ ...hack, nodeKey: 'auto.ev.tesla' }], desks, null, 'Tesla Model Y', ['auto.ev']).interestId).toBe('hack');
  });

  it('błędny tag AI nie wyklucza treści z niezależnym dowodem (kanał tematyczny)', () => {
    const r = relevance(v(0.1, 0, 0.1, 1), [chess], desks, 'https://www.chess.com/rss/news', 'Judit Polgar symultana', ['sport.volleyball']);
    expect(r.interestId).toBe('chess');
  });

  it('przy tagach własne zainteresowanie wymaga wzmianki w tekście', () => {
    const custom = { id: 'g', label: 'giełda', nodeKey: null, vector: v(1, 0, 0, 0), ancestors: [] };
    expect(relevance(v(1, 0, 0, 0), [custom], desks, null, 'Technologie kwantowe', ['science.physics']).interestId).toBeNull();
    expect(relevance(v(1, 0, 0, 0), [custom], desks, null, 'Notowania na giełdzie w Warszawie', ['business.markets']).interestId).toBe('g');
  });

  it('dział pokrywający się z zainteresowaniem nie jest dla niego konkurencją', () => {
    const sportDesk = NEWS_DESKS.findIndex((d) => d.overlaps.includes('sport'));
    const sportDesks = { model: 'test', vectors: NEWS_DESKS.map((_, i) => (i === sportDesk ? v(0, 0, 0, 1) : v(0, 0, 1, 0))) };
    const football = { id: 'f', label: 'Piłka nożna', nodeKey: 'sport.football', vector: v(0, 0, 0, 1), ancestors: [] };
    expect(relevance(v(0, 0, 0, 1), [football], sportDesks).margin).toBeGreaterThan(0);
  });
});

describe('twardy limit płatnego dostawcy', () => {
  const provider = `test-${randomUUID().slice(0, 8)}`;
  afterAll(async () => {
    await db.deleteFrom('provider_usage').where('provider', '=', provider).execute();
    await pool.end();
  });

  it('równoległe rezerwacje nie przekraczają limitu dziennego', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => reserveCall(provider, { daily: 5, monthly: 100 })));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await reserveCall(provider, { daily: 5, monthly: 100 })).toBe(false);
  });

  it('limit miesięczny też obowiązuje', async () => {
    expect(await reserveCall(provider, { daily: 100, monthly: 5 })).toBe(false);
  });
});
