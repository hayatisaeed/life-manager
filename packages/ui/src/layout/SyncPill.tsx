import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

export type SyncStatus = 'local' | 'synced' | 'syncing' | 'offline' | 'error';

/** Small and calm (DESIGN.md §7): a dot and a word, in the sidebar footer. */
export function SyncPill({ status }: { status: SyncStatus }) {
  const { t } = useTranslation();
  return (
    <span
      role="status"
      className="inline-flex items-center gap-2 rounded-full bg-bg-muted px-3 py-1 text-small text-text-muted"
    >
      <span
        aria-hidden
        className={clsx(
          'size-2 rounded-full',
          status === 'synced' && 'bg-success',
          status === 'syncing' && 'animate-pulse bg-accent',
          status === 'error' && 'bg-danger',
          (status === 'local' || status === 'offline') && 'bg-text-muted',
        )}
      />
      {t(`sync.${status}`)}
    </span>
  );
}
