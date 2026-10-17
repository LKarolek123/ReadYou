import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronRight, EyeOff } from 'lucide-react';
import type { ArticleCard } from '@readyou/shared';
import { CardImage, CardMeta, HeartButton, SummaryButton, WhyBadge } from './ArticleCard.tsx';

const THRESHOLD = 100; // px — krótsze przeciągnięcie wraca na miejsce (brak przypadkowych sygnałów)

/**
 * Swipe: jedna karta naraz.
 * - w lewo: pominięcie pozycji (bez oceny tematu) i przejście dalej; można cofnąć,
 * - w prawo: otwarcie streszczenia (bez polubienia i bez oznaczania przeczytania),
 * - serce i książka zawsze widoczne; polubienie zostawia kartę na ekranie,
 * - „Dalej” przechodzi do następnej karty bez żadnego sygnału,
 * - klawiatura: ← pomiń, → streszczenie.
 */
export function SwipeDeck({
  items,
  onToggleLike,
  onOpenSummary,
  onSkip,
}: {
  items: ArticleCard[];
  onToggleLike: (c: ArticleCard) => void;
  onOpenSummary: (c: ArticleCard) => void;
  onSkip: (c: ArticleCard) => void;
}) {
  const [index, setIndex] = useState(0);
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const card = items[Math.min(index, items.length - 1)];

  if (!card) return null;
  const position = Math.min(index, items.length - 1);

  const skip = () => {
    onSkip(card);
    // Lista po pominięciu skraca się; ten sam indeks wskazuje następną kartę.
    setIndex((i) => Math.min(i, Math.max(0, items.length - 2)));
  };
  const next = () => setIndex((i) => (i + 1 < items.length ? i + 1 : 0));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const ddx = e.clientX - start.current.x;
    const ddy = e.clientY - start.current.y;
    // Pionowy ruch = przewijanie strony, nie gest karty.
    if (Math.abs(ddy) > Math.abs(ddx) && Math.abs(dx) < 10) return;
    setDx(ddx);
  };
  const onPointerUp = () => {
    const d = dx;
    start.current = null;
    setDx(0);
    if (d <= -THRESHOLD) skip();
    else if (d >= THRESHOLD) onOpenSummary(card);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') skip();
    if (e.key === 'ArrowRight') onOpenSummary(card);
  };

  const hint = dx <= -40 ? 'Pomiń' : dx >= 40 ? 'Streszczenie' : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center py-4">
      <p className="mb-3 text-sm font-medium text-muted" aria-live="polite">
        {position + 1} z {items.length}
      </p>
      <div
        role="group"
        aria-roledescription="karta"
        aria-label={`${card.title}. Strzałka w lewo: pomiń, w prawo: streszczenie.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = null;
          setDx(0);
        }}
        style={{ transform: `translateX(${dx}px) rotate(${dx / 40}deg)`, transition: start.current ? 'none' : 'transform 180ms ease' }}
        className="relative w-full touch-pan-y select-none overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-lift outline-none focus-visible:ring-4 focus-visible:ring-violet/30"
      >
        {hint && (
          <span
            className={`absolute left-4 top-4 z-10 rounded-full px-3 py-1 text-sm font-bold text-white ${dx < 0 ? 'bg-ink/80' : 'bg-brand'}`}
            aria-hidden
          >
            {hint}
          </span>
        )}
        <CardImage card={card} className="pointer-events-none" />
        <div className="flex flex-col gap-2 p-5">
          <div>
            <WhyBadge why={card.why} />
          </div>
          <h3 className="font-display text-xl font-bold leading-snug">{card.title}</h3>
          {card.description && <p className="line-clamp-3 text-[15px] leading-relaxed text-muted">{card.description}</p>}
          <CardMeta card={card} />
        </div>
      </div>

      <div className="mt-5 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={skip}
          aria-label="Pomiń ten artykuł"
          className="inline-flex size-12 items-center justify-center rounded-full border border-line bg-surface text-muted hover:text-ink"
        >
          <EyeOff className="size-5" aria-hidden />
        </button>
        <HeartButton liked={card.state.liked} onToggle={() => onToggleLike(card)} size="lg" />
        <SummaryButton onOpen={() => onOpenSummary(card)} status={card.summaryStatus} size="lg" />
        <button
          type="button"
          onClick={next}
          aria-label="Następna karta"
          className="inline-flex size-12 items-center justify-center rounded-full border border-line bg-surface text-muted hover:text-ink"
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-muted">Przesuń w lewo, by pominąć · w prawo, by przeczytać streszczenie</p>
    </div>
  );
}
