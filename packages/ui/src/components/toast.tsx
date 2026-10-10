// Undo toasts instead of confirmation dialogs (DESIGN.md §7).

import { useEffect } from 'react';
import { create } from 'zustand';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';

export interface ToastItem {
  id: number;
  message: string;
  tone?: 'neutral' | 'danger' | 'success';
  action?: { label: string; run: () => void };
  durationMs?: number;
}

interface ToastState {
  items: ToastItem[];
  push: (t: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
export const useToasts = create<ToastState>((set) => ({
  items: [],
  push: (t) => set((s) => ({ items: [...s.items.slice(-3), { ...t, id: nextId++ }] })),
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

export const toast = (message: string, opts: Omit<ToastItem, 'id' | 'message'> = {}) =>
  useToasts.getState().push({ message, ...opts });

function ToastView({ item }: { item: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss);
  const { t } = useTranslation();
  useEffect(() => {
    const h = setTimeout(() => dismiss(item.id), item.durationMs ?? (item.action ? 6000 : 3500));
    return () => clearTimeout(h);
  }, [item, dismiss]);
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex min-h-11 w-full items-center gap-3 rounded-lg border border-line bg-fg px-4 py-2 text-bg shadow-pop sm:w-auto sm:max-w-md',
        item.tone === 'danger' && 'bg-danger text-on-accent',
      )}
    >
      <span className="flex-1" dir="auto">
        {item.message}
      </span>
      {item.action && (
        <button
          type="button"
          className="font-semibold underline-offset-2 hover:underline"
          onClick={() => {
            item.action?.run();
            dismiss(item.id);
          }}
        >
          {item.action.label}
        </button>
      )}
      <button type="button" aria-label={t('action.close')} onClick={() => dismiss(item.id)} className="opacity-70 hover:opacity-100">
        <X className="size-4" />
      </button>
    </div>
  );
}

export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-3 sm:bottom-6">
      {items.map((i) => (
        <ToastView key={i.id} item={i} />
      ))}
    </div>
  );
}
