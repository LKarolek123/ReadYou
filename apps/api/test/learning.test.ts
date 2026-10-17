/**
 * Uczenie z interakcji: czyste reguły oraz przebieg przez API (lokalna baza).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ItemSignals } from '../src/engine/learning.ts';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  /* zmienne mogą pochodzić z CI */
}
process.env.NODE_ENV = 'test';
process.env.EMAIL_PROVIDER = 'disabled';

// Moduły czytają konfigurację przy imporcie — dopiero po wczytaniu .env.
const { capFor, exclusionFilter } = await import('../src/engine/pool.ts');
const { itemContribution, learnTopics, mostSpecific } = await import('../src/engine/learning.ts');

const NOW = Date.parse('2026-10-18T12:00:00Z');
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000);
const sig = (id: string, nodes: string[], s: Partial<ItemSignals> = {}): ItemSignals => ({
  contentId: id,
  nodes,
  likedAt: null,
  readAt: null,
  sourceClickAt: null,
  summaryOpenAt: null,
  ...s,
});
const none = () => false;

describe('reguły uczenia (czyste funkcje)', () => {
  it('zostawia najbardziej szczegółowe tagi', () => {
    expect(mostSpecific(['auto.ev', 'auto.ev.tesla', 'auto'])).toEqual(['auto.ev.tesla']);
    expect(mostSpecific(['games.chess', 'tech.ai', 'nieznany.tag'])).toEqual(['games.chess', 'tech.ai']);
  });

  it('jedno polubienie = ukryty temat z małą wagą; trzy różne = widoczny tag', () => {
    const one = learnTopics([sig('a', ['auto.ev.tesla'], { likedAt: at(0) })], none, NOW);
    expect(one).toEqual([expect.objectContaining({ nodeKey: 'auto.ev.tesla', visible: false, weight: 0.3, likedItems: 1 })]);
    const three = learnTopics(['a', 'b', 'c'].map((id) => sig(id, ['auto.ev.tesla'], { likedAt: at(1) })), none, NOW);
    expect(three[0]).toMatchObject({ visible: true, likedItems: 3 });
    expect(three[0]!.weight).toBeGreaterThanOrEqual(0.5);
  });

  it('słabe sygnały bez polubienia nie tworzą tematu; pominięcie w ogóle nie jest sygnałem', () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => sig(id, ['tech.hackathons'], { summaryOpenAt: at(0), sourceClickAt: at(0), readAt: at(0) }));
    expect(learnTopics(items, none, NOW)).toEqual([]);
  });

  it('wkład pozycji jest ograniczony i wygasa w czasie', () => {
    const all = sig('a', ['x'], { likedAt: at(0), readAt: at(0), sourceClickAt: at(0), summaryOpenAt: at(0) });
    expect(itemContribution(all, NOW)).toBeCloseTo(1.5);
    expect(itemContribution(sig('a', ['x'], { likedAt: at(21) }), NOW)).toBeCloseTo(Math.exp(-21 / 30));
    // Stare polubienia wygaszają temat.
    expect(learnTopics([sig('a', ['auto.ev.tesla'], { likedAt: at(60) })], none, NOW)).toEqual([]);
    const fading = learnTopics(['a', 'b', 'c'].map((id) => sig(id, ['auto.ev.tesla'], { likedAt: at(40) })), none, NOW);
    expect(fading[0]).toMatchObject({ visible: false }); // trzy polubienia, ale dawno — z powrotem tylko sygnał ukryty
  });

  it('zablokowany węzeł (wykluczony lub pokryty jawnym wyborem) nie jest uczony', () => {
    const items = ['a', 'b', 'c'].map((id) => sig(id, ['auto.ev.tesla', 'games.chess'], { likedAt: at(0) }));
    const out = learnTopics(items, (n) => n === 'auto.ev.tesla', NOW);
    expect(out.map((t) => t.nodeKey)).toEqual(['games.chess']);
  });

  it('świeżo wyuczony temat dostaje najwyżej jedną pozycję w puli', () => {
    expect(capFor({ interestWeight: 0.3 }, 4)).toBe(1);
    expect(capFor({ interestWeight: 1 }, 4)).toBe(4);
    expect(capFor({}, 4)).toBe(4);
  });

  it('filtr wykluczeń: poddrzewo węzła, słowa-dowody i własne etykiety', () => {
    const f = exclusionFilter([
      { node_key: 'auto.ev.tesla', label: 'Tesla (samochody)' },
      { node_key: null, label: 'Kryptowaluty' },
    ]);
    expect(f('Nowy model', ['auto.ev.tesla'])).toBe(true);
    expect(f('Cybertruck z aktualizacją', [])).toBe(true);
    expect(f('Kurs: kryptowaluty spadają', [])).toBe(true);
    expect(f('Turniej szachowy w Krakowie', ['games.chess'])).toBe(false);
  });
});

