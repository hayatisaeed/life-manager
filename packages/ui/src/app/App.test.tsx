import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '@lm/db';
import type { Envelope } from '@lm/core';
import { App } from './App';
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function fakeRepository(): Repository {
  const rows = new Map<string, Envelope>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    sync: {
      snapshot: async () => ({ head: null, remote: new Map(), dirty: [], problems: [] }),
      pull: async () => undefined,
      acknowledge: async () => undefined,
    },
    list: async (type, includeDeleted = false) =>
      [...rows.values()].filter(
        (row) => (!type || row.type === type) && (includeDeleted || !row.deletedAt),
      ),
    get: async (id) => rows.get(id) ?? null,
    put: async (type, id, data) => {
      const row: Envelope = {
        id,
        type,
        schema: 1,
        hlc: '1970-01-01T00:00:01.000Z-0000-test',
        fieldHlc: {},
        createdAt: '1970-01-01T00:00:01.000Z',
        deletedAt: null,
        data,
      };
      rows.set(id, row);
      notify();
      return row;
    },
    remove: async (id) => {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, deletedAt: '1970-01-01T00:00:01.000Z' });
      notify();
    },
    restore: async (id) => {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, deletedAt: null });
      notify();
    },
    search: async () => [],
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    export: async () => '{}',
    close: async () => undefined,
  };
}
describe('App', () => {
  it('explains local storage before creating the workspace', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Life Manager' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Start with local storage' })).toBeDefined();
  });
  it('captures, converts an inbox item, deletes and undoes a task', async () => {
    render(<App repository={fakeRepository()} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add' }).hasAttribute('disabled')).toBe(true),
    );
    fireEvent.change(screen.getByLabelText('Quick capture'), { target: { value: 'Test capture' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inbox' }));
    await screen.findByText('Test capture');
    fireEvent.click(screen.getByRole('button', { name: 'Make a task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    await screen.findByText('Test capture');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('Moved to trash');
    fireEvent.click(screen.getByRole('button', { name: 'Undo delete' }));
    await screen.findByText('Test capture');
  });
});
