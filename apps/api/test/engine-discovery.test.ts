/**
 * Zadanie wyszukiwania na atrapach (bez sieci, bez zużycia limitu Brave):
 * - tytuł i opis zapisywane są ZE STRONY wydawcy, nigdy z wyników wyszukiwarki (regulamin Brave);
 * - limit zapytań zatrzymuje wyszukiwanie;
 * - strona odrzucona (robots/SSRF) nie trafia do katalogu, a ponowne odkrycie nie dubluje pozycji.
 * Wektory liczy atrapa (FakeEmbeddingProvider), więc temat i treści mają osobny model „test/…”.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeEmbeddingProvider, FetchRejectedError, type ExtractedArticle, type SearchHit, type SearchQuery } from '@readyou/providers';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  /* zmienne mogą pochodzić z CI */
}
process.env.NODE_ENV = 'test';

const { db, pool, toPgVector } = await import('../src/db.ts');
const { sql } = await import('kysely');
const { searchTopic } = await import('../src/engine/discovery.ts');
const { setEngineForTests, closeEngine } = await import('../src/engine/context.ts');

const run = randomUUID().slice(0, 8);
const provider = new FakeEmbeddingProvider();
const key = `test temat ${run}`;
const host = `test-${run}.example`;
const searchName = `test-search-${run}`;
let queries = 0;

const hit = (n: number): SearchHit => ({
  url: `https://${host}/kitesurfing-${n}?utm_source=brave`,
  title: `WYNIK WYSZUKIWARKI ${n} kitesurfing zawody`,
  snippet: 'OPIS Z WYSZUKIWARKI kitesurfing deska latawiec wiatr',
  publishedAt: new Date(),
});

const page = (url: string): ExtractedArticle => ({
  url,
  canonicalUrl: url.replace(/\?.*$/, ''),
  sourceDomain: host,
  siteName: 'Serwis testowy',
  title: 'Tytuł ze strony wydawcy: kitesurfing zawody',
  description: 'Opis ze strony wydawcy o kitesurfingu, desce i latawcu',
  language: 'pl',
  publishedAt: new Date(),
  modifiedAt: null,
  author: null,
  imageUrl: null,
  text: 'Pełny tekst artykułu o kitesurfingu. '.repeat(50),
  wordCount: 300,
  partial: false,
  pageType: 'NewsArticle',
  tdmReserved: false,
});

beforeAll(async () => {
  const v = await provider.embedQuery('Sport > Kitesurfing');
  await db.insertInto('topic').values({ key, label: 'Kitesurfing', path: ['Sport', 'Kitesurfing'], node_key: null, created_at: new Date() }).execute();
  await sql`update topic set model = ${provider.model}, embedding = ${toPgVector(v)}::vector where key = ${key}`.execute(db);
  setEngineForTests({
    search: {
      name: searchName,
      async searchNews(_q: SearchQuery) {
        queries++;
        return [hit(1), hit(2), hit(3)];
      },
    },
    extractor: {
      async extract(url: string) {
        if (url.includes('kitesurfing-3')) throw new FetchRejectedError('robots', 'robots.txt zabrania');
        return page(url);
      },
    },
  });
});

afterAll(async () => {
  await db.deleteFrom('content_item').where('source_domain', '=', host).execute();
  await db.deleteFrom('topic').where('key', '=', key).execute();
  await db.deleteFrom('provider_usage').where('provider', '=', searchName).execute();
  await closeEngine();
  await pool.end();
});

describe('wyszukiwanie tematu', () => {
  it('zapisuje metadane ze strony wydawcy, a nie z wyszukiwarki', async () => {
    const res = await searchTopic(key, provider);
    expect(res).toMatchObject({ calls: 1, saved: 2, rejected: 1 });
    const rows = await db.selectFrom('content_item').selectAll().where('source_domain', '=', host).execute();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.title).toBe('Tytuł ze strony wydawcy: kitesurfing zawody');
      expect(r.description).not.toContain('WYSZUKIWARKI');
      expect(r.canonical_url).not.toContain('utm_source');
      expect(r.discovered_via).toBe('search');
    }
    // Nic z wyników wyszukiwarki nie trafiło do bazy.
    const leak = await sql<{ n: number }>`
      select count(*)::int as n from content_item
      where source_domain = ${host} and (title ilike '%WYSZUKIWARKI%' or coalesce(description, '') ilike '%WYSZUKIWARKI%')`.execute(db);
    expect(leak.rows[0]!.n).toBe(0);
    const text = await db.selectFrom('content_text').select(['expires_at']).where('content_id', 'in', rows.map((r) => r.id)).execute();
    expect(text).toHaveLength(2);
    expect(text.every((t) => t.expires_at.getTime() > Date.now())).toBe(true);
  });

  it('ponowne wyszukanie nie dubluje znanych adresów', async () => {
    const res = await searchTopic(key, provider);
    expect(res).toMatchObject({ saved: 0 });
    const rows = await db.selectFrom('content_item').select('id').where('source_domain', '=', host).execute();
    expect(rows).toHaveLength(2);
  });

  it('wyczerpany limit zatrzymuje zapytania', async () => {
    await db
      .insertInto('provider_usage')
      .values({ day: new Date().toISOString().slice(0, 10), provider: searchName, calls: 10_000 })
      .onConflict((oc) => oc.columns(['day', 'provider']).doUpdateSet({ calls: 10_000 }))
      .execute();
    const before = queries;
    const res = await searchTopic(key, provider);
    expect(res).toMatchObject({ calls: 0, budgetExhausted: true });
    expect(queries).toBe(before);
  });
});
