import clsx from 'clsx';
import type { ClassValue } from 'clsx';

export const cn = (...v: ClassValue[]): string => clsx(v);

export const AREA_COLORS = Array.from({ length: 10 }, (_, i) => `area-${i}`);

/** Map a stored color token (e.g. "area-3") to a CSS color value. */
export const colorVar = (c: string | undefined): string =>
  c && /^area-\d$/.test(c) ? `var(--${c})` : 'var(--accent)';
