import { useState } from 'react';
import { BookOpen, Compass, EyeOff, Heart, Layers3, MoreHorizontal, Radar } from 'lucide-react';
import type { ArticleCard as Card } from '@readyou/shared';
import { CategoryIllustration } from '../graphics/CategoryIllustration.tsx';
import { EventMetaLine } from './EventDetails.tsx';

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'dziś';
  if (days === 1) return 'wczoraj';
  if (days < 7) return `${days} dni temu`;
  return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
}

/** Zdjęcie wydawcy (tylko gdy dozwolone) albo ilustracja kategorii — nigdy udawane zdjęcie faktu. */
export function CardImage({ card, className = '' }: { card: Card; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (card.imageUrl && !failed) {
    return (
      <img
        src={card.imageUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`aspect-[16/9] w-full object-cover ${className}`}
      />
    );
  }
  return <CategoryIllustration kind={card.illustration} seed={card.id} decorative className={`aspect-[16/9] w-full ${className}`} />;
}

export function CardMeta({ card }: { card: Card }) {
  if (card.event || card.place) return <EventMetaLine card={card} />;
  const parts = [card.source, formatDate(card.publishedAt), card.readingMinutes ? `${card.readingMinutes} min` : null].filter(Boolean);
  return <p className="truncate text-[13px] font-medium text-muted">{parts.join(' · ')}</p>;
}

export function HeartButton({ liked, onToggle, size = 'md' }: { liked: boolean; onToggle: () => void; size?: 'md' | 'lg' }) {
  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={liked ? 'Usuń z polubionych' : 'Polub i zapisz na później'}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border transition ${
        size === 'lg' ? 'size-14' : 'size-11'
      } ${liked ? 'border-transparent bg-rose-50 text-rose-600' : 'border-line bg-surface text-muted hover:text-rose-600'}`}
    >
      <Heart className={size === 'lg' ? 'size-6' : 'size-5'} fill={liked ? 'currentColor' : 'none'} aria-hidden />
    </button>
  );
}

export function SummaryButton({ onOpen, status, size = 'md' }: { onOpen: () => void; status: Card['summaryStatus']; size?: 'md' | 'lg' }) {
  return (
    <button
      type="button"
      aria-label={status === 'pending' ? 'Streszczenie (w przygotowaniu)' : 'Otwórz streszczenie'}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-lift transition hover:brightness-110 ${
        size === 'lg' ? 'size-14' : 'size-11'
      }`}
    >
      <BookOpen className={size === 'lg' ? 'size-6' : 'size-5'} aria-hidden />
    </button>
  );
}

export function WhyBadge({ why, trending }: { why: Card['why']; trending?: Card['trending'] }) {
  if (trending) {
    return trending.label === 'multi' ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-soft px-2.5 py-1 text-xs font-semibold text-violet">
        <Layers3 className="size-3.5" aria-hidden /> Niezależne źródła: {trending.independentSources}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
        <Radar className="size-3.5" aria-hidden /> Na radarze
      </span>
    );
  }
  if (!why) return null;
  return why.kind === 'explore' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-soft px-2.5 py-1 text-xs font-semibold text-blue">
      <Compass className="size-3.5" aria-hidden /> Odkrywanie
    </span>
  ) : why.interest ? (
    <span className="inline-flex max-w-full truncate rounded-full bg-violet-soft px-2.5 py-1 text-xs font-semibold text-violet">{why.learned ? `Z polubień: ${why.interest}` : why.interest}</span>
  ) : null;
}

/** Karta siatki: zdjęcie/ilustracja, tytuł, opis, źródło; serce i książka + „Pomiń” w menu. */
export function ArticleGridCard({
  card,
  onToggleLike,
  onOpenSummary,
  onSkip,
}: {
  card: Card;
  onToggleLike: () => void;
  onOpenSummary: () => void;
  onSkip?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <article className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-card">
      <button type="button" onClick={onOpenSummary} className="block text-left" aria-label={`Streszczenie: ${card.title}`}>
        <CardImage card={card} />
      </button>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <WhyBadge why={card.why} trending={card.trending} />
        </div>
        <h3 className="font-display text-[17px] font-bold leading-snug">
          <button type="button" onClick={onOpenSummary} className="text-left hover:text-violet">
            {card.title}
          </button>
        </h3>
        {card.description && <p className="line-clamp-2 text-[15px] leading-relaxed text-muted">{card.description}</p>}
        <div className="mt-auto pt-1">
          <CardMeta card={card} />
        </div>
        <div className="flex items-center justify-end gap-2">
          {onSkip && (
            <div className="relative">
              <button
                type="button"
                aria-label="Więcej opcji"
                aria-expanded={menu}
                onClick={() => setMenu((m) => !m)}
                className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-ink/5"
              >
                <MoreHorizontal className="size-5" aria-hidden />
              </button>
              {menu && (
                <div className="absolute bottom-12 right-0 z-10 w-44 rounded-xl border border-line bg-surface p-1 shadow-lift" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      onSkip();
                    }}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm font-medium hover:bg-bg"
                  >
                    <EyeOff className="size-4" aria-hidden /> {card.kind === 'event' ? 'Pomiń to wydarzenie' : card.kind === 'club' || card.kind === 'place' ? 'Pomiń to miejsce' : 'Pomiń ten artykuł'}
                  </button>
                </div>
              )}
            </div>
          )}
          <HeartButton liked={card.state.liked} onToggle={onToggleLike} />
          <SummaryButton onOpen={onOpenSummary} status={card.summaryStatus} />
        </div>
      </div>
    </article>
  );
}
