import type { ReactNode } from 'react';
import { Logo } from '../../graphics/Logo.tsx';
import { AuthHero } from '../../graphics/Scenes.tsx';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute -left-24 -top-24 size-96 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="absolute -bottom-32 right-0 size-[28rem] rounded-full bg-white/10 blur-3xl" aria-hidden />
        <span className="relative inline-flex items-center gap-2 font-display text-2xl font-extrabold text-white">ReadYou</span>
        <div className="relative mx-auto w-full max-w-md rounded-[28px] bg-white/95 p-6 shadow-2xl">
          <AuthHero className="w-full" />
        </div>
        <p className="relative max-w-md font-display text-3xl font-bold leading-tight text-white">
          Twoje tematy. Twoje miasto. Codziennie do 20 starannie dobranych artykułów.
        </p>
      </aside>

      <main className="pt-safe flex min-h-dvh flex-col px-4 pb-10 sm:px-8 lg:justify-center">
        <div className="mx-auto w-full max-w-sm">
          <div className="pt-8 pb-6 lg:pt-0">
            <Logo />
          </div>
          <AuthHero className="mx-auto mb-4 w-full max-w-[280px] lg:hidden" />
          <h1 className="font-display text-[26px] font-bold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function GoogleButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface px-4 text-[15px] font-semibold text-ink transition hover:bg-bg disabled:opacity-60"
    >
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
        <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
        <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
        <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
      </svg>
      Kontynuuj z Google
    </button>
  );
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="my-5 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-muted">
      <span className="h-px flex-1 bg-line" />
      {children}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
