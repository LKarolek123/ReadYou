import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white shadow-lift hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface text-ink border border-line hover:border-violet/40 hover:bg-violet-soft/40',
  ghost: 'text-muted hover:text-ink hover:bg-ink/5',
  danger: 'bg-surface text-danger border border-danger/30 hover:bg-danger/5',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading, block, className = '', children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField(
  { label, hint, error, id, className = '', ...rest },
  ref,
) {
  const inputId = id ?? `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <label htmlFor={inputId} className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${inputId}-desc` : undefined}
        className="min-h-12 w-full rounded-xl border border-line bg-surface px-4 text-[15px] text-ink placeholder:text-muted/70 transition focus:border-violet focus:outline-none focus:ring-4 focus:ring-violet/15 aria-[invalid]:border-danger"
        {...rest}
      />
      {(hint || error) && (
        <span id={`${inputId}-desc`} className={`mt-1.5 block text-sm ${error ? 'text-danger' : 'text-muted'}`}>
          {error ?? hint}
        </span>
      )}
    </label>
  );
});

export function Chip({
  selected,
  onClick,
  children,
  icon,
  size = 'md',
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
  size?: 'md' | 'sm';
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium transition ${
        size === 'md' ? 'min-h-11 px-4 text-[15px]' : 'min-h-9 px-3 text-sm'
      } ${
        selected
          ? 'border-transparent bg-brand text-white shadow-lift'
          : 'border-line bg-surface text-ink hover:border-violet/40 hover:bg-violet-soft/40'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[var(--radius-card)] border border-line bg-surface shadow-card ${className}`}>{children}</div>;
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success' | 'warning'; children: ReactNode }) {
  const tones = {
    info: 'bg-blue-soft/60 text-blue border-blue/20',
    error: 'bg-danger/5 text-danger border-danger/20',
    success: 'bg-success/5 text-success border-success/20',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Spinner({ label = 'Ładowanie…' }: { label?: string }) {
  return (
    <div className="flex min-h-[40dvh] items-center justify-center gap-3 text-muted" role="status">
      <Loader2 className="size-5 animate-spin text-violet" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-line bg-surface p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition ${
            value === o.value ? 'bg-brand text-white shadow-sm' : 'text-muted hover:text-ink'
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
