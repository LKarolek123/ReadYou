import { NavLink, Outlet } from 'react-router';
import { CalendarDays, Newspaper, TrendingUp, UserRound } from 'lucide-react';
import { Logo } from '../graphics/Logo.tsx';

/** Dokładnie cztery główne zakładki (spec. 1). */
const TABS = [
  { to: '/articles', label: 'Artykuły', icon: Newspaper },
  { to: '/events', label: 'Wydarzenia', icon: CalendarDays },
  { to: '/trending', label: 'Trending', icon: TrendingUp },
  { to: '/profile', label: 'Profil', icon: UserRound },
] as const;

export function AppShell() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      {/* Komputer: nawigacja boczna */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
        <Logo className="px-2" />
        <nav className="mt-8 flex flex-col gap-1" aria-label="Główna nawigacja">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold transition ${
                  isActive ? 'bg-violet-soft text-violet' : 'text-muted hover:bg-bg hover:text-ink'
                }`
              }
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Treść — dolny odstęp na telefonie, żeby nawigacja nie zasłaniała treści */}
      <div className="min-w-0 pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-0">
        <Outlet />
      </div>

      {/* Telefon: dolna nawigacja */}
      <nav
        className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
        aria-label="Główna nawigacja"
      >
        <ul className="mx-auto grid h-[68px] max-w-lg grid-cols-4">
          {TABS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `flex h-full flex-col items-center justify-center gap-1 text-[11px] font-semibold transition ${
                    isActive ? 'text-violet' : 'text-muted'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={`inline-flex h-8 w-14 items-center justify-center rounded-full transition ${isActive ? 'bg-violet-soft' : ''}`}>
                      <Icon className="size-[22px]" aria-hidden strokeWidth={isActive ? 2.4 : 2} />
                    </span>
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export function PageHeader({ title, actions, children }: { title: string; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="pt-safe sticky top-0 z-10 border-b border-line/60 bg-bg/90 backdrop-blur">
      <div className="mx-auto w-full max-w-5xl px-4 lg:px-8">
        <div className="flex min-h-14 items-center justify-between gap-3 py-2">
          <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
          {actions}
        </div>
        {children && <div className="pb-3">{children}</div>}
      </div>
    </header>
  );
}
