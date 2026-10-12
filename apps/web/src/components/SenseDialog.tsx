import { useEffect, useRef } from 'react';
import type { AmbiguityDetails } from '../lib/api.ts';

/** Krótkie pytanie doprecyzowujące wieloznaczne hasło (np. „Tesla”). */
export function SenseDialog({
  details,
  onPick,
  onCancel,
}: {
  details: AmbiguityDetails | null;
  onPick: (sense: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (details && !d.open) d.showModal();
    if (!details && d.open) d.close();
  }, [details]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(92vw,420px)] rounded-[20px] border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-ink/40 backdrop:backdrop-blur-sm"
      aria-labelledby="sense-title"
    >
      {details && (
        <div className="p-6">
          <h2 id="sense-title" className="font-display text-xl font-bold">
            Które „{details.label}” masz na myśli?
          </h2>
          <p className="mt-1 text-sm text-muted">To hasło ma kilka znaczeń — wybierz właściwe.</p>
          <div className="mt-4 space-y-2">
            {details.senses.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => onPick(s.label)}
                className="block min-h-11 w-full rounded-xl border border-line px-4 py-3 text-left transition hover:border-violet/50 hover:bg-violet-soft/40"
              >
                <span className="block font-semibold">{s.label}</span>
                <span className="block text-sm text-muted">{s.hint}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={onCancel} className="mt-4 min-h-11 w-full rounded-xl text-sm font-medium text-muted hover:bg-ink/5">
            Anuluj
          </button>
        </div>
      )}
    </dialog>
  );
}
