import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ArticleCard, ContentStatePatch, ContentStateView, EventFeedView, EventRange, FeedView, Paged, SummaryView, TrendingView } from '@readyou/shared';
import { api } from './api.ts';

export const feedKeys = {
  feed: ['feed', 'articles'] as const,
  mine: (list: 'liked-unread' | 'read') => ['my-articles', list] as const,
  summary: (id: string) => ['summary', id] as const,
  events: (range: EventRange) => ['events', range] as const,
};

/** Trending: migawka liczona co godzinę — odświeżamy co 10 min. */
export function useTrending(kind: 'news' | 'events') {
  return useQuery({
    queryKey: ['trending', kind] as const,
    queryFn: () => api.get<TrendingView>(`/trending?kind=${kind}`),
    staleTime: 10 * 60_000,
  });
}

/** Wydarzenia / kluby i miejsca / zapisane. Lista zmienia się wolno — cache 5 min. */
export function useEvents(range: EventRange) {
  return useQuery({
    queryKey: feedKeys.events(range),
    queryFn: () => api.get<EventFeedView>(`/feed/events?range=${range}`),
    staleTime: 5 * 60_000,
  });
}

/** Dzisiejsza pula. Gdy pula powstaje w tle (status „preparing”), odpytujemy co 3 s. */
export function useFeed() {
  return useQuery({
    queryKey: feedKeys.feed,
    queryFn: () => api.get<FeedView>('/feed/articles'),
    refetchInterval: (q) => (q.state.data?.status === 'preparing' ? 3000 : false),
  });
}

export function useMyArticles(list: 'liked-unread' | 'read') {
  return useInfiniteQuery({
    queryKey: feedKeys.mine(list),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<Paged<ArticleCard>>(`/me/articles?state=${list}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useSummary(id: string | null) {
  return useQuery({
    queryKey: feedKeys.summary(id ?? ''),
    queryFn: () => api.get<SummaryView>(`/content/${id}/summary`),
    enabled: Boolean(id),
    // Streszczenie w przygotowaniu — sprawdzamy ponownie co 5 s, dopóki panel jest otwarty.
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 5000 : false),
  });
}

/** Aktualizuje stan karty we wszystkich miejscach, gdzie jest widoczna (spójność Grid/Swipe/listy). */
function patchCaches(qc: QueryClient, id: string, state: Partial<ContentStateView>) {
  const patchCard = (c: ArticleCard) => (c.id === id ? { ...c, state: { ...c.state, ...state } } : c);
  qc.setQueryData<FeedView>(feedKeys.feed, (f) => (f ? { ...f, items: f.items.map(patchCard) } : f));
  qc.setQueryData<SummaryView>(feedKeys.summary(id), (s) => (s ? { ...s, state: { ...s.state, ...state } } : s));
  for (const prefix of ['events', 'trending']) {
    for (const [key, data] of qc.getQueriesData<EventFeedView | TrendingView>({ queryKey: [prefix] })) {
      if (data) qc.setQueryData(key, { ...data, items: data.items.map(patchCard) });
    }
  }
}

export function useSetContentState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ContentStatePatch }) => api.put<ContentStateView>(`/me/content/${id}/state`, patch),
    onMutate: ({ id, patch }) => patchCaches(qc, id, patch),
    onSuccess: (state, { id }) => patchCaches(qc, id, state),
    onError: () => qc.invalidateQueries({ queryKey: feedKeys.feed }),
    onSettled: (_d, _e, { patch, id }) => {
      qc.invalidateQueries({ queryKey: ['my-articles'] });
      qc.invalidateQueries({ queryKey: feedKeys.summary(id) });
      // Przeczytane i pominięte znikają z „Dla Ciebie” — odśwież listę puli.
      if (patch.read !== undefined || patch.skipped !== undefined) qc.invalidateQueries({ queryKey: feedKeys.feed });
      if (patch.liked !== undefined) qc.invalidateQueries({ queryKey: feedKeys.events('saved') });
      if (patch.skipped !== undefined) {
        qc.invalidateQueries({ queryKey: ['events'] });
        qc.invalidateQueries({ queryKey: ['trending'] });
      }
    },
  });
}

/** Słaby sygnał (otwarcie streszczenia, kliknięcie źródła). Klucz idempotencji: jeden sygnał na dzień. */
export function logInteraction(contentId: string, type: 'summary_open' | 'source_click') {
  const day = new Date().toISOString().slice(0, 10);
  api.post('/interactions', { contentId, type, idempotencyKey: `${type}:${contentId}:${day}` }).catch(() => {
    /* sygnał pomocniczy — błąd sieci nie przeszkadza w czytaniu */
  });
}

export function useRefreshFeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/feed/refresh'),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: feedKeys.feed }), 4000),
  });
}
