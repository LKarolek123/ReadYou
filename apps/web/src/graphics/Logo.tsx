import { useId } from 'react';

/** Znak ReadYou: otwarta książka w gradiencie fiolet → niebieski z „iskrą” odkrywania. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id={`lg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7C3AED" />
          <stop offset="1" stopColor="#2563EB" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#lg${id})`} />
      <path d="M14 20c6-2 12-1 18 3v25c-6-4-12-5-18-3z" fill="#fff" />
      <path d="M50 20c-6-2-12-1-18 3v25c6-4 12-5 18-3z" fill="#fff" fillOpacity=".72" />
      <circle cx="46" cy="15" r="4" fill="#fff" />
    </svg>
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={32} />
      <span className="font-display text-xl font-extrabold tracking-tight">
        Read<span className="text-brand">You</span>
      </span>
    </span>
  );
}
