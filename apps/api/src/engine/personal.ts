/**
 * Trafność wspólnego katalogu dla jednej osoby: jej wektory zainteresowań vs wektory treści.
 * Wynik jest prywatny (liczony w locie dla właściciela) i nie trafia do wspólnych tabel.
 */
import { sql } from 'kysely';
import type { EmbeddingProvider } from '@readyou/providers';
import { db, fromPgVector } from '../db.ts';
import { env } from '../env.ts';
import { ancestorVectors, deskVectors, relevance, type InterestVector, type Relevance } from './relevance.ts';

export async function userInterestVectors(userId: string, provider: EmbeddingProvider): Promise<InterestVector[]> {
  const rows = await db
    .selectFrom('user_interest_embedding as e')
    .innerJoin('user_interest as ui', 'ui.id', 'e.interest_id')
    .select(['ui.id', 'ui.label', 'ui.node_key', 'ui.path', sql<string>`e.embedding::text`.as('embedding')])
    .where('e.user_id', '=', userId)
    .where('e.model', '=', provider.model)
    .where('ui.state', 'in', ['explicit', 'learned'])
    .execute();
  const out: InterestVector[] = [];
  for (const r of rows) {
    out.push({ id: r.id, label: r.label, nodeKey: r.node_key, vector: fromPgVector(r.embedding), ancestors: await ancestorVectors(r.path, provider) });
  }
  return out;
}

/** Tekst do dowodów słownych: tytuł, opis i początek treści strony (jeśli pobrana). */
export const evidenceText = (title: string, description: string | null, textHead: string | null) =>
  [title, description ?? '', textHead ?? ''].join('\n');

export interface ScoredContent {
  id: string;
  title: string;
  sourceDomain: string;
  url: string;
  status: string;
  publishedAt: Date | null;
  relevance: Relevance;
}

/** Ocenia świeże treści (bez odrzuconych) względem zainteresowań osoby; sortuje malejąco po marginesie. */
export async function scoreForUser(userId: string, provider: EmbeddingProvider, opts: { days?: number; includeIrrelevant?: boolean } = {}) {
  const interests = await userInterestVectors(userId, provider);
  if (!interests.length) return { interests, items: [] as ScoredContent[] };
  const since = new Date(Date.now() - (opts.days ?? env.CONTENT_MAX_AGE_DAYS) * 86_400_000);
  const statuses = opts.includeIrrelevant ? ['discovered', 'extracted', 'partial', 'irrelevant'] : ['discovered', 'extracted', 'partial'];
  const rows = await db
    .selectFrom('content_item as c')
    .innerJoin('content_embedding as e', 'e.content_id', 'c.id')
    .leftJoin('content_text as t', 't.content_id', 'c.id')
    .select([
      'c.id', 'c.title', 'c.description', 'c.source_domain', 'c.url', 'c.status', 'c.published_at', 'c.feed_url',
      sql<string>`e.embedding::text`.as('embedding'),
      sql<string | null>`left(t.text, 3000)`.as('text_head'),
      sql<string[] | null>`(select s.tags from summary s where s.content_id = c.id and s.sufficient order by s.created_at desc limit 1)`.as('summary_tags'),
    ])
    .where('e.model', '=', provider.model)
    // Dzienna pula to artykuły i newsy; wydarzenia, kluby i miejsca mają własny widok.
    .where('c.kind', 'in', ['article', 'news'])
    .where('c.status', 'in', statuses as never)
    .where((eb) => eb.or([eb('c.published_at', '>=', since), eb.and([eb('c.published_at', 'is', null), eb('c.created_at', '>=', since)])]))
    .execute();
  const desks = await deskVectors(provider);
  const items = rows
    .map((r) => ({
      id: r.id,
      title: r.title,
      sourceDomain: r.source_domain,
      url: r.url,
      status: r.status,
      publishedAt: r.published_at,
      relevance: relevance(fromPgVector(r.embedding), interests, desks, r.feed_url, evidenceText(r.title, r.description, r.text_head), r.summary_tags ?? undefined),
    }))
    .sort((a, b) => b.relevance.margin - a.relevance.margin || b.relevance.looseMargin - a.relevance.looseMargin);
  return { interests, items };
}
