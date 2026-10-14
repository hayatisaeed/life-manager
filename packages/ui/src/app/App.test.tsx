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
        data: { ...rows.get(id)?.data, ...data },
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
      expect(screen.getByRole('button', { name: 'Add to inbox' }).hasAttribute('disabled')).toBe(
        true,
      ),
    );
    fireEvent.change(screen.getByLabelText('Quick capture'), { target: { value: 'Test capture' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add to inbox' }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add to inbox' }));
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
  it('restores independent drafts after navigation, saves and explicitly discards them', async () => {
    const repo = fakeRepository();
    render(<App repository={repo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText('Title', { exact: true }), {
      target: { value: 'Draft note' },
    });
    fireEvent.change(screen.getByLabelText('Content', { exact: true }), {
      target: { value: 'Do not lose this' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText('Title', { exact: true }), {
      target: { value: 'Draft task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect((screen.getByLabelText('Title', { exact: true }) as HTMLInputElement).value).toBe(
      'Draft note',
    );
    expect((screen.getByLabelText('Content', { exact: true }) as HTMLTextAreaElement).value).toBe(
      'Do not lose this',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Draft note');
    expect(await repo.list('note')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect((screen.getByLabelText('Title', { exact: true }) as HTMLInputElement).value).toBe(
      'Draft task',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect((screen.getByLabelText('Title', { exact: true }) as HTMLInputElement).value).toBe('');
    expect(await repo.list('task')).toHaveLength(0);
  });
  it('keeps capture accessible without leaving the current view and separates Today backlog', async () => {
    const repo = fakeRepository();
    await repo.put('task', '01ARZ3NDEKTSV4RRFFQ69G5FAV', {
      title: 'Undated backlog',
      status: 'todo',
    });
    render(<App repository={repo} />);
    await waitFor(() => expect(screen.queryByText('Undated backlog')).toBeNull());
    fireEvent.click(screen.getByLabelText('Include undated backlog'));
    await screen.findByText('Undated backlog');
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText('Quick capture'));
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeDefined();
  });
  it('keeps running/paused focus across navigation and saves one session', async () => {
    const repo = fakeRepository();
    render(<App repository={repo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Finish session' }));
    await screen.findByText('Focus session saved.');
    expect(await repo.list('focusSession')).toHaveLength(1);
  });
  it('keeps text entered during capture upload and prevents duplicate submits', async () => {
    const repo = fakeRepository(),
      original = repo.put;
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    repo.put = async (...args) => {
      await wait;
      return original(...args);
    };
    render(<App repository={repo} />);
    fireEvent.change(screen.getByLabelText('Quick capture'), {
      target: { value: 'First capture' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add to inbox' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to inbox' }));
    fireEvent.change(screen.getByLabelText('Quick capture'), { target: { value: 'Next capture' } });
    release?.();
    await screen.findByText('Added to inbox.');
    expect((screen.getByLabelText('Quick capture') as HTMLInputElement).value).toBe('Next capture');
    expect(await repo.list('inboxItem')).toHaveLength(1);
  });
  it('saves only edited fields while preserving a newer background field update', async () => {
    const repo = fakeRepository(),
      id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    await repo.put('note', id, {
      title: 'Original',
      content: 'Original body',
      tags: [],
      pinned: false,
    });
    render(<App repository={repo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    await screen.findByText('Original');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title', { exact: true }), {
      target: { value: 'Edited title' },
    });
    await repo.put('note', id, { content: 'Newer body' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Edited title');
    expect((await repo.get(id))?.data.content).toBe('Newer body');
  });
  it('does not close or erase a newer draft when a prior save finishes after navigation', async () => {
    const repo = fakeRepository(),
      id = '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      original = repo.put;
    await original('note', id, {
      title: 'Original',
      content: 'Original body',
      tags: [],
      pinned: false,
    });
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    repo.put = async (...args) => {
      await pending;
      return original(...args);
    };
    render(<App repository={repo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    await screen.findByText('Original');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title', { exact: true }), {
      target: { value: 'Saved title' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Content', { exact: true }), {
      target: { value: 'New draft body' },
    });
    release?.();
    await screen.findByText('Saved title');
    expect((screen.getByLabelText('Content', { exact: true }) as HTMLTextAreaElement).value).toBe(
      'New draft body',
    );
    await original('note', id, { pinned: true });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('New draft body');
    expect((await repo.get(id))?.data).toMatchObject({
      title: 'Saved title',
      content: 'New draft body',
      pinned: true,
    });
  });
});
