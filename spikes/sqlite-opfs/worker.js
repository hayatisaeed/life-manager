import sqlite3InitModule from '/node_modules/@sqlite.org/sqlite-wasm/dist/index.mjs';

const now = () => performance.now();

// Note: the package README's `'opfs' in sqlite3` check is stale; the bootstrap
// deletes `sqlite3.opfs` after init, so test for `oo1.OpfsDb` instead.

// Deterministic pseudo-random text so FTS has something realistic to index.
const WORDS =
  'plan task habit goal note journal budget invoice meeting review project inbox someday waiting call email write read gym water sleep groceries rent salary book idea'.split(
    ' ',
  );
function text(i, n) {
  let x = i * 2654435761;
  const out = [];
  for (let k = 0; k < n; k++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out.push(WORDS[x % WORDS.length]);
  }
  return out.join(' ');
}

async function openDb(sqlite3, vfs) {
  if (vfs === 'opfs') {
    if (!sqlite3.oo1.OpfsDb)
      throw new Error('opfs VFS unavailable (needs SharedArrayBuffer / COOP+COEP)');
    return new sqlite3.oo1.OpfsDb('/spike-opfs.sqlite3', 'c');
  }
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'opfs-sahpool' });
  return new pool.OpfsSAHPoolDb('/spike-sah.sqlite3');
}

self.onmessage = async (e) => {
  const { phase, vfs, rows } = e.data;
  const r = { phase, vfs };
  try {
    let t = now();
    const sqlite3 = await sqlite3InitModule();
    r.version = sqlite3.version.libVersion;
    r.initMs = now() - t;
    t = now();
    const db = await openDb(sqlite3, vfs);
    r.openMs = now() - t;
    r.fts5 = db.selectValue("select sqlite_compileoption_used('ENABLE_FTS5')") === 1;
    db.exec('pragma journal_mode=wal');
    r.journalMode = db.selectValue('pragma journal_mode');

    if (phase === 'write') {
      db.exec(`
        drop table if exists records; drop table if exists records_fts;
        create table records (id text primary key, type text not null, hlc text not null, body text not null);
        create index records_type_hlc on records(type, hlc);
        create virtual table records_fts using fts5(title, body, content='', tokenize='unicode61');
      `);
      t = now();
      db.transaction(() => {
        const ins = db.prepare('insert into records(id,type,hlc,body) values (?,?,?,?)');
        const fts = db.prepare('insert into records_fts(rowid,title,body) values (?,?,?)');
        for (let i = 0; i < rows; i++) {
          const title = text(i, 4);
          const body = text(i + 7, 40);
          ins
            .bind([
              `01J${String(i).padStart(23, '0')}`,
              ['task', 'note', 'habit', 'txn'][i % 4],
              String(1e12 + i),
              JSON.stringify({ title, body }),
            ])
            .stepReset();
          fts.bind([i + 1, title, body]).stepReset();
        }
        ins.finalize();
        fts.finalize();
      });
      r.insertMs = now() - t;
    }

    t = now();
    r.count = db.selectValue('select count(*) from records');
    r.countMs = now() - t;
    t = now();
    r.indexedQueryRows = db.selectValues(
      "select id from records where type='task' order by hlc desc limit 50",
    ).length;
    r.indexedQueryMs = now() - t;
    t = now();
    r.ftsHits = db.selectValue(
      "select count(*) from records_fts where records_fts match 'budget AND invoice'",
    );
    r.ftsMs = now() - t;
    t = now();
    db.transaction(() => {
      for (let i = 0; i < 100; i++)
        db.exec({
          sql: 'update records set hlc=? where id=?',
          bind: [String(2e12 + i), `01J${String(i * 13).padStart(23, '0')}`],
        });
    });
    r.update100Ms = now() - t;
    db.close();
  } catch (err) {
    r.error = String(err?.message ?? err);
  }
  self.postMessage(r);
};
