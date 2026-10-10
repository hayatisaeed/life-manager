import { ENTITY_TYPES } from '@lm/core';
import { describe, expect, it } from 'vitest';
import { openMemoryDriver } from '../driver/wasm';
import { DatabaseTooNewError, migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { entityTable } from './tables';

const now = () => '2026-10-10T00:00:00.000Z';

describe('migrations', () => {
  it('creates a table for every registered entity type', async () => {
    const db = await openMemoryDriver();
    expect(await migrate(db, now)).toEqual([1]);
    const tables = new Set(
      (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map(
        (r) => r.name,
      ),
    );
    // Adding an entity to core needs a migration that creates its table.
    for (const type of ENTITY_TYPES) expect(tables, type).toContain(entityTable(type));
    for (const t of [
      'sync_meta',
      'sync_remote',
      'sync_base',
      'change_log',
      'sync_kept',
      'search_doc',
      'search_fts',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('is idempotent and records what it applied', async () => {
    const db = await openMemoryDriver();
    await migrate(db, now);
    expect(await migrate(db, now)).toEqual([]);
    expect(await db.all('SELECT version, name, applied_at FROM schema_migrations')).toEqual([
      { version: 1, name: MIGRATIONS[0]?.name, applied_at: now() },
    ]);
  });

  it('applies later migrations in order and rolls back a failing one', async () => {
    const db = await openMemoryDriver();
    const extra = [
      { version: 3, name: 'three', sql: 'CREATE TABLE three (x)' },
      { version: 2, name: 'two', sql: 'CREATE TABLE two (x)' },
    ];
    expect(await migrate(db, now, [...MIGRATIONS, ...extra])).toEqual([1, 2, 3]);
    const broken = { version: 4, name: 'broken', sql: 'CREATE TABLE four (x); SELECT * FROM nope' };
    await expect(migrate(db, now, [...MIGRATIONS, ...extra, broken])).rejects.toThrow(
      /no such table/,
    );
    expect(await db.all("SELECT name FROM sqlite_master WHERE name = 'four'")).toEqual([]);
  });

  it('refuses a database from a newer app version', async () => {
    const db = await openMemoryDriver();
    await migrate(db, now, [...MIGRATIONS, { version: 2, name: 'future', sql: 'SELECT 1' }]);
    await expect(migrate(db, now)).rejects.toThrow(DatabaseTooNewError);
  });

  it('names tables in snake_case', () => {
    expect(entityTable('inboxItem')).toBe('ent_inbox_item');
    expect(entityTable('task')).toBe('ent_task');
  });
});
