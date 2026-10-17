/**
 * Dzienna pula i stany artykułów przez API (lokalna baza, wektory z atrapy FakeEmbeddingProvider).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FakeEmbeddingProvider } from '@readyou/providers';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  /* zmienne mogą pochodzić z CI */
}
process.env.NODE_ENV = 'test';
process.env.EMAIL_PROVIDER = 'disabled';

const ORIGIN = 'http://localhost:5173';
const fake = new FakeEmbeddingProvider();
const host = `feed-${randomUUID().slice(0, 8)}.example`;
let app: FastifyInstance;
let db: typeof import('../src/db.ts').db;
let a: { cookie: string; id: string };
let b: { cookie: string; id: string };
const contentIds: string[] = [];

const call = (cookie: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { cookie, origin: ORIGIN, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: payload as object | undefined });

async function signUp() {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    payload: { name: 'Test', email: `f-${randomUUID()}@example.com`, password: 'testowehaslo123' },
  });
  expect(res.statusCode).toBe(200);
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
  const me = await call(cookie, 'GET', '/api/me');
  return { cookie, id: me.json().user.id as string };
}

const randomWords = () => Array.from({ length: 6 }, () => randomUUID().slice(0, 6)).join(' ');

beforeAll(async () => {
  const { buildServer } = await import('../src/server.ts');
  ({ db } = await import('../src/db.ts'));
  const { sql } = await import('kysely');
  const { syncInterestEmbeddings } = await import('../src/services/embeddings.ts');
  app = await buildServer();
  a = await signUp();
  b = await signUp();
  for (const u of [a, b]) {
    expect((await call(u.cookie, 'POST', '/api/me/interests', { label: 'Szachy' })).statusCode).toBe(201);
    await syncInterestEmbeddings(u.id, fake);
    // Działający worker deweloperski przeliczyłby wektory prawdziwym modelem w trakcie testu.
    await db.deleteFrom('job').where('dedupe_key', '=', `embed_user_interests:${u.id}`).execute();
  }
  // 30 różnych treści szachowych (unikalne słowa = różne historie dla atrapy wektorów).
  for (let i = 0; i < 30; i++) {
    const title = `Szachy turniej ${i} ${randomWords()}`;
    const row = await db
      .insertInto('content_item')
      .values({
        canonical_url: `https://${host}/a${i}`,
        url: `https://${host}/a${i}`,
        source_domain: host,
        title,
        description: null,
        discovered_via: 'feed',
        status: 'extracted',
        word_count: 600,
        published_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const [v] = await fake.embedPassages([title]);
    await sql`insert into content_embedding (content_id, model, dim, source_hash, embedding) values (${row.id}, ${fake.model}, 384, 'x', ${`[${v!.join(',')}]`}::vector)`.execute(db);
    contentIds.push(row.id);
  }
});

afterAll(async () => {
  for (const u of [a, b]) if (u) await call(u.cookie, 'DELETE', '/api/me');
  if (db) {
    await db.deleteFrom('job').where((eb) => eb.or(contentIds.map((id) => eb('dedupe_key', 'like', `%${id}%`)))).execute();
    await db.deleteFrom('job').where((eb) => eb.or([a, b].filter(Boolean).map((u) => eb('dedupe_key', 'like', `%${u.id}%`)))).execute();
    await db.deleteFrom('content_item').where('source_domain', '=', host).execute();
  }
  await app?.close();
  const { pool } = await import('../src/db.ts');
  await pool.end();
});

describe('dzienna pula', () => {
  it('równoległe budowanie nie przekracza 20 i nie dubluje pozycji', async () => {
    const { fillDailyPool } = await import('../src/engine/pool.ts');
    await Promise.all(Array.from({ length: 5 }, () => fillDailyPool(a.id, fake, { force: true })));
    const rows = await db.selectFrom('daily_assignment').select(['content_id', 'slot']).where('user_id', '=', a.id).execute();
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((r) => r.content_id)).size).toBe(20);
    expect(rows.every((r) => contentIds.includes(r.content_id))).toBe(true);
  });

  it('kolejne odświeżenie nie tworzy nowej paczki ponad limit', async () => {
    const { fillDailyPool } = await import('../src/engine/pool.ts');
    const res = await fillDailyPool(a.id, fake, { force: true });
    expect(res).toMatchObject({ added: 0, total: 20 });
  });

  it('feed pokazuje pulę z uzasadnieniem; przeczytane znikają z „Dla Ciebie”, ale nie zwalniają miejsca', async () => {
    const feed = (await call(a.cookie, 'GET', '/api/feed/articles')).json();
    expect(feed.status).toBe('ready');
    expect(feed.items).toHaveLength(20);
    expect(feed.items[0].why).toMatchObject({ kind: 'matched', interest: 'Szachy' });
    expect(feed.items[0].imageUrl).toBeNull(); // bez zgody na obrazy źródłowe — ilustracja kategorii
    expect(feed.items[0].illustration).toBe('games');
    const first = feed.items[0].id;
    await call(a.cookie, 'PUT', `/api/me/content/${first}/state`, { read: true });
    const after = (await call(a.cookie, 'GET', '/api/feed/articles')).json();
    expect(after.items).toHaveLength(19);
    expect(after.assigned).toBe(20);
    expect(after.items.some((i: { id: string }) => i.id === first)).toBe(false);
  });
});

