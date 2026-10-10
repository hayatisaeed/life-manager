import { describe, expect, it } from 'vitest';
import { createCapacitorDriver, type CapacitorSqliteConnection } from './capacitor';
import { createSerialDriver } from './serial';
import { splitSqlScript } from './split';
import { createTauriDriver, type TauriSqlDatabase } from './tauri';
import type { RawSql, Row, SqlDriver, SqlValue } from './types';
import { openMemoryDriver, openMemoryRawSql } from './wasm';
import { serveSql } from './worker-host';
import { openWorkerDriver } from './worker-client';
import type { MessagePortLike } from './worker-protocol';

/** Two connected ports, like a Worker and its global scope. Messages are cloned. */
function channel(): [MessagePortLike, MessagePortLike] {
  const listeners: [((e: { data: unknown }) => void)[], ((e: { data: unknown }) => void)[]] = [
    [],
    [],
  ];
  const port = (self: 0 | 1): MessagePortLike => ({
    postMessage: (message) => {
      const data = structuredClone(message);
      queueMicrotask(() => listeners[self === 0 ? 1 : 0].forEach((l) => l({ data })));
    },
    addEventListener: (_type, l) => listeners[self].push(l),
  });
  return [port(0), port(1)];
}

/** A fake Tauri `Database` backed by the real wasm SQLite, so SQL behaves exactly. */
function fakeTauri(raw: RawSql): TauriSqlDatabase {
  return {
    execute: async (q, b) => ({ rowsAffected: (await raw.run(q, b as SqlValue[])).changes }),
    select: async <T>(q: string, b?: unknown[]) => (await raw.all(q, b as SqlValue[])) as T,
    close: async () => {
      await raw.close();
      return true;
    },
  };
}

function fakeCapacitor(raw: RawSql, calls: boolean[]): CapacitorSqliteConnection {
  return {
    run: async (q, v, transaction) => {
      calls.push(transaction ?? true);
      return { changes: { changes: (await raw.run(q, v as SqlValue[])).changes } };
    },
    query: async (q, v) => ({ values: await raw.all(q, v as SqlValue[]) }),
    execute: async (s, transaction) => {
      calls.push(transaction ?? true);
      await raw.script(s);
    },
    close: () => raw.close(),
  };
}

const capacitorCalls: boolean[] = [];
const drivers: [string, () => Promise<SqlDriver>][] = [
  ['wasm (memory)', openMemoryDriver],
  [
    'worker',
    async () => {
      const [main, worker] = channel();
      serveSql(worker, () => openMemoryRawSql());
      return openWorkerDriver(main, 'test.sqlite3');
    },
  ],
  ['tauri', async () => createTauriDriver(fakeTauri(await openMemoryRawSql()))],
  [
    'capacitor',
    async () => createCapacitorDriver(fakeCapacitor(await openMemoryRawSql(), capacitorCalls)),
  ],
];

describe.each(drivers)('driver contract: %s', (_name, open) => {
  it('runs scripts, statements and queries', async () => {
    const db = await open();
    await db.script(`CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, s TEXT); -- comment; with semicolon
      INSERT INTO t VALUES ('a', 1, 'x;y');`);
    expect(await db.run('INSERT INTO t VALUES (?, ?, ?)', ['b', 2, null])).toEqual({ changes: 1 });
    expect(
      await db.all<{ id: string; n: number; s: string | null } & Row>(
        'SELECT * FROM t ORDER BY id',
      ),
    ).toEqual([
      { id: 'a', n: 1, s: 'x;y' },
      { id: 'b', n: 2, s: null },
    ]);
    expect(await db.run('UPDATE t SET n = n + 1')).toEqual({ changes: 2 });
    await db.close();
  });

  it('commits a transaction and rolls one back on error', async () => {
    const db = await open();
    await db.script('CREATE TABLE t (id TEXT PRIMARY KEY)');
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t VALUES (?)', ['a']);
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO t VALUES (?)', ['b']);
        await tx.run('INSERT INTO t VALUES (?)', ['a']); // duplicate key
      }),
    ).rejects.toThrow(/UNIQUE/);
    expect(await db.all('SELECT id FROM t')).toEqual([{ id: 'a' }]);
    await db.close();
  });

  it('keeps calls made during a transaction out of it', async () => {
    const db = await open();
    await db.script('CREATE TABLE t (id TEXT PRIMARY KEY)');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const tx = db.transaction(async (t) => {
      await t.run('INSERT INTO t VALUES (?)', ['in-tx']);
      await gate;
      throw new Error('abort');
    });
    const outside = db.run('INSERT INTO t VALUES (?)', ['outside']);
    release();
    await expect(tx).rejects.toThrow('abort');
    await outside;
    expect(await db.all('SELECT id FROM t')).toEqual([{ id: 'outside' }]);
    await db.close();
  });

  it('reports SQL errors and refuses calls after close', async () => {
    const db = await open();
    await expect(db.all('SELECT * FROM missing')).rejects.toThrow(/no such table/);
    await db.close();
    await expect(db.run('SELECT 1')).rejects.toThrow(/closed/);
  });
});

