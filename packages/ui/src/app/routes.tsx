// Code-based TanStack Router setup with hash history, which works the same
// under https://, Tauri's custom protocol and Capacitor's file origin.

import type { ComponentType } from 'react';
import { createHashHistory, createMemoryHistory, createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import type { AnyRoute } from '@tanstack/react-router';
import { Layout } from './layout';
import { Overlays } from './overlays';
import { ROUTES } from './route-table';

export function buildRouter(opts: { memory?: boolean } = {}) {
  const root = createRootRoute({ component: () => <Layout overlays={<Overlays />} /> });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    beforeLoad: () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's redirect API
      throw redirect({ to: '/today' });
    },
  });
  const children: AnyRoute[] = [index];
  for (const [path, component] of Object.entries(ROUTES) as [string, ComponentType][]) {
    children.push(createRoute({ getParentRoute: () => root, path, component }));
  }
  return createRouter({
    routeTree: root.addChildren(children),
    history: opts.memory ? createMemoryHistory({ initialEntries: ['/today'] }) : createHashHistory(),
    defaultPreload: false,
  });
}

export type AppRouter = ReturnType<typeof buildRouter>;
