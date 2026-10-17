import { useEffect, useRef } from 'react';
import { BookCheck, BookX, ExternalLink, Info, Loader2, Sparkles, X } from 'lucide-react';
import { logInteraction, useSetContentState, useSummary } from '../lib/feed.ts';
import { Alert } from './ui.tsx';
import { formatDate, HeartButton } from './ArticleCard.tsx';

/**
 * Streszczenie w panelu (dół ekranu na telefonie, okno na komputerze).
 * Otwarcie NIE polubia i NIE oznacza przeczytania — do tego służy jawny przycisk na dole.
 * „Dlaczego dla Ciebie” jest oddzielone od faktów ze źródła.
 */
export function SummarySheet({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useSummary(id);
  const setState = useSetContentState();
  const panel = useRef<HTMLDivElement>(null);
  const s = q.data;

  useEffect(() => {
    logInteraction(id, 'summary_open');
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus();
    };
  }, [id, onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="summary-title"
        className="pb-safe relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-surface shadow-lift outline-none sm:max-w-2xl sm:rounded-3xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line/60 bg-surface/95 px-5 py-3 backdrop-blur">
          <p className="truncate text-[13px] font-medium text-muted">
            {s ? [s.source.name, formatDate(s.source.publishedAt)].filter(Boolean).join(' · ') : 'Streszczenie'}
          </p>
          <button type="button" onClick={onClose} aria-label="Zamknij streszczenie" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-ink/5">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="px-5 pb-6 pt-4 sm:px-7">
          {q.isLoading && (
            <div className="flex items-center gap-2 py-10 text-muted" role="status">
              <Loader2 className="size-5 animate-spin text-violet" aria-hidden /> Wczytywanie…
            </div>
          )}
          {q.isError && <Alert tone="error">Nie udało się wczytać streszczenia. Sprawdź połączenie i spróbuj ponownie.</Alert>}

          {s && (
            <>
              <h2 id="summary-title" className="font-display text-2xl font-bold leading-tight">
                {s.title}
              </h2>

              {s.status === 'pending' && (
                <div className="mt-4">
                  <Alert tone="info">Streszczenie jest w przygotowaniu. Możesz już przeczytać oryginał.</Alert>
                </div>
              )}
              {s.status === 'unavailable' && (
                <div className="mt-4">
                  <Alert tone="warning">Źródło nie zawiera wystarczająco dużo treści na rzetelne streszczenie. Zajrzyj do oryginału.</Alert>
                </div>
              )}

              {s.status === 'ready' && (
                <>
                  {s.basis === 'excerpt' && (
                    <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                      <Info className="size-3.5" aria-hidden /> Na podstawie dostępnego fragmentu
                    </p>
                  )}
                  <p className="mt-4 text-[16px] leading-relaxed text-ink">{s.summary}</p>
                  {s.keyFacts.length > 0 && (
                    <section className="mt-5">
                      <h3 className="text-sm font-bold uppercase tracking-wide text-muted">Najważniejsze fakty</h3>
                      <ul className="mt-2 space-y-1.5">
                        {s.keyFacts.map((f) => (
                          <li key={f} className="flex gap-2 text-[15px] leading-relaxed">
                            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-violet" aria-hidden /> {f}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {s.caveats.length > 0 && (
                    <section className="mt-5 rounded-xl border border-line bg-bg px-4 py-3">
                      <h3 className="text-sm font-bold text-muted">Do zważenia</h3>
                      <ul className="mt-1.5 space-y-1 text-[14px] leading-relaxed text-muted">
                        {s.caveats.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
                    <Sparkles className="size-3.5" aria-hidden /> Streszczenie przygotowane przez AI wyłącznie na podstawie źródła.
                  </p>
                </>
              )}

              {s.why && (
                <section className="mt-5 rounded-xl bg-violet-soft/60 px-4 py-3 text-[14px] leading-relaxed">
                  <h3 className="font-bold text-violet">Dlaczego dla Ciebie</h3>
                  <p className="mt-0.5 text-ink/80">
                    {s.why.kind === 'explore'
                      ? `Odkrywanie: temat spoza Twoich tagów, bliski kategorii „${s.why.interest ?? 'Twoje zainteresowania'}”.`
                      : `Pasuje do Twojego zainteresowania „${s.why.interest}”.`}
                  </p>
                </section>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <a
                  href={s.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => logInteraction(id, 'source_click')}
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-[15px] font-semibold text-white shadow-lift hover:brightness-110"
                >
                  Czytaj więcej <ExternalLink className="size-4" aria-hidden />
                </a>
                <HeartButton liked={s.state.liked} onToggle={() => setState.mutate({ id, patch: { liked: !s.state.liked } })} size="lg" />
              </div>
              <button
                type="button"
                onClick={() => setState.mutate({ id, patch: { read: !s.state.read } })}
                className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-line px-5 text-[15px] font-semibold hover:bg-bg"
              >
                {s.state.read ? (
                  <>
                    <BookX className="size-5" aria-hidden /> Oznacz jako nieprzeczytane
                  </>
                ) : (
                  <>
                    <BookCheck className="size-5" aria-hidden /> Oznacz jako przeczytane
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
