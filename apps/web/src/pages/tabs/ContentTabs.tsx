import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Heart, LayoutGrid, Layers, BookOpen } from 'lucide-react';
import type { ArticleCard } from '@readyou/shared';
import { useMe, usePatchProfile } from '../../lib/queries.ts';
import { useFeed, useMyArticles, useSetContentState } from '../../lib/feed.ts';
import { PageHeader } from '../../components/AppShell.tsx';
import { Alert, Button, Segmented, Spinner } from '../../components/ui.tsx';
import { ArticleGridCard } from '../../components/ArticleCard.tsx';
import { SwipeDeck } from '../../components/SwipeDeck.tsx';
import { SummarySheet } from '../../components/SummarySheet.tsx';
import { EmptyScene, type EmptyKind } from '../../graphics/Scenes.tsx';

/**
 * Zakładki treści. Artykuły: dzienna pula (Grid/Swipe), streszczenia i „Twoje artykuły”.
 * Wydarzenia i Trending: uczciwe puste stany do czasu podłączenia ich źródeł (bez fikcyjnych kart).
 */

function ViewToggle() {
  const me = useMe();
  const patch = usePatchProfile();
  const view = me.data?.profile.preferredView ?? 'grid';
  return (
    <Segmented
      label="Widok"
      value={view}
      onChange={(v) => patch.mutate({ preferredView: v })}
      options={[
        { value: 'grid', label: 'Grid', icon: <LayoutGrid className="size-4" aria-hidden /> },
        { value: 'swipe', label: 'Swipe', icon: <Layers className="size-4" aria-hidden /> },
      ]}
    />
  );
}

function EngineEmpty({ kind, title, text }: { kind: EmptyKind; title: string; text: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-14 text-center">
      <EmptyScene kind={kind} className="w-56" />
      <h2 className="mt-4 font-display text-xl font-bold">{title}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">{text}</p>
    </div>
  );
}

function Snackbar({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-30 flex justify-center px-4 lg:bottom-6">
      <div className="pointer-events-auto flex items-center gap-4 rounded-xl bg-ink px-4 py-2.5 text-sm text-white shadow-lift" role="status">
        {text}
        <button type="button" onClick={onAction} className="min-h-9 rounded-lg px-2 font-semibold text-violet-soft underline-offset-2 hover:underline">
          {action}
        </button>
      </div>
    </div>
  );
}

function ForYou({ openSummary }: { openSummary: (id: string) => void }) {
  const me = useMe();
  const feed = useFeed();
  const setState = useSetContentState();
  const [undo, setUndo] = useState<ArticleCard | null>(null);
  const view = me.data?.profile.preferredView ?? 'grid';

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);

  if (feed.isLoading) return <Spinner label="Wczytywanie Twojej puli…" />;
  if (feed.isError)
    return (
      <div className="py-8">
        <Alert tone="error">Nie udało się wczytać artykułów. Sprawdź połączenie i odśwież stronę.</Alert>
      </div>
    );
  const data = feed.data!;
  if (data.status === 'preparing')
    return (
      <EngineEmpty kind="articles" title="Przygotowujemy Twoją dzisiejszą pulę" text="Dobieramy do 20 artykułów do Twoich zainteresowań. To potrwa chwilę — strona odświeży się sama." />
    );
  if (data.status === 'empty' || !data.items.length)
    return (
      <EngineEmpty
        kind="articles"
        title={data.assigned ? 'Wszystko na dziś przejrzane' : 'Dziś brak dopasowanych artykułów'}
        text={
          data.assigned
            ? 'Przeczytane znajdziesz w „Twoje artykuły → Przeczytane”. Jutro pojawi się nowa pula.'
            : 'Źródła nie dały dziś wystarczająco trafnych treści. Nie dopełniamy puli słabszymi — spróbuj później albo dodaj tagi w Profilu.'
        }
      />
    );

  const like = (c: ArticleCard) => setState.mutate({ id: c.id, patch: { liked: !c.state.liked } });
  const skip = (c: ArticleCard) => {
    setState.mutate({ id: c.id, patch: { skipped: true } });
    setUndo(c);
  };

  return (
    <div className="py-4">
      {data.notice && <p className="mb-3 text-sm text-muted">{data.notice}</p>}
      {view === 'swipe' ? (
        <SwipeDeck items={data.items} onToggleLike={like} onOpenSummary={(c) => openSummary(c.id)} onSkip={skip} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((c) => (
            <ArticleGridCard key={c.id} card={c} onToggleLike={() => like(c)} onOpenSummary={() => openSummary(c.id)} onSkip={() => skip(c)} />
          ))}
        </div>
      )}
      {undo && (
        <Snackbar
          text="Pominięto artykuł"
          action="Cofnij"
          onAction={() => {
            setState.mutate({ id: undo.id, patch: { skipped: false } });
            setUndo(null);
          }}
        />
      )}
    </div>
  );
}

