/** Trending: najnowsza migawka z dowodami; stany (polubienie, przeczytanie) per osoba jak wszędzie. */
import type { ArticleCard, TrendingInfo, TrendingView } from '@readyou/shared';
import { db, type TrendingMember } from '../db.ts';
import { configuredCities } from '../engine/events.ts';
import { loadCards } from './content.ts';

const sourcesOf = (members: TrendingMember[]) => {
  const seen = new Set<string>();
  return members.filter((m) => !seen.has(m.source) && seen.add(m.source)).map((m) => ({ name: m.source, url: m.url }));
};

function reasons(kind: 'news' | 'events', label: 'multi' | 'radar', n: number, sources: { name: string }[]): string[] {
  if (label === 'multi') return [kind === 'news' ? `Obecne w ${n} niezależnych źródłach` : `Ogłaszane przez ${n} źródła`, sources.map((s) => s.name).join(', ')];
  return ['Na radarze', kind === 'news' ? `Jedno źródło: ${sources[0]?.name ?? '—'}` : 'Strona organizatora'];
}

export async function getTrending(userId: string, kind: 'news' | 'events'): Promise<TrendingView> {
  const snap = await db.selectFrom('trending_snapshot').selectAll().where('kind', '=', kind).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
  if (!snap) return { kind, items: [], checkedAt: null, method: null, notice: 'Trendy jeszcze się liczą — wróć za chwilę.' };
  const rows = await db.selectFrom('trending_item').selectAll().where('snapshot_id', '=', snap.id).orderBy('rank').execute();
  const why = new Map<string, ArticleCard['why']>();
  const info = new Map<string, TrendingInfo>();
  for (const r of rows) {
    const sources = sourcesOf(r.members);
    why.set(r.content_id, { kind: 'matched', interest: null, reasons: reasons(kind, r.label, r.independent_sources, sources) });
    info.set(r.content_id, { label: r.label, independentSources: r.independent_sources, sources, checkedAt: snap.created_at.toISOString() });
  }
  const cards = await loadCards(userId, rows.map((r) => r.content_id), why);
  const hidden = new Set(
    (await db.selectFrom('user_content_state').select('content_id').where('user_id', '=', userId).where('skipped_at', 'is not', null).execute()).map((s) => s.content_id),
  );
  const items: ArticleCard[] = [];
  for (const r of rows) {
    const card = cards.get(r.content_id);
    if (card && !hidden.has(r.content_id)) items.push({ ...card, trending: info.get(r.content_id) });
  }
  return {
    kind,
    items,
    checkedAt: snap.created_at.toISOString(),
    method: snap.method,
    notice:
      kind === 'events'
        ? `Wydarzenia z miast, dla których mamy źródła organizatorów: ${configuredCities().join(', ')}.`
        : null,
  };
}

/** Dowody Trending dla jednej treści (do panelu streszczenia), z najnowszej migawki, w której wystąpiła. */
export async function trendingInfoFor(contentId: string): Promise<TrendingInfo | undefined> {
  const r = await db
    .selectFrom('trending_item as i')
    .innerJoin('trending_snapshot as s', 's.id', 'i.snapshot_id')
    .select(['i.label', 'i.independent_sources', 'i.members', 's.created_at'])
    .where('i.content_id', '=', contentId)
    .orderBy('s.created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return r ? { label: r.label, independentSources: r.independent_sources, sources: sourcesOf(r.members), checkedAt: r.created_at.toISOString() } : undefined;
}
