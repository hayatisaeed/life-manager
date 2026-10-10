// jsdom has no matchMedia; the theme hook needs it. Tests flip `prefersDark`.
export const media = { prefersDark: false, listeners: new Set<() => void>() };

// Node-environment tests (e.g. the database settings store) have no window.
if (typeof window !== 'undefined')
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return query.includes('dark') ? media.prefersDark : false;
      },
      media: query,
      addEventListener: (_: string, l: () => void) => media.listeners.add(l),
      removeEventListener: (_: string, l: () => void) => media.listeners.delete(l),
    }),
  });

// Vitest runs without globals, so Testing Library can't register its own cleanup.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
afterEach(cleanup);
