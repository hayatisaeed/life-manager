import { clsx } from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
}

/** One primary action per screen (DESIGN.md §1); everything else is secondary or ghost. */
export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded px-4 text-body font-medium transition-colors duration-150 ease-ui disabled:opacity-50 sm:min-h-9',
        variant === 'primary' && 'bg-accent text-accent-contrast hover:opacity-90',
        variant === 'secondary' && 'border border-border bg-bg text-text hover:bg-bg-subtle',
        variant === 'ghost' && 'text-text-muted hover:bg-bg-subtle hover:text-text',
        className,
      )}
      {...rest}
    />
  );
}
