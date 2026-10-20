/**
 * Kolejka zadań i wektory zainteresowań — testy na lokalnej bazie.
 * Embeddingi liczy tu deterministyczna atrapa (FakeEmbeddingProvider), nie model e5.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeEmbeddingProvider } from '@readyou/providers';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  /* zmienne mogą pochodzić z CI */
}
process.env.NODE_ENV = 'test';

const { db, pool } = await import('../src/db.ts');
const queue = await import('../src/jobs/queue.ts');
const { syncInterestEmbeddings, interestText, EMBED_INTERESTS_JOB } = await import('../src/services/embeddings.ts');
const { addInterest, removeInterest, setInterestState } = await import('../src/services/interests.ts');

const KIND = `test_${randomUUID().slice(0, 8)}`; // izolacja od prawdziwych zadań
const users: string[] = [];

async function createUser(): Promise<string> {
  const id = `test-${randomUUID()}`;
  await db
    .insertInto('user')
    .values({ id, name: 'Test', email: `${id}@example.com`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() })
    .execute();
  await db.insertInto('user_profile').values({ user_id: id, created_at: new Date(), updated_at: new Date() }).execute();
  users.push(id);
  return id;
}

afterAll(async () => {
  await db.deleteFrom('job').where('kind', '=', KIND).execute();
  for (const id of users) {
    await db.deleteFrom('job').where('dedupe_key', '=', `${EMBED_INTERESTS_JOB}:${id}`).execute();
    await db.deleteFrom('user').where('id', '=', id).execute();
  }
  await pool.end();
});

