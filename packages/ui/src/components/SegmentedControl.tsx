import * as RadioGroup from '@radix-ui/react-radio-group';
import { clsx } from 'clsx';

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onValueChange: (value: T) => void;
}

/** A small set of mutually exclusive choices, shown side by side. Arrow keys move between them. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onValueChange,
}: SegmentedControlProps<T>) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      onValueChange={(v) => onValueChange(v as T)}
      orientation="horizontal"
      className="inline-flex flex-wrap gap-1 rounded bg-bg-muted p-1"
    >
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          className={clsx(
            'min-h-9 rounded-sm px-3 text-small font-medium text-text-muted transition-colors duration-150',
            'hover:text-text data-[state=checked]:bg-bg data-[state=checked]:text-text data-[state=checked]:shadow-soft',
          )}
        >
          {o.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