describe('serial driver details', () => {
  it('rejects use of a transaction handle after the transaction ends', async () => {
    const db = await openMemoryDriver();
    let leaked: Parameters<Parameters<SqlDriver['transaction']>[0]>[0] | undefined;
    await db.transaction(async (tx) => {
      leaked = tx;
    });
    expect(() => leaked?.run('SELECT 1')).toThrow(/already finished/);
    expect(() => leaked?.all('SELECT 1')).toThrow(/already finished/);
    expect(() => leaked?.script('SELECT 1')).toThrow(/already finished/);
  });

  it('keeps going after a failed rollback', async () => {
    const raw = await openMemoryRawSql();
    const flaky: RawSql = {
      ...raw,
      run: (sql, params) =>
        sql === 'ROLLBACK' ? Promise.reject(new Error('gone')) : raw.run(sql, params),
    };
    const db = createSerialDriver(flaky);
    await expect(db.transaction(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await raw.run('ROLLBACK');
    expect(await db.all('SELECT 1 AS one')).toEqual([{ one: 1 }]);
  });

  it('passes transaction = false to every Capacitor call', () => {
    expect(capacitorCalls.length).toBeGreaterThan(0);
    expect(capacitorCalls.every((t) => !t)).toBe(true);
  });
});

describe('capacitor fallbacks', () => {
  it('treats missing change counts and values as empty', async () => {
    const db = createCapacitorDriver({
      run: () => Promise.resolve({}),
      query: () => Promise.resolve({}),
      execute: () => Promise.resolve(null),
      close: () => Promise.resolve(),
    });
    expect(await db.run('X')).toEqual({ changes: 0 });
    expect(await db.all('X')).toEqual([]);
  });
});

describe('worker host', () => {
  it('reports use before open', async () => {
    const [main, worker] = channel();
    serveSql(worker, () => openMemoryRawSql());
    const replies: unknown[] = [];
    main.addEventListener('message', (e) => replies.push(e.data));
    main.postMessage({ id: 7, op: 'run', sql: 'SELECT 1', params: [] });
    await new Promise((r) => setTimeout(r, 10));
    expect(replies).toEqual([{ id: 7, ok: false, message: 'database is not open' }]);
  });

  it('ignores replies it did not ask for', async () => {
    const [main, worker] = channel();
    serveSql(worker, () => openMemoryRawSql());
    const db = await openWorkerDriver(main, 'x');
    worker.postMessage({ id: 9999, ok: true, result: null });
    expect(await db.all('SELECT 2 AS two')).toEqual([{ two: 2 }]);
  });

  it('turns non-Error throws into messages', async () => {
    const [main, worker] = channel();
    serveSql(worker, () => Promise.reject('plain string'));
    await expect(openWorkerDriver(main, 'x')).rejects.toThrow('plain string');
  });
});

describe('splitSqlScript', () => {
  it('splits on semicolons outside quotes and comments', () => {
    expect(
      splitSqlScript(`CREATE TABLE "a;b" (x TEXT DEFAULT 'p;q'); -- c;d
        INSERT INTO \`t\` VALUES (1);;
        SELECT 1 -- trailing`),
    ).toEqual([
      'CREATE TABLE "a;b" (x TEXT DEFAULT \'p;q\')',
      'INSERT INTO `t` VALUES (1)',
      'SELECT 1',
    ]);
    expect(splitSqlScript('-- only a comment')).toEqual([]);
  });
});