describe('polubione i przeczytane', () => {
  const list = async (cookie: string, state: string) => (await call(cookie, 'GET', `/api/me/articles?state=${state}`)).json().items.map((i: { id: string }) => i.id);

  it('polubienie → „Polubione”; przeczytanie przenosi do „Przeczytane” z zachowaniem serca', async () => {
    const id = contentIds[1]!;
    expect((await call(a.cookie, 'PUT', `/api/me/content/${id}/state`, { liked: true })).json()).toMatchObject({ liked: true, read: false });
    expect(await list(a.cookie, 'liked-unread')).toContain(id);
    expect((await call(a.cookie, 'PUT', `/api/me/content/${id}/state`, { read: true })).json()).toMatchObject({ liked: true, read: true });
    expect(await list(a.cookie, 'liked-unread')).not.toContain(id);
    expect(await list(a.cookie, 'read')).toContain(id);
  });

  it('cofnięcie przeczytania przywraca do „Polubione”; cofnięcie polubienia nie usuwa historii przeczytania', async () => {
    const id = contentIds[1]!;
    await call(a.cookie, 'PUT', `/api/me/content/${id}/state`, { read: false });
    expect(await list(a.cookie, 'liked-unread')).toContain(id);
    await call(a.cookie, 'PUT', `/api/me/content/${id}/state`, { read: true });
    await call(a.cookie, 'PUT', `/api/me/content/${id}/state`, { liked: false });
    expect(await list(a.cookie, 'read')).toContain(id);
    expect(await list(a.cookie, 'liked-unread')).not.toContain(id);
  });

  it('„Przeczytane” obejmuje też niepolubione', async () => {
    const id = contentIds[2]!;
    await call(a.cookie, 'PUT', `/api/me/content/${id}/state`, { read: true });
    expect(await list(a.cookie, 'read')).toContain(id);
  });

  it('wielokrotne polubienie jest idempotentne — jedna interakcja', async () => {
    const id = contentIds[3]!;
    for (let i = 0; i < 4; i++) await call(a.cookie, 'PUT', `/api/me/content/${id}/state`, { liked: true });
    const likes = await db.selectFrom('interaction').select('id').where('user_id', '=', a.id).where('content_id', '=', id).where('type', '=', 'like').execute();
    expect(likes).toHaveLength(1);
  });

  it('otwarcie streszczenia i kliknięcie źródła nie oznaczają przeczytania; retransmisja nie dubluje', async () => {
    const id = contentIds[4]!;
    for (let i = 0; i < 2; i++) {
      expect((await call(a.cookie, 'POST', '/api/interactions', { contentId: id, type: 'summary_open', idempotencyKey: `open-${id}` })).statusCode).toBe(204);
    }
    await call(a.cookie, 'POST', '/api/interactions', { contentId: id, type: 'source_click', idempotencyKey: `click-${id}` });
    const summary = (await call(a.cookie, 'GET', `/api/content/${id}/summary`)).json();
    expect(summary.state).toMatchObject({ read: false, liked: false });
    expect(summary.status).toBe('pending'); // brak zapisanego streszczenia — bez wywołania modelu
    const opens = await db.selectFrom('interaction').select('id').where('user_id', '=', a.id).where('content_id', '=', id).where('type', '=', 'summary_open').execute();
    expect(opens).toHaveLength(1);
  });

  it('pominięcie ukrywa pozycję, cofnięcie ją przywraca; temat nie jest wykluczany', async () => {
    const feed = (await call(a.cookie, 'GET', '/api/feed/articles')).json();
    const id = feed.items[0].id;
    await call(a.cookie, 'PUT', `/api/me/content/${id}/state`, { skipped: true });
    expect((await call(a.cookie, 'GET', '/api/feed/articles')).json().items.some((i: { id: string }) => i.id === id)).toBe(false);
    await call(a.cookie, 'PUT', `/api/me/content/${id}/state`, { skipped: false });
    expect((await call(a.cookie, 'GET', '/api/feed/articles')).json().items.some((i: { id: string }) => i.id === id)).toBe(true);
    const interests = (await call(a.cookie, 'GET', '/api/me/interests')).json();
    expect(interests.find((i: { label: string }) => i.label === 'Szachy').state).toBe('explicit');
  });

  it('stronicowanie kursorowe obejmuje całą historię', async () => {
    for (const id of contentIds.slice(5, 30)) await call(a.cookie, 'PUT', `/api/me/content/${id}/state`, { liked: true });
    const p1 = (await call(a.cookie, 'GET', '/api/me/articles?state=liked-unread')).json();
    expect(p1.items).toHaveLength(20);
    const p2 = (await call(a.cookie, 'GET', `/api/me/articles?state=liked-unread&cursor=${p1.nextCursor}`)).json();
    const all = new Set([...p1.items, ...p2.items].map((i: { id: string }) => i.id));
    expect(all.size).toBe(p1.items.length + p2.items.length);
    expect(p2.nextCursor).toBeNull();
  });

  it('stan przetrwa zmianę dnia (pula z wczoraj, listy nadal pełne)', async () => {
    await db.updateTable('daily_assignment').set({ local_day: '2000-01-01' }).where('user_id', '=', a.id).execute();
    expect(await list(a.cookie, 'read')).toContain(contentIds[2]);
  });
});

describe('izolacja kont', () => {
  it('B nie widzi stanów ani puli A', async () => {
    expect((await call(b.cookie, 'GET', '/api/me/articles?state=read')).json().items).toHaveLength(0);
    const s = (await call(b.cookie, 'GET', `/api/content/${contentIds[2]}/summary`)).json();
    expect(s.state).toMatchObject({ read: false, liked: false });
    expect(s.why).toBeNull();
  });

  it('eksport B nie zawiera danych A', async () => {
    const exp = (await call(b.cookie, 'GET', '/api/me/export')).json();
    expect(exp.articles).toHaveLength(0);
    expect(exp.interactions).toHaveLength(0);
  });

  it('zła treść żądania i nieistniejący artykuł', async () => {
    expect((await call(a.cookie, 'PUT', `/api/me/content/${contentIds[0]}/state`, { liked: 'tak' })).statusCode).toBe(400);
    expect((await call(a.cookie, 'PUT', `/api/me/content/${randomUUID()}/state`, { liked: true })).statusCode).toBe(404);
    expect((await call(a.cookie, 'PUT', `/api/me/content/${contentIds[0]}/state`, { userId: b.id, liked: true })).statusCode).toBe(400);
  });
});
