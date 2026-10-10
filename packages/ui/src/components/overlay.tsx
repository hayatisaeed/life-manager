import type { ReactNode } from 'react';
import { Dialog as RDialog, DropdownMenu, Popover as RPopover, Tooltip as RTooltip } from 'radix-ui';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { IconButton } from './button';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-fg/30 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <RDialog.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-lg border border-line bg-bg p-5 shadow-pop safe-bottom sm:inset-auto sm:start-1/2 sm:top-[12vh] sm:bottom-auto sm:w-[min(560px,92vw)] sm:-translate-x-1/2 sm:rounded-lg rtl:sm:translate-x-1/2',
            className,
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <RDialog.Title className="text-title font-semibold">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-1 text-fg-muted">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{typeof title === 'string' ? title : ''}</RDialog.Description>
              )}
            </div>
            <RDialog.Close asChild>
              <IconButton label={t('action.close')} size="sm">
                <X className="size-4" />
              </IconButton>
            </RDialog.Close>
          </div>
          {children}
          {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Side panel on wide screens, bottom sheet on phones (DESIGN.md §5). */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-fg/20" />
        <RDialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-lg border border-line bg-bg p-5 shadow-pop safe-bottom sm:inset-y-0 sm:end-0 sm:start-auto sm:max-h-none sm:w-[440px] sm:rounded-none sm:border-y-0 sm:border-e-0">
          <div className="mb-4 flex items-center justify-between gap-4">
            <RDialog.Title className="text-title font-semibold">{title}</RDialog.Title>
            <RDialog.Description className="sr-only">{typeof title === 'string' ? title : ''}</RDialog.Description>
            <RDialog.Close asChild>
              <IconButton label={t('action.close')} size="sm">
                <X className="size-4" />
              </IconButton>
            </RDialog.Close>
          </div>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'start',
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <RPopover.Root {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align={align}
          sideOffset={6}
          className={cn('z-50 rounded-lg border border-line bg-bg p-3 shadow-pop', className)}
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

export function Menu({ trigger, items }: { trigger: ReactNode; items: (MenuItem | 'separator')[] }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-48 rounded-lg border border-line bg-bg p-1 shadow-pop"
        >
          {items.map((it, i) =>
            it === 'separator' ? (
              <DropdownMenu.Separator key={i} className="my-1 h-px bg-line" />
            ) : (
              <DropdownMenu.Item
                key={i}
                disabled={it.disabled ?? false}
                onSelect={it.onSelect}
                className={cn(
                  'flex h-9 cursor-default items-center gap-2 rounded-sm px-2.5 outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted',
                  it.danger && 'text-danger',
                )}
              >
                {it.icon}
                {it.label}
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={400}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content sideOffset={4} className="z-50 rounded-sm bg-fg px-2 py-1 text-small text-bg">
            {content}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}
