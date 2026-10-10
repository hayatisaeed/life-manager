import { beforeEach, describe, expect, it } from 'vitest';
import type { EntityData } from '@lm/core';
import { DELETED_KEY, testEnv } from '@lm/core';
import { memoryDriver } from '@lm/platform';
import {
  BlobStore,
  NotFoundError,
  ReadOnlyRecordError,
  Store,
  SyncState,
  f,
  migrate,
} from '../src';

const task = (title: string, extra: Partial<EntityData<'task'>> = {}): EntityData<'task'> => ({
  title,
  notes: '',
  priority: 3,
  status: 'todo',
  reminders: [],
  tags: [],
  order: 'a0',
  ...extra,
});

let store: Store;
let env: ReturnType<typeof testEnv>;

beforeEach(async () => {
  env = testEnv();
  store = await Store.open(await memoryDriver(), env);
});

describe('Store', () => {
  it('creates records with per-field HLCs and a change-log entry', async () => {
    const t = await store.create('task', task('Call mom', { tags: ['family'] }));
    expect(t.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(t.fieldHlc['title']).toBe(t.hlc);
    expect(await store.get('task', t.id)).toEqual(t);
    expect(await store.get('note', t.id)).toBeNull();
    expect((await store.dirty()).map((d) => d.id)).toEqual([t.id]);
  });

  it('validates data strictly on write', async () => {
    await expect(
      store.create('task', { ...task('x'), priority: 9 } as unknown as EntityData<'task'>),
    ).rejects.toThrow();
    await expect(store.update('task', 'missing', { title: 'y' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('updates only changed fields and keeps HLCs monotonic', async () => {
    const t = await store.create('task', task('a'));
    env.advance(10);
    const u = await store.update('task', t.id, { title: 'b', dueDate: '2026-10-11' });
    expect(u.fieldHlc['title']! > t.fieldHlc['title']!).toBe(true);
    expect(u.fieldHlc['notes']).toBe(t.fieldHlc['notes']);
    expect(u.data.dueDate).toBe('2026-10-11');
    const same = await store.update('task', t.id, { title: 'b' });
    expect(same.hlc).toBe(u.hlc);
    const cleared = await store.update('task', t.id, { dueDate: undefined });
    expect('dueDate' in cleared.data).toBe(false);
  });

  it('soft-deletes and restores', async () => {
    const t = await store.create('task', task('a'));
    await store.remove(t.id);
    expect(await store.get('task', t.id)).toBeNull();
    const env1 = await store.getEnvelope(t.id);
    expect(env1?.deletedAt).not.toBeNull();
    expect(env1?.fieldHlc[DELETED_KEY]).toBeDefined();
    expect(await store.list('task')).toHaveLength(0);
    expect(await store.list('task', { includeDeleted: true })).toHaveLength(1);
    await store.restore(t.id);
    expect(await store.get('task', t.id)).not.toBeNull();
    await store.remove('nope');
    await store.restore(t.id);
  });

  it('lists with json filters, order and limit; counts', async () => {
    await store.create('task', task('a', { dueDate: '2026-10-12', priority: 1 }));
    await store.create('task', task('b', { dueDate: '2026-10-11' }));
    await store.create('task', task('c', { status: 'done' }));
    const due = await store.list('task', {
      where: `${f('dueDate')} IS NOT NULL`,
      orderBy: f('dueDate'),
    });
    expect(due.map((t) => t.data.title)).toEqual(['b', 'a']);
    expect(
      await store.list('task', { where: `${f('status')} = ?`, params: ['done'] }),
    ).toHaveLength(1);
    expect(await store.list('task', { limit: 2 })).toHaveLength(2);
    expect(await store.count('task')).toBe(3);
    expect(await store.count('task', `${f('priority')} = ?`, [1])).toBe(1);
  });

  it('transactions are atomic', async () => {
    await expect(
      store.transact(async (w) => {
        await w.create('task', task('first'));
        await w.create('task', { ...task('bad'), status: 'nope' } as unknown as EntityData<'task'>);
      }),
    ).rejects.toThrow();
    expect(await store.count('task')).toBe(0);
    await store.transact(async (w) => {
      const a = await w.create('task', task('p'));
      await w.update('task', a.id, { title: 'p2' });
    });
    expect((await store.list('task'))[0]?.data.title).toBe('p2');
    await expect(
      store
        .create('task', task('dup'), { id: 'X' })
        .then(() => store.create('task', task('dup'), { id: 'X' })),
    ).rejects.toThrow('already exists');
  });

  it('full-text search with prefix matching, updated on edit and delete', async () => {
    const a = await store.create('note', {
      title: 'Groceries',
      content: 'buy milk and bread',
      tags: ['home'],
      pinned: false,
    });
    await store.create('task', task('Call the plumber', { notes: 'about the kitchen sink' }));
    expect((await store.search('milk')).map((r) => r.id)).toEqual([a.id]);
    expect((await store.search('plumb')).map((r) => r.type)).toEqual(['task']);
    expect(await store.search('home')).toHaveLength(1);
    await store.update('note', a.id, { content: 'buy cheese' });
    expect(await store.search('milk')).toHaveLength(0);
    await store.remove(a.id);
    expect(await store.search('cheese')).toHaveLength(0);
    expect(await store.search('  "*  ')).toEqual([]);
  });

  it('live-query subscribers are notified by type', async () => {
    const seen: string[] = [];
    const off = store.subscribe(['task'], (e) => seen.push([...e.types].join(',')));
    const all: boolean[] = [];
    const offAll = store.subscribe(null, (e) => all.push(e.remote));
    await store.create('task', task('a'));
    await store.create('note', { title: 'n', content: '', tags: [], pinned: false });
    off();
    await store.create('task', task('b'));
    expect(seen).toEqual(['task']);
    expect(all).toEqual([false, false, false]);
    offAll();
  });

  it('records written by a newer schema are read-only', async () => {
    const t = await store.create('task', task('a'));
    const e = (await store.getEnvelope(t.id))!;
    await store.applySync([{ envelope: { ...e, schema: 99 }, dirty: false }]);
    await expect(store.update('task', t.id, { title: 'x' })).rejects.toBeInstanceOf(
      ReadOnlyRecordError,
    );
  });

  it('persists device id and HLC across reopen', async () => {
    const driver = await memoryDriver();
    const s1 = await Store.open(driver, env);
    const t = await s1.create('task', task('a'));
    const s2 = await Store.open(driver, env);
    expect(s2.deviceId).toBe(s1.deviceId);
    expect(s2.clock.now() > t.hlc).toBe(true);
    expect(await migrate(driver)).toBe(1);
  });

  it('device key/value store', async () => {
    expect(await store.getDevice('x')).toBeNull();
    await store.setDevice('x', { a: 1 });
    expect(await store.getDevice('x')).toEqual({ a: 1 });
  });
});

describe('SyncState', () => {
  it('meta, base, remote snapshot, problems and dirty handling', async () => {
    const s = new SyncState(store);
    await s.setMeta('head', 'abc');
    expect(await s.getMeta('head')).toBe('abc');
    await s.setMeta('head', null);
    expect(await s.getMeta('head')).toBeNull();
    const t = await store.create('task', task('a'));
    const env1 = (await store.getEnvelope(t.id))!;
    await store.applySync(
      [],
      [s.baseStatement(env1), s.remoteUpsert({ path: 'r/aa', sha: '1', kind: 'blob' })],
      {
        clearDirty: [t.id],
      },
    );
    expect(await s.getBase(t.id)).toEqual(env1);
    expect(await store.dirty()).toEqual([]);
    expect(await s.remoteEntries()).toEqual([{ path: 'r/aa', sha: '1', kind: 'blob', meta: null }]);
    await store.applySync([], s.remoteForgetTrees(['r']));
    await store.applySync(
      [],
      [
        s.remoteDelete('r/aa'),
        s.problemStatement({ path: 'r/bb', reason: 'auth-failed', sha: '2', at: 'now' }),
      ],
    );
    expect(await s.remoteEntries()).toEqual([]);
    expect(await s.problems()).toHaveLength(1);
    await store.applySync([], [s.problemClear('r/bb'), s.remoteClear()]);
    expect(await s.problems()).toHaveLength(0);
    await s.markAllDirty();
    expect(await store.dirty()).toHaveLength(1);
    await s.reset();
    expect(await s.getBase(t.id)).toBeNull();
    await s.reset(false);
  });
});

describe('BlobStore', () => {
  // A toy reversible cipher for testing the store plumbing (real crypto is tested in @lm/crypto).
  const xor = (k: number) => ({
    seal: (p: Uint8Array) => ({
      hash: `${'0'.repeat(63)}${p.length % 10}`,
      bytes: p.map((b) => b ^ k),
    }),
    open: (_h: string, c: Uint8Array) => c.map((b) => b ^ k),
  });
  it('stores encrypted bytes, tracks state and re-encrypts', async () => {
    const b = new BlobStore(store, xor(1), 10);
    const ref = await b.put(new Uint8Array([1, 2, 3]), 'image/png', 'a.png');
    expect(ref).toMatchObject({ size: 3, mime: 'image/png', name: 'a.png' });
    expect(await b.raw(ref.hash)).toEqual(new Uint8Array([0, 3, 2]));
    expect(await b.get(ref.hash)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await b.has(ref.hash)).toBe(true);
    expect(await b.state(ref.hash)).toBe('pending');
    expect(await b.pending()).toHaveLength(1);
    await b.markSynced([ref.hash]);
    await b.markSynced([]);
    expect(await b.state(ref.hash)).toBe('synced');
    const big = await b.put(new Uint8Array(20), 'x/y');
    expect(await b.state(big.hash)).toBe('localOnly');
    await b.reencrypt(xor(2));
    expect(await b.get(ref.hash)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await b.state(ref.hash)).toBe('pending');
    await b.putRaw(`${'0'.repeat(63)}5`, new Uint8Array([2, 2]), 'a/b');
    expect(await b.state(`${'0'.repeat(63)}5`)).toBe('synced');
    expect(await b.get('missing')).toBeNull();
    expect(await b.state('missing')).toBeNull();
    expect(await b.raw('missing')).toBeNull();
  });
});
