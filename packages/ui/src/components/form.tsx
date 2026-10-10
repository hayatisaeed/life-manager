import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Checkbox as RCheckbox, Switch as RSwitch } from 'radix-ui';
import { Check } from 'lucide-react';
import { cn } from '../lib/cn';

const control =
  'w-full rounded-md border border-line bg-bg px-3 text-fg placeholder:text-fg-muted transition-colors focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} dir="auto" className={cn(control, 'h-9', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 4, ...rest },
  ref,
) {
  return <textarea ref={ref} dir="auto" rows={rows} className={cn(control, 'py-2', className)} {...rest} />;
});

export interface SelectOption {
  value: string;
  label: string;
}

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { options: SelectOption[]; placeholder?: string }
>(function Select({ className, options, placeholder, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(control, 'h-9 pe-8', className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
});

/** Label + control + hint/error, wired up for screen readers. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode | undefined;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-small font-medium text-fg">
        {label}
      </label>
      {children(id, hint || error ? hintId : undefined)}
      {(error || hint) && (
        <p id={hintId} className={cn('text-small', error ? 'text-danger' : 'text-fg-muted')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  className,
  round,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  className?: string;
  round?: boolean;
}) {
  return (
    <RCheckbox.Root
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      aria-label={label}
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center border-[1.5px] border-fg-muted transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        round ? 'rounded-full' : 'rounded-sm',
        className,
      )}
    >
      <RCheckbox.Indicator>
        <Check className="size-3.5 text-on-accent" strokeWidth={3} />
      </RCheckbox.Indicator>
    </RCheckbox.Root>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: string;
  id?: string;
}) {
  return (
    <RSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-line transition-colors data-[state=checked]:bg-accent"
    >
      <RSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-bg shadow-soft transition-transform data-[state=checked]:translate-x-[18px] rtl:-translate-x-0.5 rtl:data-[state=checked]:-translate-x-[18px]" />
    </RSwitch.Root>
  );
}

/** Segmented control for 2–5 mutually exclusive options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-md bg-muted p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-8 rounded-sm px-3 text-small font-medium transition-colors',
            value === o.value ? 'bg-bg text-fg shadow-soft' : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
