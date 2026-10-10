import type { ReactNode } from 'react';

/** Teaches the feature in one sentence and offers at most one action (DESIGN.md §7). */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <p className="text-heading font-semibold text-text">{title}</p>
      <p className="max-w-sm text-body text-text-muted">{body}</p>
      {action}
    </div>
  );
}
