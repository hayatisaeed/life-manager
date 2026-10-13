import { describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createRepository, serializedDriver } from './index';
const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
async function setup() {
  const sqlite = await sqlite3InitModule();
  const db = new sqlite.oo1.DB(':memory:');
  const driver = serializedDriver(
    async (sql, bind = []) => db.exec(sql, { bind, rowMode: 'object', returnValue: 'resultRows' }),
    async () => {
      db.close();
    },
  );
  let now = 1000;
  return { repo: await createRepository(driver, { deviceId: 'test', now: () => now++ }), driver };
}
describe('repository on SQLite WASM', () => {
  it('persists CRUD, stamps clocks, tracks changes, searches, tombstones and restores', async () => {
    const { repo, driver } = await setup();
    let notifications = 0;
    const unsubscribe = repo.subscribe(() => {
      notifications += 1;
    });
    const first = await repo.put('note', id, {
      title: 'My note',
      content: 'Persian English',
      tags: [],
      pinned: false,
    });
    expect(await repo.get(id)).toEqual(first);
    const second = await repo.put('note', id, {
      ...first.data,
      title: 'Changed',
      content: 'New content',
    });
    expect(second.hlc > first.hlc).toBe(true);
    expect(second.fieldHlc.title).toBe(second.hlc);
    expect(second.fieldHlc.pinned).toBe(first.hlc);
    expect(await repo.search('New')).toHaveLength(1);
    expect(await repo.search('Persian')).toHaveLength(0);
    expect(await driver.query('SELECT * FROM change_log')).toHaveLength(1);
    await repo.remove(id);
    expect(await repo.list('note')).toHaveLength(0);
    expect(await repo.list('note', true)).toHaveLength(1);
    await repo.restore(id);
    expect(await repo.list('note')).toHaveLength(1);
    expect(notifications).toBe(4);
    unsubscribe();
    const exported: unknown = JSON.parse(await repo.export());
    expect(exported).toMatchObject({ format: 'life-manager-export', version: 1 });
    await repo.close();
  });
  it('rolls back invalid data and serializes concurrent writes', async () => {
    const { repo, driver } = await setup();
    await expect(repo.put('task', id, { title: 'incomplete' })).rejects.toThrow();
    expect(await repo.list()).toHaveLength(0);
    const note = await repo.put('note', id, {
      title: 'Note',
      content: '',
      tags: [],
      pinned: false,
    });
    await Promise.all([
      repo.put('note', id, { ...note.data, title: 'A' }),
      repo.put('note', id, { ...note.data, title: 'B' }),
    ]);
    expect((await repo.get(id))?.data.title).toBe('B');
    await expect(
      driver.transaction(async (db) => {
        await db.query('DELETE FROM records');
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await repo.list()).toHaveLength(1);
    await repo.close();
  });
  it('clears optional fields and updates several text fields in one atomic write', async () => {
    const { repo } = await setup();
    const task = await repo.put('task', id, {
      title: 'Task',
      notes: 'Old notes',
      priority: 3,
      status: 'todo',
      dueDate: '2026-10-13',
      reminders: [],
      tags: [],
      order: 'a0',
    });
    const { dueDate: _dueDate, ...data } = task.data;
    const cleared = await repo.put('task', id, { ...data, notes: 'New notes' }, ['dueDate']);
    expect(cleared.data.dueDate).toBeUndefined();
    expect(cleared.fieldHlc.dueDate).toBe(cleared.hlc);
    await expect(repo.put('task', id, {}, ['title'])).rejects.toThrow();
    expect((await repo.get(id))?.data.title).toBe('Task');
    await repo.close();
  });
  it('preserves unknown records and refuses to edit or delete them', async () => {
    const { repo, driver } = await setup();
    const record = await repo.put('note', id, {
      title: 'Note',
      content: '',
      tags: [],
      pinned: false,
    });
    const future = { ...record, schema: 2 };
    await driver.query('UPDATE records SET envelope=? WHERE id=?', [JSON.stringify(future), id]);
    expect((await repo.get(id))?.schema).toBe(2);
    await expect(repo.put('note', id, record.data)).rejects.toThrow('unknown record');
    await expect(repo.remove(id)).rejects.toThrow('Update required');
    await repo.close();
  });
});
