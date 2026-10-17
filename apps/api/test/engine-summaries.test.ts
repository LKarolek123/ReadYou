/**
 * Streszczenia na atrapie dostawcy (bez wywołań płatnego API):
 * cache, budżet, zwolnienie rezerwacji po błędzie, walidacja odpowiedzi modelu.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sanitize, type SummaryInput, type SummaryProvider, type SummaryResult } from '@readyou/providers';

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  /* zmienne mogą pochodzić z CI */
}
process.env.NODE_ENV = 'test';
process.env.LLM_DAILY_BUDGET_USD = '1000';
process.env.LLM_MONTHLY_BUDGET_USD = '1000';

const { db, pool } = await import('../src/db.ts');
const { sql } = await import('kysely');
const { summarizeContent, latestSummary } = await import('../src/engine/summaries.ts');

const model = `test-model-${randomUUID().slice(0, 8)}`;
const host = `sum-${randomUUID().slice(0, 8)}.example`;
let calls = 0;
let failNext = false;
const seen: SummaryInput[] = [];

const fake: SummaryProvider = {
  model,
  promptVersion: 'test-v1',
  async summarize(input): Promise<SummaryResult> {
    calls++;
    seen.push(input);
    if (failNext) {
      failNext = false;
      throw new Error('awaria dostawcy');
    }
    return {
      sufficient: true,
      card_description: 'Opis karty',
      summary: 'Streszczenie testowe '.repeat(10).trim(),
      key_facts: ['Fakt'],
      caveats: [],
      tags: ['games.chess'],
      basis: input.text ? 'full' : 'excerpt',
      model,
      promptVersion: 'test-v1',
      usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  },
};

let id: string;
beforeAll(async () => {
  const row = await db
    .insertInto('content_item')
    .values({
      canonical_url: `https://${host}/a`,
      url: `https://${host}/a`,
      source_domain: host,
      title: 'Turniej szachowy',
      description: 'Lead',
      discovered_via: 'feed',
      status: 'extracted',
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  id = row.id;
  await db.insertInto('content_text').values({ content_id: id, text: 'Treść artykułu o turnieju.', expires_at: new Date(Date.now() + 86_400_000) }).execute();
});

afterAll(async () => {
  await db.deleteFrom('content_item').where('source_domain', '=', host).execute();
  await sql`delete from llm_usage where model = ${model}`.execute(db);
  await pool.end();
});

describe('streszczenia', () => {
  it('błąd dostawcy zwalnia rezerwację budżetu i nic nie zapisuje', async () => {
    failNext = true;
    await expect(summarizeContent(id, fake)).rejects.toThrow('awaria');
    const u = await sql<{ reserved: number; requests: number }>`select reserved_usd::float8 as reserved, requests from llm_usage where model = ${model}`.execute(db);
    expect(u.rows[0]).toMatchObject({ reserved: 0, requests: 0 });
    expect(await latestSummary(id)).toBeUndefined();
  });

  it('tworzy streszczenie z tekstu źródła i rozlicza zużycie', async () => {
    expect(await summarizeContent(id, fake)).toEqual({ status: 'created', sufficient: true });
    expect(seen.at(-1)).toMatchObject({ title: 'Turniej szachowy', text: 'Treść artykułu o turnieju.', partial: false });
    const s = await latestSummary(id);
    expect(s).toMatchObject({ basis: 'full', tags: ['games.chess'], card_description: 'Opis karty' });
    const u = await sql<{ requests: number; cost: number }>`select requests, est_cost_usd::float8 as cost from llm_usage where model = ${model}`.execute(db);
    expect(u.rows[0]!.requests).toBe(1);
    expect(u.rows[0]!.cost).toBeGreaterThan(0);
  });

  it('kolejne żądanie czyta zapisany wynik — bez wywołania modelu', async () => {
    const before = calls;
    expect(await summarizeContent(id, fake)).toEqual({ status: 'cached', sufficient: true });
    expect(calls).toBe(before);
  });

  it('zmiana tekstu źródła tworzy nowe streszczenie', async () => {
    await db.updateTable('content_text').set({ text: 'Zaktualizowana treść.' }).where('content_id', '=', id).execute();
    expect((await summarizeContent(id, fake)).status).toBe('created');
  });

  it('wyczerpany budżet blokuje wywołanie', async () => {
    await db.updateTable('content_text').set({ text: 'Jeszcze inna treść.' }).where('content_id', '=', id).execute();
    await sql`update llm_usage set est_cost_usd = 5000 where model = ${model}`.execute(db);
    const before = calls;
    expect(await summarizeContent(id, fake)).toEqual({ status: 'budget_exhausted' });
    expect(calls).toBe(before);
  });
});

describe('walidacja odpowiedzi modelu', () => {
  const allowed = new Set(['tech.ai', 'games.chess']);
  const base = { sufficient: true, card_description: ' Opis ', summary: 'słowo '.repeat(120), key_facts: ['a', ''], caveats: [], tags: ['tech.ai', 'wymyślony.tag', 'tech.ai'] };

  it('odrzuca nieznane tagi i duplikaty, czyści białe znaki', () => {
    const out = sanitize(base, allowed);
    expect(out.tags).toEqual(['tech.ai']);
    expect(out.card_description).toBe('Opis');
    expect(out.key_facts).toEqual(['a']);
  });

  it('przy niewystarczającym materiale zwraca puste pola (bez ogólników udających treść)', () => {
    expect(sanitize({ ...base, sufficient: false }, allowed)).toMatchObject({ summary: '', tags: [], key_facts: [] });
  });

  it('odrzuca streszczenie o nieoczekiwanej długości', () => {
    expect(() => sanitize({ ...base, summary: 'za krótko' }, allowed)).toThrow();
  });
});