describe('uczenie przez API', () => {
  const ORIGIN = 'http://localhost:5173';
  const host = `learn-${randomUUID().slice(0, 8)}.example`;
  let app: FastifyInstance;
  let db: typeof import('../src/db.ts').db;
  let user: { cookie: string; id: string };
  const tesla: string[] = [];

  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { cookie: user.cookie, origin: ORIGIN, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: payload as object | undefined });
  const learned = async () =>
    db.selectFrom('user_interest').select(['label', 'visible', 'weight', 'state', 'learned_items']).where('user_id', '=', user.id).where('node_key', '=', 'auto.ev.tesla').executeTakeFirst();
  const visibleLabels = async () => (await call('GET', '/api/me/interests')).json().map((i: { label: string }) => i.label);

  beforeAll(async () => {
    const { buildServer } = await import('../src/server.ts');
    ({ db } = await import('../src/db.ts'));
    app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { name: 'Test', email: `l-${randomUUID()}@example.com`, password: 'testowehaslo123' },
    });
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
    user = { cookie, id: '' };
    user.id = (await call('GET', '/api/me')).json().user.id;
    expect((await call('POST', '/api/me/interests', { label: 'Szachy' })).statusCode).toBe(201);
    for (let i = 0; i < 4; i++) {
      const row = await db
        .insertInto('content_item')
        .values({ canonical_url: `https://${host}/t${i}`, url: `https://${host}/t${i}`, source_domain: host, title: `Artykuł ${i}`, discovered_via: 'feed', status: 'extracted', created_at: new Date(), updated_at: new Date() })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('summary')
        .values({ content_id: row.id, source_hash: 'h', prompt_version: 'test', model: 'test', sufficient: true, summary: 'x', key_facts: '[]', caveats: '[]', tags: ['auto.ev', 'auto.ev.tesla'], basis: 'full', created_at: new Date() })
        .execute();
      tesla.push(row.id);
    }
  });

  afterAll(async () => {
    if (user?.id) await call('DELETE', '/api/me');
    if (db) {
      await db.deleteFrom('job').where('dedupe_key', 'like', `%${user.id}%`).execute();
      await db.deleteFrom('content_item').where('source_domain', '=', host).execute();
    }
    await app?.close();
    const { pool } = await import('../src/db.ts');
    await pool.end();
  });

  it('polubienia nowego tematu: ukryty sygnał → widoczny tag po trzech różnych pozycjach', async () => {
    await call('PUT', `/api/me/content/${tesla[0]}/state`, { liked: true });
    expect(await learned()).toMatchObject({ state: 'learned', visible: false, weight: 0.3 });
    expect(await visibleLabels()).not.toContain('Tesla (samochody)');
    // Wielokrotne kliknięcie tego samego serca nie zwiększa wagi.
    for (let i = 0; i < 3; i++) await call('PUT', `/api/me/content/${tesla[0]}/state`, { liked: true });
    expect(await learned()).toMatchObject({ learned_items: 1, weight: 0.3 });
    await call('PUT', `/api/me/content/${tesla[1]}/state`, { liked: true });
    await call('PUT', `/api/me/content/${tesla[2]}/state`, { liked: true });
    expect(await learned()).toMatchObject({ visible: true, learned_items: 3 });
    expect(await visibleLabels()).toContain('Tesla (samochody)');
  });

  it('cofnięcie polubienia wycofuje dokładnie jego wkład (bez uznania tematu za nielubiany)', async () => {
    await call('PUT', `/api/me/content/${tesla[2]}/state`, { liked: false });
    expect(await learned()).toMatchObject({ visible: false, learned_items: 2 });
    const excluded = await db.selectFrom('user_interest').select('id').where('user_id', '=', user.id).where('state', '=', 'excluded').execute();
    expect(excluded).toHaveLength(0);
  });

  it('pominięcie i otwarcie streszczenia nie tworzą tematu', async () => {
    await call('PUT', `/api/me/content/${tesla[0]}/state`, { liked: false });
    await call('PUT', `/api/me/content/${tesla[1]}/state`, { liked: false });
    expect(await learned()).toBeUndefined();
    await call('PUT', `/api/me/content/${tesla[3]}/state`, { skipped: true });
    await call('POST', '/api/interactions', { contentId: tesla[3], type: 'summary_open', idempotencyKey: `open-${tesla[3]}` });
    expect(await learned()).toBeUndefined();
  });

  it('ręczne wykluczenie ma pierwszeństwo przed uczeniem', async () => {
    for (const id of tesla.slice(0, 3)) await call('PUT', `/api/me/content/${id}/state`, { liked: true });
    expect(await learned()).toMatchObject({ visible: true });
    const tag = (await call('GET', '/api/me/interests')).json().find((i: { label: string }) => i.label === 'Tesla (samochody)');
    expect((await call('DELETE', `/api/me/interests/${tag.id}?block=true`)).statusCode).toBe(204);
    await call('PUT', `/api/me/content/${tesla[3]}/state`, { liked: true });
    expect(await learned()).toMatchObject({ state: 'excluded' });
    const { recomputeLearned } = await import('../src/engine/learning.ts');
    await recomputeLearned(user.id);
    expect(await learned()).toMatchObject({ state: 'excluded' });
  });

  it('reset wyuczonych nie usuwa jawnych zainteresowań', async () => {
    const res = (await call('POST', '/api/me/interests/reset-learned')).json();
    expect(res.removed).toBeGreaterThanOrEqual(0);
    expect(await visibleLabels()).toContain('Szachy');
  });
});
