import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

const ROWS = 50_000;
const FILE = '/spike-bench.sqlite3';

// Deterministic text so runs are comparable.
const WORDS =
  'plan review call email buy book write read fix ship draft budget invoice gym run walk doctor dentist tax report meeting project garden car repair groceries birthday gift travel flight hotel visa passport study exam lecture notes recipe dinner family friend mentor coffee'.split(
    ' ',
  );
let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = () => WORDS[Math.floor(rand() * WORDS.length)];
const sentence = (n) => Array.from({ length: n }, pick).join(' ');

function time(fn) {
  const t = performance.now();
  const value = fn();
  return { ms: Math.round((performance.now() - t) * 10) / 10, value };
}

async function openDb(sqlite3, vfs) {
  // In-memory baseline separates SQLite/wasm CPU cost from storage cost.
  if (vfs === 'memory') return { db: new sqlite3.oo1.DB(':memory:'), pool: null };
  if (vfs === 'opfs') {
    if (!sqlite3.oo1.OpfsDb)
      throw new Error('opfs VFS unavailable (needs SharedArrayBuffer / COOP+COEP)');
    return { db: new sqlite3.oo1.OpfsDb(FILE, 'c'), pool: null };
  }
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'lm-spike-pool' });
  return { db: new pool.OpfsSAHPoolDb(FILE), pool };
}

async function opfsFileSize() {
  // The `opfs` VFS stores the db as a plain OPFS file; the SAH pool hides it in opaque
  // slot files, so we sum the whole OPFS tree instead.
  let total = 0;
  async function walk(dir) {
    for await (const [, handle] of dir.entries()) {
      if (handle.kind === 'file') total += (await handle.getFile()).size;
      else await walk(handle);
    }
  }
  await walk(await navigator.storage.getDirectory());
  return total;
}

let cacheKiB = 0;

async function bench(sqlite3, vfs) {
  const r = {};
  // Start from scratch each run.
  const root = await navigator.storage.getDirectory();
  for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true });

  const t0 = performance.now();
  const { db } = await openDb(sqlite3, vfs);
  r.open_ms = Math.round(performance.now() - t0);
  if (cacheKiB) db.exec(`PRAGMA cache_size=-${cacheKiB}`);
  r.cache_size = db.selectValue('PRAGMA cache_size');
  r.journal_mode = db.selectValue('PRAGMA journal_mode');
  r.fts5 = db.selectValue("SELECT sqlite_compileoption_used('ENABLE_FTS5')") === 1;

  db.exec(`
    CREATE TABLE task (
      id TEXT PRIMARY KEY, project_id TEXT, title TEXT NOT NULL, notes TEXT,
      due TEXT, status TEXT, hlc TEXT NOT NULL, field_hlc TEXT NOT NULL,
      deleted_at TEXT, device_id TEXT NOT NULL
    );
    CREATE INDEX task_project_due ON task(project_id, due) WHERE deleted_at IS NULL;
  `);

  r.insert_50k_one_tx = time(() => {
    const stmt = db.prepare('INSERT INTO task VALUES (?,?,?,?,?,?,?,?,?,?)');
    db.transaction(() => {
      for (let i = 0; i < ROWS; i++) {
        const day = String(1 + (i % 28)).padStart(2, '0');
        stmt
          .bind([
            `01J${String(i).padStart(23, '0')}`,
            `p${i % 50}`,
            sentence(4),
            sentence(30),
            `2026-${String(1 + (i % 12)).padStart(2, '0')}-${day}`,
            i % 3 ? 'todo' : 'done',
            `${1_700_000_000_000 + i}:0000:dev1`,
            '{"title":"x","notes":"x"}',
            null,
            'dev1',
          ])
          .stepReset();
      }
    });
    stmt.finalize();
  }).ms;

  r.count_ms = time(() => db.selectValue('SELECT count(*) FROM task')).ms;
  r.indexed_query = time(
    () =>
      db.selectObjects(
        "SELECT id, title, due FROM task WHERE project_id = 'p7' AND deleted_at IS NULL ORDER BY due LIMIT 50",
      ).length,
  );
  r.like_scan = time(() =>
    db.selectValue("SELECT count(*) FROM task WHERE notes LIKE '%passport visa%'"),
  );

  r.update_1k_one_tx = time(() =>
    db.transaction(() => {
      db.exec({
        sql: "UPDATE task SET status = 'done', hlc = hlc || 'x' WHERE rowid IN (SELECT rowid FROM task LIMIT 1000)",
      });
    }),
  ).ms;

  // UI writes are mostly single autocommit statements; each one is a durable commit.
  r.autocommit_100_inserts_ms = time(() => {
    for (let i = 0; i < 100; i++) {
      db.exec({
        sql: 'INSERT INTO task (id, title, hlc, field_hlc, device_id) VALUES (?,?,?,?,?)',
        bind: [`02J${i}`, 'quick capture', '1:0:dev1', '{}', 'dev1'],
      });
    }
  }).ms;

  // Cheaper durability settings for small UI writes (WAL is unavailable without
  // shared memory, so TRUNCATE + synchronous=NORMAL is the closest alternative).
  db.exec('PRAGMA journal_mode=TRUNCATE; PRAGMA synchronous=NORMAL;');
  r.autocommit_100_inserts_truncate_normal_ms = time(() => {
    for (let i = 0; i < 100; i++) {
      db.exec({
        sql: 'INSERT INTO task (id, title, hlc, field_hlc, device_id) VALUES (?,?,?,?,?)',
        bind: [`04J${i}`, 'quick capture', '1:0:dev1', '{}', 'dev1'],
      });
    }
  }).ms;
  db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');

  if (r.fts5) {
    r.fts_build_50k_ms = time(() =>
      db.exec(`
        CREATE VIRTUAL TABLE task_fts USING fts5(title, notes, content='task', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
        INSERT INTO task_fts(task_fts) VALUES ('rebuild');
      `),
    ).ms;
    r.fts_match = time(
      () =>
        db.selectObjects(
          "SELECT t.id FROM task_fts f JOIN task t ON t.rowid = f.rowid WHERE task_fts MATCH 'passport AND visa' ORDER BY bm25(task_fts) LIMIT 20",
        ).length,
    );
    r.fts_prefix = time(() =>
      db.selectValue("SELECT count(*) FROM task_fts WHERE task_fts MATCH 'pass*'"),
    );
    // Persian text: unicode61 must tokenize it for fa search to work.
    db.exec({
      sql: 'INSERT INTO task (id, title, notes, hlc, field_hlc, device_id) VALUES (?,?,?,?,?,?)',
      bind: ['03J1', 'خرید کتاب', 'کتاب‌های درسی برای امتحان', '1:0:dev1', '{}', 'dev1'],
    });
    db.exec(
      "INSERT INTO task_fts(rowid, title, notes) SELECT rowid, title, notes FROM task WHERE id = '03J1'",
    );
    r.fts_persian_hits = db.selectValue(
      "SELECT count(*) FROM task_fts WHERE task_fts MATCH 'کتاب'",
    );
  }

  if (vfs === 'memory') {
    db.close();
    return r;
  }
  db.close();
  const t = performance.now();
  const { db: db2 } = await openDb(sqlite3, vfs);
  r.reopen_and_count = {
    ms: Math.round(performance.now() - t),
    value: db2.selectValue('SELECT count(*) FROM task'),
  };
  db2.close();
  r.opfs_bytes = await opfsFileSize();
  return r;
}