function YourArticles({ list, openSummary }: { list: 'liked' | 'read'; openSummary: (id: string) => void }) {
  const q = useMyArticles(list === 'liked' ? 'liked-unread' : 'read');
  const setState = useSetContentState();
  if (q.isLoading) return <Spinner />;
  if (q.isError)
    return (
      <div className="py-8">
        <Alert tone="error">Nie udało się wczytać listy. Spróbuj ponownie.</Alert>
      </div>
    );
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (!items.length)
    return list === 'liked' ? (
      <EngineEmpty kind="saved" title="Nic tu jeszcze nie ma" text="Stuknij serce na karcie, by zapisać artykuł na później. Tu trafią polubione, jeszcze nieprzeczytane." />
    ) : (
      <EngineEmpty kind="read" title="Historia jest pusta" text="Artykuły oznaczone jako przeczytane (przycisk na dole streszczenia) pojawią się tutaj." />
    );
  return (
    <div className="py-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((c) => (
          <div key={c.id} className="flex flex-col gap-2">
            <ArticleGridCard card={c} onToggleLike={() => setState.mutate({ id: c.id, patch: { liked: !c.state.liked } })} onOpenSummary={() => openSummary(c.id)} />
            {list === 'read' && (
              <button
                type="button"
                onClick={() => setState.mutate({ id: c.id, patch: { read: false } })}
                className="min-h-11 rounded-xl text-sm font-semibold text-muted hover:bg-ink/5 hover:text-ink"
              >
                Oznacz jako nieprzeczytane
              </button>
            )}
          </div>
        ))}
      </div>
      {q.hasNextPage && (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            Pokaż więcej
          </Button>
        </div>
      )}
    </div>
  );
}

export function ArticlesTab() {
  const { pathname } = useLocation();
  const yours = pathname.startsWith('/articles/yours');
  const [list, setList] = useState<'liked' | 'read'>('liked');
  const [summaryId, setSummaryId] = useState<string | null>(null);
  const closeSummary = useCallback(() => setSummaryId(null), []);

  return (
    <>
      <PageHeader title={yours ? 'Twoje artykuły' : 'Artykuły'} actions={!yours && <ViewToggle />}>
        <nav className="flex gap-2" aria-label="Sekcje artykułów">
          <Link
            to="/articles"
            className={`inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold ${!yours ? 'bg-ink text-white' : 'bg-surface text-muted border border-line'}`}
          >
            Dla Ciebie
          </Link>
          <Link
            to="/articles/yours"
            className={`inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold ${yours ? 'bg-ink text-white' : 'bg-surface text-muted border border-line'}`}
          >
            Twoje artykuły
          </Link>
        </nav>
      </PageHeader>
      <div className="mx-auto max-w-5xl px-4 lg:px-8">
        {yours ? (
          <>
            <div className="pt-4">
              <Segmented
                label="Lista"
                value={list}
                onChange={setList}
                options={[
                  { value: 'liked', label: 'Polubione', icon: <Heart className="size-4" aria-hidden /> },
                  { value: 'read', label: 'Przeczytane', icon: <BookOpen className="size-4" aria-hidden /> },
                ]}
              />
            </div>
            <YourArticles list={list} openSummary={setSummaryId} />
          </>
        ) : (
          <ForYou openSummary={setSummaryId} />
        )}
      </div>
      {summaryId && <SummarySheet id={summaryId} onClose={closeSummary} />}
    </>
  );
}

export function EventsTab() {
  const [range, setRange] = useState<'today' | 'week' | 'places'>('today');
  return (
    <>
      <PageHeader title="Wydarzenia" actions={<ViewToggle />}>
        <Segmented
          label="Zakres"
          value={range}
          onChange={setRange}
          options={[
            { value: 'today', label: 'Dzisiaj' },
            { value: 'week', label: 'Ten tydzień' },
            { value: 'places', label: 'Kluby i miejsca' },
          ]}
        />
      </PageHeader>
      <div className="mx-auto max-w-5xl px-4 lg:px-8">
        <EngineEmpty
          kind="events"
          title="Odkrywanie wydarzeń w przygotowaniu"
          text="Wydarzenia z Twojego miasta — z datą, ceną i linkiem do zapisów — pojawią się po podłączeniu źródeł wydarzeń."
        />
      </div>
    </>
  );
}

export function TrendingTab() {
  const [kind, setKind] = useState<'news' | 'events'>('news');
  return (
    <>
      <PageHeader title="Trending w Polsce">
        <Segmented
          label="Rodzaj"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'news', label: 'Newsy' },
            { value: 'events', label: 'Wydarzenia' },
          ]}
        />
      </PageHeader>
      <div className="mx-auto max-w-5xl px-4 lg:px-8">
        <EngineEmpty
          kind="trending"
          title="Trendy pojawią się wkrótce"
          text="Pokażemy tematy obecne w kilku niezależnych źródłach — bez wymyślonych liczników popularności."
        />
      </div>
    </>
  );
}