describe('kolejka zadań', () => {
  beforeEach(async () => {
    await db.deleteFrom('job').where('kind', '=', KIND).execute();
  });

  it('zlewa równoległe zlecenia o tym samym kluczu w jedno oczekujące zadanie', async () => {
    await Promise.all(Array.from({ length: 10 }, () => queue.enqueue(KIND, { n: 1 }, { dedupeKey: `${KIND}:a` })));
    const rows = await db.selectFrom('job').selectAll().where('kind', '=', KIND).execute();
    expect(rows).toHaveLength(1);
  });

  it('kilku workerów nie bierze tego samego zadania', async () => {
    for (let i = 0; i < 5; i++) await queue.enqueue(KIND, { i });
    const claimed = await Promise.all(Array.from({ length: 8 }, (_, i) => queue.claim(`w${i}`, 60_000, [KIND])));
    const ids = claimed.filter(Boolean).map((j) => j!.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it('nie uruchamia równolegle dwóch zadań o tym samym kluczu', async () => {
    await queue.enqueue(KIND, {}, { dedupeKey: `${KIND}:b` });
    const first = await queue.claim('w1', 60_000, [KIND]);
    // Nowe zlecenie w trakcie pracy czeka, dopóki pierwsze się nie skończy.
    await queue.enqueue(KIND, {}, { dedupeKey: `${KIND}:b` });
    expect(await queue.claim('w2', 60_000, [KIND])).toBeUndefined();
    await queue.complete(first!, 'w1');
    expect(await queue.claim('w2', 60_000, [KIND])).toBeDefined();
  });

  it('ponawia z opóźnieniem i oznacza jako nieudane po wyczerpaniu prób', async () => {
    await queue.enqueue(KIND, {}, { maxAttempts: 2 });
    const j1 = (await queue.claim('w', 60_000, [KIND]))!;
    expect(await queue.fail(j1, 'w', new Error('boom ?api_key=SEKRET'))).toBe('retry');
    let row = await db.selectFrom('job').selectAll().where('id', '=', j1.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('queued');
    expect(row.run_at.getTime()).toBeGreaterThan(Date.now() + 10_000);
    expect(row.last_error).not.toContain('SEKRET');
    expect(await queue.claim('w', 60_000, [KIND])).toBeUndefined(); // jeszcze nie pora

    await db.updateTable('job').set({ run_at: new Date(0) }).where('id', '=', j1.id).execute();
    const j2 = (await queue.claim('w', 60_000, [KIND]))!;
    expect(j2.attempts).toBe(2);
    expect(await queue.fail(j2, 'w', new Error('znowu'))).toBe('failed');
    row = await db.selectFrom('job').selectAll().where('id', '=', j1.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('failed');
  });

  it('zadanie okresowe nie wraca po wykonaniu w tym samym okresie; po porażce dopiero po przerwie', async () => {
    const once = { dedupeKey: `${KIND}:okres`, oncePerKey: { retryFailedAfterMs: 60 * 60_000 } };
    await queue.enqueue(KIND, {}, once);
    const j = (await queue.claim('w', 60_000, [KIND]))!;
    await queue.enqueue(KIND, {}, once); // w trakcie
    await queue.complete(j, 'w');
    await queue.enqueue(KIND, {}, once); // po sukcesie (harmonogram co kilka minut)
    expect(await db.selectFrom('job').select('id').where('kind', '=', KIND).execute()).toHaveLength(1);

    await db.updateTable('job').set({ status: 'failed', updated_at: new Date() }).where('id', '=', j.id).execute();
    await queue.enqueue(KIND, {}, once); // świeża porażka — jeszcze nie
    expect(await db.selectFrom('job').select('id').where('kind', '=', KIND).execute()).toHaveLength(1);
    await db.updateTable('job').set({ updated_at: new Date(Date.now() - 2 * 60 * 60_000) }).where('id', '=', j.id).execute();
    await queue.enqueue(KIND, {}, once);
    expect(await db.selectFrom('job').select('id').where('kind', '=', KIND).where('status', '=', 'queued').execute()).toHaveLength(1);
  });

  it('Retry-After nie zużywa próby', async () => {
    await queue.enqueue(KIND, {}, { maxAttempts: 1 });
    const j = (await queue.claim('w', 60_000, [KIND]))!;
    expect(await queue.fail(j, 'w', new queue.RetryLaterError('429', 5_000))).toBe('retry');
    const row = await db.selectFrom('job').selectAll().where('id', '=', j.id).executeTakeFirstOrThrow();
    expect(row.attempts).toBe(0);
    expect(row.status).toBe('queued');
  });

  it('przejmuje zadanie po wygaśnięciu dzierżawy martwego workera', async () => {
    await queue.enqueue(KIND, {});
    const dead = (await queue.claim('martwy', 60_000, [KIND]))!;
    await db.updateTable('job').set({ locked_until: new Date(Date.now() - 1000) }).where('id', '=', dead.id).execute();
    const again = await queue.claim('zywy', 60_000, [KIND]);
    expect(again?.id).toBe(dead.id);
    // Martwy worker nie może już zakończyć cudzego zadania.
    await queue.complete(dead, 'martwy');
    const row = await db.selectFrom('job').select('status').where('id', '=', dead.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('running');
  });
});

describe('wektory zainteresowań', () => {
  const provider = new FakeEmbeddingProvider();
  let a: string;
  let b: string;

  beforeAll(async () => {
    a = await createUser();
    b = await createUser();
  });

  it('tekst wektora to pełna ścieżka gałęzi', () => {
    expect(interestText('RAG', ['Informatyka', 'Sztuczna inteligencja', 'Agenci AI', 'RAG'])).toBe(
      'Informatyka > Sztuczna inteligencja > Agenci AI > RAG',
    );
    expect(interestText('Szachy', [])).toBe('Szachy');
  });

  it('zmiana zainteresowań zleca przeliczenie wektorów', async () => {
    await addInterest(a, { label: 'Szachy', state: 'explicit' });
    const job = await db
      .selectFrom('job')
      .selectAll()
      .where('dedupe_key', '=', `${EMBED_INTERESTS_JOB}:${a}`)
      .where('status', '=', 'queued')
      .executeTakeFirst();
    expect(job?.kind).toBe(EMBED_INTERESTS_JOB);
    expect(job?.payload).toEqual({ userId: a });
  });

  it('osobny wektor dla każdego zainteresowania; ponowienie niczego nie dubluje', async () => {
    await addInterest(a, { label: 'Alpy', state: 'explicit' });
    const first = await syncInterestEmbeddings(a, provider);
    expect(first.computed).toBe(2);
    const again = await syncInterestEmbeddings(a, provider);
    expect(again).toMatchObject({ computed: 0, kept: 2 });
    const rows = await db.selectFrom('user_interest_embedding').selectAll().where('user_id', '=', a).execute();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.model === provider.model && r.dim === 384)).toBe(true);
  });

  it('wykluczenie i usunięcie tagu usuwają jego wektor', async () => {
    const interests = await db.selectFrom('user_interest').select(['id', 'label']).where('user_id', '=', a).execute();
    const chess = interests.find((i) => i.label === 'Szachy')!;
    const alps = interests.find((i) => i.label === 'Alpy')!;
    await setInterestState(a, chess.id, 'excluded');
    await removeInterest(a, alps.id, false);
    const res = await syncInterestEmbeddings(a, provider);
    expect(res.removed).toBe(1); // Alpy zniknęły kaskadowo razem z tagiem, Szachy usuwa synchronizacja
    const rows = await db.selectFrom('user_interest_embedding').select('interest_id').where('user_id', '=', a).execute();
    expect(rows).toHaveLength(0);
  });

  it('zmiana modelu przelicza wektory (nie porównujemy niekompatybilnych)', async () => {
    await addInterest(b, { label: 'Taniec towarzyski', state: 'explicit' });
    await syncInterestEmbeddings(b, provider);
    const other = Object.assign(new FakeEmbeddingProvider(), { model: 'test/other-model' });
    const res = await syncInterestEmbeddings(b, other);
    expect(res).toMatchObject({ computed: 1, removed: 1 });
    const rows = await db.selectFrom('user_interest_embedding').select('model').where('user_id', '=', b).execute();
    expect(rows.map((r) => r.model)).toEqual(['test/other-model']);
  });

  it('synchronizacja jednego konta nie dotyka wektorów innego', async () => {
    await addInterest(a, { label: 'Hackathony', state: 'explicit' });
    const before = await db.selectFrom('user_interest_embedding').select('interest_id').where('user_id', '=', b).execute();
    await syncInterestEmbeddings(a, provider);
    const after = await db.selectFrom('user_interest_embedding').select('interest_id').where('user_id', '=', b).execute();
    expect(after).toEqual(before);
  });

  it('usunięcie konta usuwa jego wektory', async () => {
    const c = await createUser();
    await addInterest(c, { label: 'Szachy', state: 'explicit' });
    await syncInterestEmbeddings(c, provider);
    await db.deleteFrom('user').where('id', '=', c).execute();
    const rows = await db.selectFrom('user_interest_embedding').select('interest_id').where('user_id', '=', c).execute();
    expect(rows).toHaveLength(0);
  });
});
