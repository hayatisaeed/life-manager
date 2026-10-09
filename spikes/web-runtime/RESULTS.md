# Web runtime spike: results

Run on 2026-10-09 in a cloud sandbox (4 vCPU Linux container, headless
Chromium from Playwright, Node 22). The sandbox has slow durable storage, so
treat absolute timings as a pessimistic bound and compare them against the
in-memory baseline. Re-run on real hardware before tuning anything.

Versions: `@sqlite.org/sqlite-wasm` 3.53.4-build2 (SQLite 3.53.4),
`libsodium-wrappers-sumo` 0.8.4 (libsodium 1.0.22).

## 1. sqlite-wasm in a worker

The benchmark ([src/sqlite-worker.js](src/sqlite-worker.js)) creates a
`task`-shaped table (id, project, title, notes, due, status, hlc, field_hlc,
deleted_at, device_id) with a partial index, then:

- inserts 50,000 rows in one transaction (about 28 MB on disk);
- runs indexed, scan, update and FTS5 queries;
- reopens the database, and reloads the page to check persistence.

It runs against three back-ends, and each storage back-end is run with
SQLite's default page cache (16 MiB in this build) and with a 32 MiB cache.

### Availability

| VFS | With COOP/COEP headers | Without (e.g. GitHub Pages) |
|---|---|---|
| `opfs` | works | **unavailable** (needs `SharedArrayBuffer`) |
| `opfs-sahpool` | works | **works** |

- FTS5 is compiled in. The `unicode61` tokenizer finds Persian words
  (`کتاب` matched a row whose notes contained `کتاب‌های`, with a ZWNJ).
- Data survives closing the database and reloading the page with both VFSes.
- A production `vite build`, served with no special headers, works with
  `opfs-sahpool`. Vite emits the `.wasm` file and the workers as assets with
  no extra configuration beyond `optimizeDeps.exclude`.
- **`opfs-sahpool` is exclusive to one tab.** A second tab of the same origin
  fails with `NoModificationAllowedError` from `createSyncAccessHandle`. It
  works again once the first tab closes.
- The README check `'opfs' in sqlite3` is out of date for 3.53. Use
  `sqlite3.oo1.OpfsDb` or `sqlite3.capi.sqlite3_vfs_find('opfs')` instead.

### Timings (ms, no COOP/COEP unless noted)

| Operation | memory | opfs-sahpool | opfs-sahpool, 32 MiB cache | opfs (COOP/COEP) | opfs, 32 MiB cache (COOP/COEP) |
|---|---|---|---|---|---|
| Open | 3 | 35 | 36 | 13 | 10 |
| Insert 50k rows, one transaction | 1,881 | 4,129 | 4,129 | 4,700 | 4,879 |
| `count(*)` | 0.6 | 16.5 | 1.7 | 29.3 | 6.3 |
| Indexed query, 50 rows | 1.4 | 7.5 | 2.1 | 12.8 | 7.0 |
| `LIKE '%…%'` full scan | 32 | 263 | 34 | 376 | 41 |
| Update 1,000 rows, one transaction | 2.8 | 148 | 156 | 282 | 278 |
| 100 single-statement (autocommit) inserts | 4.7 | 2,098 | 2,226 | 3,650 | 4,181 |
| Same, `journal_mode=TRUNCATE`, `synchronous=NORMAL` | 8.7 | 1,768 | 1,970 | 3,583 | 4,167 |
| Build FTS5 index over 50k rows | 229 | 1,786 | 1,088 | 2,239 | 1,242 |
| FTS5 `MATCH` + `bm25` ordering, top 20 | 30 | 829 | 37 | 1,039 | 40 |
| FTS5 prefix query (`pass*`) count | 4.3 | 6.9 | 5.7 | 8.6 | 22 |
| Reopen + `count(*)` | — | 1 | 1 | 2 | 3 |

The `opfs-sahpool` numbers with COOP/COEP are within noise of those without.

### Takeaways

- **Use `opfs-sahpool` on the web.** It is the only OPFS VFS that works
  without cross-origin isolation, so the PWA can be hosted on GitHub Pages
  (RELEASE.md). It is also as fast as or faster than `opfs` here.
- **Reads are fine** once the working set fits in the page cache. With a
  32 MiB cache, every query on 50k rows ran in under 40 ms. A larger cache
  costs memory, so size it in P0.5, not here.
- **Each commit costs about 20 ms** in this sandbox (the in-memory baseline is
  about 0.05 ms). Repositories must group a record write, its change-log entry
  and its FTS update into one transaction, and bulk operations (import, sync
  apply) must batch many records per transaction. Loosening durability barely
  helped, so don't trade safety for it.
- **One tab owns the database.** The web driver needs cross-tab coordination:
  the first tab takes a Web Lock and owns the worker; other tabs either proxy
  queries to it (BroadcastChannel) or show a "Life Manager is open in another
  tab" screen. That choice belongs to P0.5.

## 2. libsodium Argon2id (`crypto_pwhash`, opslimit 3)

Three runs each, in a dedicated worker in Chromium, and under Node
([argon2-node.mjs](argon2-node.mjs)). Both use the same wasm build.

| memlimit | Chromium worker (ms) | Node (ms) |
|---|---|---|
| 64 MiB | 252, 197, 216 | 262, 212, 210 |
| 128 MiB | 449, 414, 429 | 494, 449, 452 |
| 256 MiB | 948, 971, 976 | 1009, 1048, 1088 |
| 512 MiB | — | 2157, 2068, 2105 |

- Time scales linearly with memory: about 4 ms per MiB on this CPU.
- 256 MiB allocates without errors in the browser's wasm heap, so the desktop
  parameter in SECURITY.md (256 MiB, about 1 s) is workable on desktop-class
  CPUs.
- **Still open:** the mid-range Android measurement. Chrome DevTools CPU
  throttling does not apply to dedicated workers, so it can't stand in for a
  phone. Until a device run exists, keep 64 MiB for mobile and web.
