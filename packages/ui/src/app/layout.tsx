// App layout (DESIGN.md §5): collapsible sidebar on wide screens, bottom tab
// bar on phones, main content in between.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Menu as MenuIcon, MoreHorizontal, PanelLeft, Plus, Sun, Users } from 'lucide-react';
import { cn } from '../lib/cn';
import { IconButton } from '../components/button';
import { NAV, SETTINGS_NAV } from './nav';
import { SyncPill } from './sync-pill';
import { useUi } from './ui-state';

function NavLink({ to, icon: Icon, label, onClick }: { to: string; icon: typeof Sun; label: string; onClick?: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active = path === to || path.startsWith(`${to}/`);
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-9 items-center gap-3 rounded-md px-2.5 text-fg-muted transition-colors hover:bg-muted hover:text-fg',
        active && 'bg-muted font-medium text-fg',
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const openCapture = useUi((s) => s.openCapture);
  return (
    <div className="flex h-full flex-col gap-1 p-3">
      <div className="mb-3 flex items-center justify-between px-1">
        <span className="text-heading font-semibold">{t('app.name')}</span>
        <IconButton label={t('nav.capture')} size="sm" onClick={() => openCapture()}>
          <Plus className="size-4" />
        </IconButton>
      </div>
      <nav aria-label={t('app.name')} className="flex flex-col gap-0.5">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} icon={n.icon} label={t(`nav.${n.key}`)} {...(onNavigate ? { onClick: onNavigate } : {})} />
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-1 border-t border-line pt-2">
        <NavLink to={SETTINGS_NAV.to} icon={SETTINGS_NAV.icon} label={t('nav.settings')} {...(onNavigate ? { onClick: onNavigate } : {})} />
        <SyncPill />
      </div>
    </div>
  );
}

function BottomTabs() {
  const { t } = useTranslation();
  const openCapture = useUi((s) => s.openCapture);
  const setMore = useUi((s) => s.setMoreOpen);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const tab = (to: string, Icon: typeof Sun, label: string) => {
    const active = path.startsWith(to);
    return (
      <Link to={to} aria-current={active ? 'page' : undefined} className={cn('flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]', active ? 'text-accent' : 'text-fg-muted')}>
        <Icon className="size-5" strokeWidth={1.75} />
        {label}
      </Link>
    );
  };
  return (
    <nav aria-label={t('app.name')} className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-bg/95 backdrop-blur safe-bottom sm:hidden">
      {tab('/today', Sun, t('nav.today'))}
      {tab('/planner', CalendarDays, t('nav.planner'))}
      <button type="button" onClick={() => openCapture()} className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-fg-muted">
        <span className="flex size-8 items-center justify-center rounded-full bg-accent text-on-accent">
          <Plus className="size-5" />
        </span>
        <span className="sr-only">{t('nav.capture')}</span>
      </button>
      {tab('/people', Users, t('nav.people'))}
      <button type="button" onClick={() => setMore(true)} className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-fg-muted">
        <MoreHorizontal className="size-5" strokeWidth={1.75} />
        {t('nav.more')}
      </button>
    </nav>
  );
}

export function Layout({ overlays }: { overlays?: ReactNode }) {
  const { t } = useTranslation();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  const moreOpen = useUi((s) => s.moreOpen);
  const setMore = useUi((s) => s.setMoreOpen);
  const [overlayNav, setOverlayNav] = useState(false);
  return (
    <div className="flex h-full">
      {!collapsed && (
        <aside className="hidden w-60 shrink-0 border-e border-line bg-subtle lg:block">
          <SidebarContent />
        </aside>
      )}
      {(overlayNav || moreOpen) && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t('nav.more')}>
          <button type="button" aria-label={t('action.close')} className="absolute inset-0 bg-fg/30" onClick={() => { setOverlayNav(false); setMore(false); }} />
          <aside className="absolute inset-y-0 start-0 w-72 bg-subtle shadow-pop safe-top">
            <SidebarContent onNavigate={() => { setOverlayNav(false); setMore(false); }} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 px-3 safe-top">
          <IconButton label={t('action.toggleSidebar')} size="sm" className="hidden lg:inline-flex" onClick={toggle}>
            <PanelLeft className="size-4 rtl-flip" />
          </IconButton>
          <IconButton label={t('action.toggleSidebar')} size="sm" className="hidden sm:inline-flex lg:hidden" onClick={() => setOverlayNav(true)}>
            <MenuIcon className="size-4" />
          </IconButton>
          <div className="flex-1" />
          <div className="sm:hidden">
            <SyncPill compact />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto pb-24 sm:pb-8">
          <Outlet />
        </main>
      </div>
      <BottomTabs />
      {overlays}
    </div>
  );
}

export function Page({ title, actions, children, wide }: { title: ReactNode; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('mx-auto w-full px-4 sm:px-6', wide ? 'max-w-6xl' : 'max-w-3xl')}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 pt-1">
        <h1 className="text-display font-semibold" dir="auto">
          {title}
        </h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
