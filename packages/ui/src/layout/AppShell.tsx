import { Link, Outlet } from '@tanstack/react-router';
import { CalendarCheck, Settings, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SyncPill, type SyncStatus } from './SyncPill';

interface NavItem {
  to: '/' | '/settings';
  labelKey: 'nav.today' | 'nav.settings';
  icon: LucideIcon;
}

// More destinations join as their features land (DESIGN.md §5).
const NAV: readonly NavItem[] = [
  { to: '/', labelKey: 'nav.today', icon: CalendarCheck },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
];

/**
 * The app frame (DESIGN.md §5): a sidebar from 640px up, a bottom tab bar
 * below that. Safe-area insets keep the tab bar clear of the home indicator.
 */
export function AppShell({ syncStatus }: { syncStatus: SyncStatus }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh bg-bg text-text">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-e border-border bg-bg-subtle p-3 sm:flex">
        <p className="px-3 pb-4 pt-2 text-heading font-semibold">{t('appName')}</p>
        <nav aria-label={t('nav.main')} className="flex flex-1 flex-col gap-1">
          {NAV.map(({ to, labelKey, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex min-h-9 items-center gap-3 rounded px-3 text-body text-text-muted hover:bg-bg-muted hover:text-text"
              activeProps={{
                className: 'bg-bg-muted text-text font-medium',
                'aria-current': 'page',
              }}
              activeOptions={{ exact: true }}
            >
              <Icon size={16} strokeWidth={1.5} aria-hidden />
              {t(labelKey)}
            </Link>
          ))}
        </nav>
        <div className="px-1 pt-3">
          <SyncPill status={syncStatus} />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-10 sm:pb-10 sm:pt-10">
        <div className="mx-auto max-w-3xl">
          <Outlet />
        </div>
      </main>
      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 flex border-t border-border bg-bg pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        {NAV.map(({ to, labelKey, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-small text-text-muted"
            activeProps={{ className: 'text-accent', 'aria-current': 'page' }}
            activeOptions={{ exact: true }}
          >
            <Icon size={20} strokeWidth={1.5} aria-hidden />
            {t(labelKey)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
