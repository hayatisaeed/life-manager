import type { ReactNode } from 'react';
import { cn, colorVar } from '../lib/cn';

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-muted text-fg-muted',
    accent: 'bg-accent-soft text-accent',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
  };
  return (
    <span className={cn('inline-flex h-5 items-center rounded-sm px-1.5 text-small font-medium', tones[tone], className)}>
      {children}
    </span>
  );
}

export function Tag({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-sm bg-muted px-1.5 text-small text-fg-muted" dir="auto">
      {color && <span className="size-1.5 rounded-full" style={{ background: colorVar(color) }} />}
      {children}
    </span>
  );
}

export function Dot({ color, className }: { color?: string | undefined; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: colorVar(color) }} />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 text-fg-muted [&_svg]:size-8">{icon}</div>}
      <p className="text-heading font-semibold">{title}</p>
      {body && <p className="max-w-sm text-fg-muted">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

export function ProgressBar({ value, label, color }: { value: number; label: string; color?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${pct}%`, background: color ? colorVar(color) : 'var(--accent)' }} />
    </div>
  );
}

export function ProgressRing({ value, size = 36, label, children }: { value: number; size?: number; label: string; children?: ReactNode }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(v * 100)} className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-muted)" strokeWidth={3} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={3} strokeDasharray={c} strokeDashoffset={c * (1 - v)} strokeLinecap="round" className="transition-[stroke-dashoffset] duration-200" />
      </svg>
      {children && <span className="absolute text-small font-medium tabular">{children}</span>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="text-small text-fg-muted">{label}</div>
      <div className="mt-1 text-title font-semibold tabular">{value}</div>
      {sub && <div className="mt-0.5 text-small text-fg-muted">{sub}</div>}
    </div>
  );
}

/** Tiny line chart; time flows start→end in both directions (DESIGN.md §8). */
export function Sparkline({ values, width = 120, height = 32, label }: { values: number[]; width?: number; height?: number; label: string }) {
  if (values.length < 2) return <svg width={width} height={height} role="img" aria-label={label} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - ((v - min) / span) * (height - 4)}`);
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="rtl:-scale-x-100">
      <polyline points={pts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function Avatar({ name, size = 32, src }: { name: string; size?: number; src?: string | undefined }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 10;
  return src ? (
    <img src={src} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-on-accent"
      style={{ width: size, height: size, background: colorVar(`area-${h}`), fontSize: size * 0.38 }}
    >
      {initials || '?'}
    </span>
  );
}

export function Section({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2">
          {title && <h2 className="text-small font-semibold tracking-wide text-fg-muted uppercase">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border border-line bg-bg p-4', className)}>{children}</div>;
}

export function ListRow({
  children,
  onClick,
  className,
  selected,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  selected?: boolean;
}) {
  const cls = cn(
    'flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-start transition-colors',
    onClick && 'hover:bg-subtle',
    selected && 'bg-muted',
    className,
  );
  return onClick ? (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cls}
    >
      {children}
    </div>
  ) : (
    <div className={cls}>{children}</div>
  );
}

export function Rating({ value, onChange, max = 5, label }: { value: number | undefined; onChange: (v: number) => void; max?: number; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={String(n)}
          onClick={() => onChange(n)}
          className={cn('size-8 rounded-sm text-heading transition-colors', value !== undefined && n <= value ? 'text-warning' : 'text-line hover:text-fg-muted')}
        >
          ★
        </button>
      ))}
    </div>
  );
}
