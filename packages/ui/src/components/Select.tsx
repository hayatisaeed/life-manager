import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onValueChange: (value: T) => void;
}

export function Select<T extends string>({ label, value, options, onValueChange }: SelectProps<T>) {
  return (
    <RadixSelect.Root value={value} onValueChange={(v) => onValueChange(v as T)}>
      <RadixSelect.Trigger
        aria-label={label}
        className="inline-flex min-h-11 min-w-40 items-center justify-between gap-2 rounded border border-border bg-bg px-3 text-body text-text hover:bg-bg-subtle sm:min-h-9"
      >
        <RadixSelect.Value />
        <RadixSelect.Icon>
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded border border-border bg-bg shadow-soft"
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value}
                value={o.value}
                className="flex min-h-9 cursor-default items-center justify-between gap-4 rounded-sm px-2 text-body text-text outline-none data-[highlighted]:bg-bg-muted"
              >
                <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator>
                  <Check size={16} strokeWidth={1.5} aria-hidden />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