async function verify(sqlite3, vfs) {
  // Second page load: data written by the previous load must still be there.
  const { db } = await openDb(sqlite3, vfs);
  const count = db.selectValue('SELECT count(*) FROM task');
  const fts = db.selectValue("SELECT count(*) FROM task_fts WHERE task_fts MATCH 'passport'");
  db.close();
  return { rows_after_reload: count, fts_rows_after_reload: fts };
}

self.onmessage = async ({ data }) => {
  const logs = [];
  try {
    const origWarn = console.warn;
    console.warn = (...args) => {
      logs.push(args.map(String).join(' '));
      origWarn(...args);
    };
    const sqlite3 = await sqlite3InitModule({
      print: () => {},
      printErr: (...args) => logs.push(args.join(' ')),
    });
    const base = {
      initWarnings: logs,
      workerFeatures: {
        crossOriginIsolated: self.crossOriginIsolated,
        SharedArrayBuffer: typeof SharedArrayBuffer,
        FileSystemHandle: typeof FileSystemHandle,
        createSyncAccessHandle: typeof FileSystemFileHandle?.prototype?.createSyncAccessHandle,
        opfsVfsRegistered: !!sqlite3.capi.sqlite3_vfs_find('opfs'),
      },
      ok: true,
      sqlite: sqlite3.version.libVersion,
      vfs: data.vfs,
      crossOriginIsolated: data.crossOriginIsolated,
    };
    cacheKiB = Number(data.cacheKiB ?? 0);
    const result =
      data.phase === 'verify' ? await verify(sqlite3, data.vfs) : await bench(sqlite3, data.vfs);
    self.postMessage({ ...base, ...result });
  } catch (err) {
    self.postMessage({
      ok: false,
      initWarnings: logs,
      vfs: data.vfs,
      crossOriginIsolated: data.crossOriginIsolated,
      error: String(err),
    });
  }
};
