/**
 * Trending: grupowanie historii, niezależność źródeł (grupy wydawnicze, przedruki) i API.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  /* zmienne mogą pochodzić z CI */
}
process.env.NODE_ENV = 'test';
process.env.EMAIL_PROVIDER = 'disabled';

const { clusterStories, independentSources, clusterScore } = await import('../src/engine/trending.ts');

/** Wektor jednostkowy o zadanym kosinusie względem osi X (w płaszczyźnie osi X i osi k). */
const unit = (cos: number, axis = 1) => {
  const v = Array(6).fill(0) as number[];
  v[0] = cos;
  v[axis] = Math.sqrt(1 - cos * cos);
  return v;
};
const item = (id: string, vector: number[], group: string, h = 1) => ({ id, vector, group, publishedAt: new Date(Date.now() - h * 3_600_000) });

describe('grupowanie i niezależność', () => {
  it('ta sama historia (≥ 0,89) w jednym klastrze; inna — osobno', () => {
    const a = item('a', unit(1), 'wp');
    const b = item('b', unit(0.95, 1), 'onet');
    const c = item('c', unit(0.2, 2), 'tvn');
    const clusters = clusterStories([a, b, c]);
    expect(clusters.map((k) => k.map((m) => m.id).sort())).toEqual(expect.arrayContaining([['a', 'b'], ['c']]));
  });

  it('bez łańcuchowania: A~B i B~C, ale A≁C → C nie dołącza do klastra A', () => {
    const a = item('a', unit(1), 'wp', 3);
    const b = item('b', unit(0.93, 1), 'onet', 2);
    // C bliski B (różni się od A): kosinus z A ≈ 0,73.
    const cVec = [0.73, Math.sqrt(1 - 0.73 * 0.73), 0, 0, 0, 0];
    const c = item('c', cVec, 'tvn', 1);
    const clusters = clusterStories([a, b, c]);
    expect(clusters.find((k) => k.some((m) => m.id === 'a'))!.map((m) => m.id)).not.toContain('c');
  });

  it('ta sama grupa wydawnicza i przedruk depeszy (≥ 0,975) liczą się jako jedno źródło', () => {
    const wp = item('wp', unit(1), 'wp');
    const money = item('money', unit(0.9, 1), 'wp'); // ta sama grupa
    const papCopy = item('pap', unit(0.99, 2), 'polsat'); // niemal identyczny tekst
    const own = item('own', unit(0.91, 3), 'tvn'); // własny materiał innej redakcji
    expect(independentSources([wp, money])).toBe(1);
    expect(independentSources([wp, papCopy])).toBe(1);
    expect(independentSources([wp, money, papCopy, own])).toBe(2);
    expect(clusterScore([wp, own]).groups).toBe(2);
  });
});

describe('Trending przez API', () => {
  const ORIGIN = 'http://localhost:5173';
  const host = `tr-${randomUUID().slice(0, 8)}.example`;
  let app: FastifyInstance;
  let db: typeof import('../src/db.ts').db;
  const users: { cookie: string; id: string }[] = [];
  const ids: string[] = [];
  let snapshotId = '';

  const call = (u: { cookie: string }, method: 'GET' | 'PUT', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { cookie: u.cookie, origin: ORIGIN, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: payload as object | undefined });

  beforeAll(async () => {
    const { buildServer } = await import('../src/server.ts');
    ({ db } = await import('../src/db.ts'));
    app = await buildServer();
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        payload: { name: 'Test', email: `t-${randomUUID()}@example.com`, password: 'testowehaslo123' },
      });
      const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
      const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
      users.push({ cookie, id: me.json().user.id });
    }
    for (const n of ['multi', 'radar']) {
      const row = await db
        .insertInto('content_item')
        .values({ kind: 'news', canonical_url: `https://${host}/${n}`, url: `https://${host}/${n}`, source_domain: host, source_name: 'Portal', title: `News ${n}`, discovered_via: 'feed', status: 'discovered', published_at: new Date(), created_at: new Date(), updated_at: new Date() })
        .returning('id')
        .executeTakeFirstOrThrow();
      ids.push(row.id);
    }
    // Migawka w przyszłości — najnowsza na czas testu, niezależnie od prawdziwych migawek w bazie deweloperskiej.
    const s = await db.insertInto('trending_snapshot').values({ kind: 'news', method: 'test', items_considered: 2, created_at: new Date(Date.now() + 3_600_000) }).returning('id').executeTakeFirstOrThrow();
    snapshotId = s.id;
    await db
      .insertInto('trending_item')
      .values([
        { snapshot_id: s.id, rank: 1, content_id: ids[0]!, label: 'multi', independent_sources: 3, members: JSON.stringify([{ contentId: ids[0], url: `https://${host}/multi`, source: 'WP', group: 'wp', publishedAt: null }, { contentId: 'x', url: `https://${host}/o`, source: 'Onet', group: 'ras', publishedAt: null }]), signals: '{}' },
        { snapshot_id: s.id, rank: 2, content_id: ids[1]!, label: 'radar', independent_sources: 1, members: JSON.stringify([{ contentId: ids[1], url: `https://${host}/radar`, source: 'TVN24', group: 'tvn', publishedAt: null }]), signals: '{}' },
      ])
      .execute();
  });

  afterAll(async () => {
    for (const u of users) await app.inject({ method: 'DELETE', url: '/api/me', headers: { cookie: u.cookie, origin: ORIGIN } });
    if (db) {
      await db.deleteFrom('trending_snapshot').where('id', '=', snapshotId).execute();
      await db.deleteFrom('content_item').where('source_domain', '=', host).execute();
    }
    await app?.close();
    const { pool } = await import('../src/db.ts');
    await pool.end();
  });

  it('domyślnie newsy; uczciwe uzasadnienia bez liczb popularności', async () => {
    const res = (await call(users[0]!, 'GET', '/api/trending')).json();
    expect(res.kind).toBe('news');
    const [first, second] = res.items;
    expect(first.trending).toMatchObject({ label: 'multi', independentSources: 3 });
    expect(first.why.reasons[0]).toBe('Obecne w 3 niezależnych źródłach');
    expect(second.why.reasons[0]).toBe('Na radarze');
    expect(JSON.stringify(res)).not.toMatch(/wyświetle|czytelnik|obserwuj/i);
  });

  it('polubienie newsa z Trending trafia do „Twoich artykułów”, pominięcie ukrywa tylko u tej osoby', async () => {
    await call(users[0]!, 'PUT', `/api/me/content/${ids[0]}/state`, { liked: true });
    const liked = (await call(users[0]!, 'GET', '/api/me/articles?state=liked-unread')).json().items.map((i: { id: string }) => i.id);
    expect(liked).toContain(ids[0]);
    await call(users[0]!, 'PUT', `/api/me/content/${ids[1]}/state`, { skipped: true });
    expect((await call(users[0]!, 'GET', '/api/trending')).json().items.map((i: { id: string }) => i.id)).not.toContain(ids[1]);
    const other = (await call(users[1]!, 'GET', '/api/trending')).json().items;
    expect(other.map((i: { id: string }) => i.id)).toContain(ids[1]);
    expect(other.find((i: { id: string }) => i.id === ids[0]).state.liked).toBe(false);
  });

  it('panel streszczenia pokazuje źródła Trending', async () => {
    const s = (await call(users[0]!, 'GET', `/api/content/${ids[0]}/summary`)).json();
    expect(s.trending.sources.map((x: { name: string }) => x.name)).toEqual(['WP', 'Onet']);
  });
});
