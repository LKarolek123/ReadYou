import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { LogoMark } from '../../graphics/Logo.tsx';

export const STEP_TITLES = ['Miasto', 'Studia', 'Budżet i czas', 'Aktywności', 'Zainteresowania', 'Pogłębianie', 'Twoje tagi', 'Raport'];

export function OnboardingLayout({
  index,
  title,
  subtitle,
  onBack,
  footer,
  children,
  aside,
}: {
  index: number;
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  footer: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  const total = STEP_TITLES.length;
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="pt-safe sticky top-0 z-10 border-b border-line/70 bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-4">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="-ml-2 inline-flex size-11 items-center justify-center rounded-xl text-muted hover:bg-ink/5 hover:text-ink"
              aria-label="Wstecz"
            >
              <ArrowLeft className="size-5" />
            </button>
          ) : (
            <LogoMark size={28} />
          )}
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs font-medium text-muted">
              <span>
                Krok {index + 1} z {total} · {STEP_TITLES[index]}
              </span>
            </div>
            <div
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={total}
              aria-valuenow={index + 1}
              aria-label="Postęp konfiguracji"
            >
              <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${((index + 1) / total) * 100}%` }} />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-6 pb-36">
        {aside}
        <h1 className="font-display text-[26px] font-bold leading-tight tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </main>

      <footer className="pb-safe fixed inset-x-0 bottom-0 z-10 border-t border-line/70 bg-surface/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-end gap-2 px-4 py-3">{footer}</div>
      </footer>
    </div>
  );
}
