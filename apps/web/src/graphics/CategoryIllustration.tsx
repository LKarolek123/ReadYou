import { useId, type ReactNode } from 'react';
import type { IllustrationKey } from '@readyou/shared';

/**
 * Abstrakcyjne ilustracje kategorii (własne SVG, bez praw osób trzecich).
 * Służą jako obraz zastępczy kart i grafika onboardingu. Celowo nie udają zdjęć
 * konkretnych wydarzeń ani faktów — to miękkie gradienty z prostym glifem tematu.
 */

type Palette = { from: string; to: string; accent: string };

const PALETTES: Record<IllustrationKey, Palette> = {
  mountains: { from: '#6D28D9', to: '#0EA5E9', accent: '#C4B5FD' },
  tech: { from: '#7C3AED', to: '#2563EB', accent: '#A5B4FC' },
  science: { from: '#4F46E5', to: '#06B6D4', accent: '#A5F3FC' },
  sport: { from: '#2563EB', to: '#7C3AED', accent: '#93C5FD' },
  dance: { from: '#A21CAF', to: '#6366F1', accent: '#F5D0FE' },
  games: { from: '#5B21B6', to: '#1D4ED8', accent: '#DDD6FE' },
  music: { from: '#9333EA', to: '#3B82F6', accent: '#E9D5FF' },
  culture: { from: '#7E22CE', to: '#DB2777', accent: '#FBCFE8' },
  business: { from: '#1E40AF', to: '#7C3AED', accent: '#BFDBFE' },
  auto: { from: '#312E81', to: '#2563EB', accent: '#C7D2FE' },
  food: { from: '#7C3AED', to: '#F97316', accent: '#FED7AA' },
  nature: { from: '#6D28D9', to: '#10B981', accent: '#A7F3D0' },
  travel: { from: '#2563EB', to: '#8B5CF6', accent: '#BAE6FD' },
  events: { from: '#7C3AED', to: '#EC4899', accent: '#FBCFE8' },
  generic: { from: '#7C3AED', to: '#2563EB', accent: '#DDD6FE' },
};

const LABELS: Record<IllustrationKey, string> = {
  mountains: 'góry',
  tech: 'technologia',
  science: 'nauka',
  sport: 'sport',
  dance: 'taniec',
  games: 'gry i szachy',
  music: 'muzyka',
  culture: 'kultura',
  business: 'biznes',
  auto: 'motoryzacja',
  food: 'kulinaria',
  nature: 'przyroda',
  travel: 'podróże',
  events: 'wydarzenia',
  generic: 'ReadYou',
};

