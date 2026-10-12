import { useId } from 'react';

/**
 * Ilustracje dekoracyjne ekranów: logowanie i puste stany zakładek.
 * Wszystkie są czysto dekoracyjne (aria-hidden) — znaczenie niesie tekst obok.
 */

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#7C3AED" />
        <stop offset="1" stopColor="#2563EB" />
      </linearGradient>
      <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#EDE9FE" />
        <stop offset="1" stopColor="#DBEAFE" />
      </linearGradient>
    </defs>
  );
}

/** Ekran powitalny: stos kart z różnymi tematami, wachlarzem. */
export function AuthHero({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 360 260" className={className} aria-hidden>
      <Defs id={id} />
      <circle cx="180" cy="130" r="118" fill={`url(#s${id})`} />
      <circle cx="300" cy="44" r="10" fill="#7C3AED" fillOpacity=".25" />
      <circle cx="52" cy="210" r="14" fill="#2563EB" fillOpacity=".2" />
      <g transform="rotate(-12 120 150)">
        <rect x="60" y="70" width="120" height="150" rx="18" fill="#fff" stroke="#E2E8F0" />
        <rect x="72" y="82" width="96" height="62" rx="12" fill="#C4B5FD" />
        <path d="M78 136 L102 104 L114 120 L126 98 L160 136 Z" fill="#fff" fillOpacity=".8" />
        <rect x="72" y="156" width="80" height="8" rx="4" fill="#CBD5E1" />
        <rect x="72" y="172" width="56" height="8" rx="4" fill="#E2E8F0" />
      </g>
      <g transform="rotate(10 240 150)">
        <rect x="180" y="70" width="120" height="150" rx="18" fill="#fff" stroke="#E2E8F0" />
        <rect x="192" y="82" width="96" height="62" rx="12" fill="#93C5FD" />
        <circle cx="240" cy="113" r="20" fill="none" stroke="#fff" strokeWidth="5" />
        <path d="M228 113h24M240 101v24" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
        <rect x="192" y="156" width="80" height="8" rx="4" fill="#CBD5E1" />
        <rect x="192" y="172" width="64" height="8" rx="4" fill="#E2E8F0" />
      </g>
      <g>
        <rect x="116" y="52" width="128" height="164" rx="20" fill="#fff" stroke="#E2E8F0" />
        <rect x="128" y="64" width="104" height="72" rx="14" fill={`url(#g${id})`} />
        <path d="M150 112c6-2 12-1 18 3v-26c-6-4-12-5-18-3z M210 112c-6-2-12-1-18 3v-26c6-4 12-5 18-3z" fill="#fff" />
        <rect x="128" y="148" width="92" height="9" rx="4.5" fill="#0F172A" fillOpacity=".8" />
        <rect x="128" y="164" width="70" height="8" rx="4" fill="#CBD5E1" />
        <circle cx="140" cy="196" r="11" fill="#EDE9FE" />
        <path d="M140 201l-5-5a3.2 3.2 0 0 1 5-4 3.2 3.2 0 0 1 5 4z" fill="#7C3AED" />
        <circle cx="168" cy="196" r="11" fill="#DBEAFE" />
        <path d="M162 192h5a2 2 0 0 1 1 1v8a2 2 0 0 0-1-1h-5zM174 192h-5a2 2 0 0 0-1 1v8a2 2 0 0 1 1-1h5z" fill="#2563EB" />
      </g>
      <path d="M300 160 l4 12 12 4 -12 4 -4 12 -4 -12 -12 -4 12 -4z" fill={`url(#g${id})`} />
      <path d="M60 50 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" fill="#7C3AED" fillOpacity=".6" />
    </svg>
  );
}

export type EmptyKind = 'articles' | 'events' | 'trending' | 'saved' | 'read';

/** Pusty stan zakładki — spokojna kompozycja bez udawania treści. */
export function EmptyScene({ kind, className }: { kind: EmptyKind; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 240 160" className={className} aria-hidden>
      <Defs id={id} />
      <ellipse cx="120" cy="140" rx="84" ry="10" fill="#E2E8F0" />
      <circle cx="120" cy="76" r="62" fill={`url(#s${id})`} />
      {kind === 'articles' && (
        <g>
          <rect x="78" y="40" width="70" height="88" rx="12" fill="#fff" stroke="#E2E8F0" transform="rotate(-8 113 84)" />
          <rect x="92" y="34" width="70" height="88" rx="12" fill="#fff" stroke="#E2E8F0" />
          <rect x="102" y="44" width="50" height="30" rx="8" fill={`url(#g${id})`} />
          <rect x="102" y="82" width="44" height="6" rx="3" fill="#CBD5E1" />
          <rect x="102" y="94" width="30" height="6" rx="3" fill="#E2E8F0" />
        </g>
      )}
      {kind === 'events' && (
        <g>
          <rect x="80" y="38" width="80" height="80" rx="14" fill="#fff" stroke="#E2E8F0" />
          <rect x="80" y="38" width="80" height="22" rx="14" fill={`url(#g${id})`} />
          <rect x="80" y="50" width="80" height="10" fill={`url(#g${id})`} />
          <path d="M98 32v14M142 32v14" stroke="#0F172A" strokeWidth="5" strokeLinecap="round" />
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3].map((c) => (
              <rect key={`${r}${c}`} x={92 + c * 15} y={70 + r * 14} width="9" height="8" rx="2" fill={r === 1 && c === 2 ? '#7C3AED' : '#E2E8F0'} />
            )),
          )}
        </g>
      )}
      {kind === 'trending' && (
        <g>
          <path d="M70 116 L100 86 L120 100 L166 50" stroke={`url(#g${id})`} strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M146 48h22v22" stroke="#2563EB" strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="100" cy="86" r="6" fill="#fff" stroke="#7C3AED" strokeWidth="4" />
          <circle cx="120" cy="100" r="6" fill="#fff" stroke="#5B4BEB" strokeWidth="4" />
        </g>
      )}
      {kind === 'saved' && (
        <path d="M120 120 L84 84 a22 22 0 0 1 36 -26 a22 22 0 0 1 36 26 Z" fill={`url(#g${id})`} />
      )}
      {kind === 'read' && (
        <g>
          <path d="M72 50c16-6 32-3 48 8v62c-16-10-32-13-48-7z" fill="#fff" stroke="#E2E8F0" />
          <path d="M168 50c-16-6-32-3-48 8v62c16-10 32-13 48-7z" fill="#fff" stroke="#E2E8F0" />
          <circle cx="160" cy="44" r="16" fill={`url(#g${id})`} />
          <path d="M152 44l6 6 10-11" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
}
