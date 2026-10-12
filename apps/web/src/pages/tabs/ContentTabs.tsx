import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Heart, LayoutGrid, Layers, BookOpen } from 'lucide-react';
import { useMe, usePatchProfile } from '../../lib/queries.ts';
import { PageHeader } from '../../components/AppShell.tsx';
import { Segmented } from '../../components/ui.tsx';
import { EmptyScene, type EmptyKind } from '../../graphics/Scenes.tsx';

/**
 * Zakładki treści. Silnik (wyszukiwanie → ekstrakcja → streszczenia → ranking) nie jest jeszcze
 * podłączony — budujemy go wspólnie w kolejnym etapie. Do tego czasu pokazujemy uczciwe puste stany,
 * bez fikcyjnych kart.
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

export function ArticlesTab() {
  const { pathname } = useLocation();
  const yours = pathname.startsWith('/articles/yours');
  const [list, setList] = useState<'liked' | 'read'>('liked');

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
            {list === 'liked' ? (
              <EngineEmpty kind="saved" title="Nic tu jeszcze nie ma" text="Stuknij serce na karcie, by zapisać artykuł na później. Tu trafią polubione, jeszcze nieprzeczytane." />
            ) : (
              <EngineEmpty kind="read" title="Historia jest pusta" text="Artykuły oznaczone jako przeczytane (przycisk na dole streszczenia) pojawią się tutaj." />
            )}
          </>
        ) : (
          <EngineEmpty
            kind="articles"
            title="Silnik treści jeszcze nie działa"
            text="Twój profil i tagi są gotowe. Dzienna pula do 20 artykułów ze streszczeniami pojawi się po podłączeniu wyszukiwarki i streszczeń."
          />
        )}
      </div>
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
