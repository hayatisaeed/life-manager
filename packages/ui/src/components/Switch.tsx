import * as RadixSwitch from '@radix-ui/react-switch';
import { useId } from 'react';

export interface SwitchProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, checked, onCheckedChange, disabled = false }: SwitchProps) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <label htmlFor={id} className="text-body text-text">
        {label}
      </label>
      <RadixSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative h-6 w-10 shrink-0 rounded-full bg-bg-muted transition-colors duration-150 data-[state=checked]:bg-accent disabled:opacity-50"
      >
        <RadixSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-bg shadow-soft transition-transform duration-150 data-[state=checked]:translate-x-[18px] rtl:-translate-x-0.5 rtl:data-[state=checked]:-translate-x-[18px]" />
      </RadixSwitch.Root>
    </div>
  );
}
