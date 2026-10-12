import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Plus, RotateCcw, Sparkles, X } from 'lucide-react';
import { api, ApiError, type AmbiguityDetails, type Interest } from '../lib/api.ts';
import { keys, useInterests } from '../lib/queries.ts';
import { SenseDialog } from './SenseDialog.tsx';
import { Alert } from './ui.tsx';

/**
 * Edytor tagów zainteresowań. Rozdziela stany: jawne, wyuczone (z zachowania) i wykluczone.
 * Wykluczenie ma pierwszeństwo przed uczeniem, dopóki użytkownik go nie cofnie.
 */
export function TagEditor({ showLearned = true, compact = false }: { showLearned?: boolean; compact?: boolean }) {
  const qc = useQueryClient();
  const { data: interests = [], isLoading, error } = useInterests();
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'explicit' | 'excluded'>('explicit');
  const [ambiguity, setAmbiguity] = useState<AmbiguityDetails | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.interests });
    qc.invalidateQueries({ queryKey: keys.me });
  };

  const add = useMutation({
    mutationFn: (v: { label: string; state: 'explicit' | 'excluded'; sense?: string }) => api.post<Interest>('/me/interests', v),
    onSuccess: () => {
      setDraft('');
      setAmbiguity(null);
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'AMBIGUOUS') setAmbiguity(e.details as AmbiguityDetails);
      else setFormError(e.message);
    },
  });
  const remove = useMutation({
    mutationFn: ({ id, block }: { id: string; block: boolean }) => api.delete(`/me/interests/${id}?block=${block}`),
    onSuccess: refresh,
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.patch(`/me/interests/${id}`, { state: 'explicit' }),
    onSuccess: refresh,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (draft.trim()) add.mutate({ label: draft.trim(), state: mode });
  };

  const explicit = interests.filter((i) => i.state === 'explicit');
  const learned = interests.filter((i) => i.state === 'learned');
  const excluded = interests.filter((i) => i.state === 'excluded');

  if (isLoading) return <p className="text-sm text-muted">Ładowanie tagów…</p>;
  if (error) return <Alert tone="error">Nie udało się pobrać tagów.</Alert>;

  return (
    <div className="space-y-5">
      <ul className="flex flex-wrap gap-2" aria-label="Twoje zainteresowania">
        {explicit.length === 0 && <li className="text-sm text-muted">Brak tagów — dodaj pierwszy poniżej.</li>}
        {explicit.map((i) => (
          <li key={i.id}>
            <span
              className="inline-flex min-h-9 items-center gap-1 rounded-full border border-violet/20 bg-violet-soft/60 pl-3 text-sm font-medium text-violet"
              title={i.path.join(' › ')}
            >
              {i.label}
              <button
                type="button"
                onClick={() => remove.mutate({ id: i.id, block: false })}
                className="inline-flex size-9 items-center justify-center rounded-full hover:bg-violet/10"
                aria-label={`Usuń tag ${i.label}`}
              >
                <X className="size-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>

      {!compact && explicit.some((i) => i.path.length > 1) && (
        <details className="text-sm text-muted">
          <summary className="cursor-pointer select-none font-medium">Pokaż ścieżki zainteresowań</summary>
          <ul className="mt-2 space-y-1">
            {explicit
              .filter((i) => i.path.length > 1)
              .map((i) => (
                <li key={i.id}>{i.path.join(' › ')}</li>
              ))}
          </ul>
        </details>
      )}

      <form onSubmit={submit} className="space-y-2">
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="tag-input">
            {mode === 'explicit' ? 'Dodaj zainteresowanie' : 'Wyklucz temat'}
          </label>
          <input
            id="tag-input"
            value={draft}
            maxLength={60}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={mode === 'explicit' ? 'Dodaj temat, np. „Alpy”' : 'Temat, którego nie chcesz widzieć'}
            className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-4 text-[15px] focus:border-violet focus:outline-none focus:ring-4 focus:ring-violet/15"
          />
          <button
            type="submit"
            disabled={!draft.trim() || add.isPending}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand text-white disabled:opacity-40"
            aria-label={mode === 'explicit' ? 'Dodaj' : 'Wyklucz'}
          >
            {mode === 'explicit' ? <Plus className="size-5" /> : <Ban className="size-5" />}
          </button>
        </div>
        {!compact && (
          <button
            type="button"
            onClick={() => setMode(mode === 'explicit' ? 'excluded' : 'explicit')}
            className="text-sm font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {mode === 'explicit' ? 'Chcę raczej wykluczyć temat' : 'Chcę dodać zainteresowanie'}
          </button>
        )}
        {formError && <Alert tone="error">{formError}</Alert>}
      </form>

      {showLearned && (
        <section aria-labelledby="learned-h">
          <h3 id="learned-h" className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="size-4 text-violet" aria-hidden /> Na podstawie polubionych treści
          </h3>
          {learned.length === 0 ? (
            <p className="mt-1 text-sm text-muted">Pojawią się tu tematy, które wyczujemy z Twoich polubień. Zawsze możesz je usunąć.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {learned.map((i) => (
                <li key={i.id} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-dashed border-blue/40 bg-blue-soft/40 pl-3 text-sm text-blue">
                  {i.label}
                  <button
                    type="button"
                    onClick={() => restore.mutate(i.id)}
                    className="inline-flex size-9 items-center justify-center rounded-full hover:bg-blue/10"
                    aria-label={`Zachowaj ${i.label} jako własne zainteresowanie`}
                    title="Zachowaj na stałe"
                  >
                    <Plus className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove.mutate({ id: i.id, block: true })}
                    className="inline-flex size-9 items-center justify-center rounded-full hover:bg-blue/10"
                    aria-label={`Usuń ${i.label} i nie proponuj ponownie`}
                    title="Usuń i nie proponuj"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {excluded.length > 0 && (
        <section aria-labelledby="excluded-h">
          <h3 id="excluded-h" className="flex items-center gap-1.5 text-sm font-semibold">
            <Ban className="size-4 text-muted" aria-hidden /> Wykluczone tematy
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {excluded.map((i) => (
              <li key={i.id} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line bg-bg pl-3 text-sm text-muted line-through decoration-muted/50">
                {i.label}
                <button
                  type="button"
                  onClick={() => restore.mutate(i.id)}
                  className="inline-flex size-9 items-center justify-center rounded-full no-underline hover:bg-ink/5"
                  aria-label={`Przywróć ${i.label}`}
                  title="Przywróć"
                >
                  <RotateCcw className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => remove.mutate({ id: i.id, block: false })}
                  className="inline-flex size-9 items-center justify-center rounded-full hover:bg-ink/5"
                  aria-label={`Usuń wykluczenie ${i.label}`}
                  title="Usuń wykluczenie"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SenseDialog
        details={ambiguity}
        onCancel={() => setAmbiguity(null)}
        onPick={(sense) => add.mutate({ label: draft.trim(), state: mode, sense })}
      />
    </div>
  );
}
