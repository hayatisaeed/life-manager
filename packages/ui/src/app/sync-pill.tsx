import { CloudOff, RefreshCw, TriangleAlert, Check, HardDrive, PauseCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { cn } from '../lib/cn';
import { useServices } from './context';

export function SyncPill({ compact }: { compact?: boolean }) {
  const { sync } = useServices();
  const st = sync.ui();
  const { t } = useTranslation();
  let icon = <Check className="size-3.5" />;
  let label = t('sync.synced');
  let tone = 'text-fg-muted';
  if (!st.configured) {
    icon = <HardDrive className="size-3.5" />;
    label = t('sync.localOnly');
  } else if (st.phase === 'syncing') {
    icon = <RefreshCw className="size-3.5 animate-spin" />;
    label = st.progress && st.progress.total > 20 ? t('sync.progress', st.progress) : t('sync.syncing');
  } else if (st.phase === 'offline') {
    icon = <CloudOff className="size-3.5" />;
    label = t('sync.offline');
  } else if (st.phase === 'paused') {
    icon = <PauseCircle className="size-3.5" />;
    label = t('sync.paused');
    tone = 'text-warning';
  } else if (st.phase === 'error' || st.phase === 'rateLimited') {
    icon = <TriangleAlert className="size-3.5" />;
    label = st.phase === 'error' ? t('sync.error') : t('sync.rateLimited');
    tone = 'text-danger';
  }
  return (
    <Link
      to="/settings/sync"
      aria-label={label}
      title={st.error ?? label}
      className={cn('inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-small hover:bg-muted', tone)}
    >
      {icon}
      {!compact && <span className="truncate">{label}</span>}
    </Link>
  );
}
