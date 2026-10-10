import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { TodayScreen } from '../features/today/TodayScreen';
import { AppShell } from '../layout/AppShell';
import { useApp } from './context';

function Shell() {
  return <AppShell syncStatus={useApp().syncStatus} />;
}

const root = createRootRoute({ component: Shell });
const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: '/', component: TodayScreen }),
  createRoute({ getParentRoute: () => root, path: '/settings', component: SettingsScreen }),
]);

/**
 * Hash history: the app is served as static files (web, Tauri, Capacitor)
 * with no server to rewrite deep links (ADR-021).
 */
export function createAppRouter(history: RouterHistory = createHashHistory()) {
  return createRouter({ routeTree, history });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