/** Glify rysowane w polu 100×100, białą linią. */
const GLYPHS: Record<IllustrationKey, ReactNode> = {
  mountains: (
    <>
      <path d="M4 84 L34 36 L50 58 L66 26 L96 84 Z" fill="currentColor" fillOpacity=".18" />
      <path d="M4 84 L34 36 L50 58 L66 26 L96 84" />
      <path d="M58 39 L66 26 L74 39 L68 36 L63 41 Z" fill="currentColor" stroke="none" />
      <circle cx="22" cy="20" r="7" fill="currentColor" stroke="none" fillOpacity=".9" />
    </>
  ),
  tech: (
    <>
      <rect x="26" y="26" width="48" height="48" rx="10" fill="currentColor" fillOpacity=".15" />
      <rect x="38" y="38" width="24" height="24" rx="5" fill="currentColor" stroke="none" fillOpacity=".9" />
      <path d="M38 14v12M50 14v12M62 14v12M38 74v12M50 74v12M62 74v12M14 38h12M14 50h12M14 62h12M74 38h12M74 50h12M74 62h12" />
    </>
  ),
  science: (
    <>
      <ellipse cx="50" cy="50" rx="40" ry="15" />
      <ellipse cx="50" cy="50" rx="40" ry="15" transform="rotate(60 50 50)" />
      <ellipse cx="50" cy="50" rx="40" ry="15" transform="rotate(120 50 50)" />
      <circle cx="50" cy="50" r="7" fill="currentColor" stroke="none" />
    </>
  ),
  sport: (
    <>
      <circle cx="50" cy="50" r="36" fill="currentColor" fillOpacity=".15" />
      <path d="M50 14c-14 12-14 60 0 72M50 14c14 12 14 60 0 72M15 42c20 8 50 8 70 0M15 58c20-8 50-8 70 0" />
    </>
  ),
  dance: (
    <>
      <circle cx="56" cy="16" r="8" fill="currentColor" stroke="none" />
      <path d="M54 28 C46 44 48 54 56 62 L46 88" />
      <path d="M56 62 L72 84" />
      <path d="M52 36 L30 26 M52 36 L76 46" />
      <path d="M14 70c10-14 24-14 30-4" strokeOpacity=".7" />
    </>
  ),
  games: (
    <>
      <circle cx="50" cy="24" r="10" fill="currentColor" fillOpacity=".25" />
      <path d="M50 34 C40 40 40 56 42 66 H58 C60 56 60 40 50 34 Z" fill="currentColor" fillOpacity=".25" />
      <path d="M30 80 H70 L66 68 H34 Z" fill="currentColor" stroke="none" fillOpacity=".9" />
      <path d="M8 92h84" strokeOpacity=".5" />
    </>
  ),
  music: (
    <>
      <path d="M38 72 V22 L80 12 V62" />
      <circle cx="28" cy="72" r="11" fill="currentColor" stroke="none" />
      <circle cx="70" cy="62" r="11" fill="currentColor" stroke="none" />
      <path d="M38 34 L80 24" />
    </>
  ),
  culture: (
    <>
      <path d="M10 34 L50 12 L90 34 Z" fill="currentColor" fillOpacity=".2" />
      <path d="M10 34 L50 12 L90 34 H10" />
      <path d="M22 42v36M41 42v36M59 42v36M78 42v36" />
      <path d="M8 86h84" />
    </>
  ),
  business: (
    <>
      <rect x="14" y="58" width="14" height="28" rx="3" fill="currentColor" stroke="none" fillOpacity=".6" />
      <rect x="36" y="44" width="14" height="42" rx="3" fill="currentColor" stroke="none" fillOpacity=".75" />
      <rect x="58" y="30" width="14" height="56" rx="3" fill="currentColor" stroke="none" fillOpacity=".9" />
      <path d="M12 40 L40 22 L56 30 L86 10 M72 10h14v14" />
    </>
  ),
  auto: (
    <>
      <path d="M8 66 V54 L22 50 L34 32 H66 L80 50 L92 54 V66 Z" fill="currentColor" fillOpacity=".2" />
      <path d="M8 66 V54 L22 50 L34 32 H66 L80 50 L92 54 V66 H8" />
      <circle cx="28" cy="68" r="9" fill="currentColor" stroke="none" />
      <circle cx="72" cy="68" r="9" fill="currentColor" stroke="none" />
      <path d="M24 50 H78" strokeOpacity=".6" />
    </>
  ),
  food: (
    <>
      <path d="M10 50 H90 C90 72 72 86 50 86 C28 86 10 72 10 50 Z" fill="currentColor" fillOpacity=".25" />
      <path d="M10 50 H90 C90 72 72 86 50 86 C28 86 10 72 10 50" />
      <path d="M36 38c-6-8 6-12 0-22M52 38c-6-8 6-12 0-22M68 38c-6-8 6-12 0-22" strokeOpacity=".8" />
    </>
  ),
  nature: (
    <>
      <path d="M20 82 C16 40 44 14 86 14 C86 56 62 84 20 82 Z" fill="currentColor" fillOpacity=".22" />
      <path d="M20 82 C16 40 44 14 86 14 C86 56 62 84 20 82 Z" />
      <path d="M20 82 C40 60 56 44 74 28" />
    </>
  ),
  travel: (
    <>
      <circle cx="50" cy="50" r="36" fill="currentColor" fillOpacity=".15" />
      <circle cx="50" cy="50" r="36" />
      <ellipse cx="50" cy="50" rx="15" ry="36" />
      <path d="M14 50h72M20 32h60M20 68h60" />
    </>
  ),
  events: (
    <>
      <path d="M10 30 H90 V44 A8 8 0 0 0 90 60 V74 H10 V60 A8 8 0 0 0 10 44 Z" fill="currentColor" fillOpacity=".2" />
      <path d="M10 30 H90 V44 A8 8 0 0 0 90 60 V74 H10 V60 A8 8 0 0 0 10 44 Z" />
      <path d="M64 30 V74" strokeDasharray="4 6" />
      <path d="M26 46h24M26 58h16" />
    </>
  ),
  generic: (
    <>
      <path d="M50 8 L58 42 L92 50 L58 58 L50 92 L42 58 L8 50 L42 42 Z" fill="currentColor" fillOpacity=".9" stroke="none" />
      <circle cx="82" cy="20" r="6" fill="currentColor" stroke="none" fillOpacity=".7" />
    </>
  ),
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

interface Props {
  kind: IllustrationKey;
  /** Ziarno wariantu kompozycji (np. ID treści), by karty tej samej kategorii się różniły. */
  seed?: string;
  className?: string;
  /** Ustaw, gdy ilustracja jest czysto dekoracyjna obok tekstu. */
  decorative?: boolean;
}

export function CategoryIllustration({ kind, seed = '', className, decorative }: Props) {
  const uid = useId().replace(/:/g, '');
  const p = PALETTES[kind] ?? PALETTES.generic;
  const h = hash(kind + seed);
  const r = (n: number, min: number, max: number) => min + (((h >>> n) & 0xff) / 255) * (max - min);

  const blobs = [
    { cx: r(0, 20, 120), cy: r(4, 10, 80), rr: r(8, 60, 90), o: 0.22 },
    { cx: r(12, 220, 310), cy: r(16, 120, 190), rr: r(20, 70, 110), o: 0.18 },
    { cx: r(24, 120, 220), cy: r(28, 160, 220), rr: r(2, 40, 70), o: 0.14 },
  ];

  return (
    <svg
      viewBox="0 0 320 200"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `Ilustracja kategorii: ${LABELS[kind]}`}
    >
      <defs>
        <linearGradient id={`bg${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={p.from} />
          <stop offset="1" stopColor={p.to} />
        </linearGradient>
        <radialGradient id={`glow${uid}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <pattern id={`dots${uid}`} width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.1" fill="#fff" fillOpacity=".18" />
        </pattern>
      </defs>
      <rect width="320" height="200" fill={`url(#bg${uid})`} />
      {blobs.map((b, i) => (
        <circle key={i} cx={b.cx} cy={b.cy} r={b.rr} fill={i === 1 ? p.accent : '#fff'} fillOpacity={b.o} />
      ))}
      <rect width="320" height="200" fill={`url(#dots${uid})`} />
      <circle cx="226" cy="100" r="96" fill={`url(#glow${uid})`} />
      <g
        transform="translate(170 44) scale(1.12)"
        color="#fff"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {GLYPHS[kind] ?? GLYPHS.generic}
      </g>
    </svg>
  );
}
