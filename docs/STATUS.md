# Status

**Update this file at the end of every working session.** Keep "Current state"
short and current. Add new log entries at the top.

## Current state

- **Phase:** 0 (foundations).
  - Done:
    - P0.1 Monorepo & tooling;
    - P0.3 Core primitives (ADR-012…015);
    - P0.4 Crypto (ADR-016, ADR-017, and ADR-019's format fix);
    - P0.5 Local DB (ADR-018). Its manual check of the desktop and mobile
      drivers is still pending.
  - **P0.6 Sync engine is about two-thirds done** (ADR-020).
    - Done:
      - the transport interface;
      - the fake forge;
      - the full sync cycle wired into the database;
      - the convergence simulator (CI on every PR, plus a nightly
        1,000-seed run).
    - Left:
      - the real GitHub and GitLab transports;
      - their opt-in contract tests;
      - the AC's real two-device sync on each forge.
  - Partly done: P0.2 Spikes.
    - Done: sqlite-wasm OPFS.
    - Argon2id was measured on desktop only.
    - GitHub: read-side checks pass; the write/CAS/GraphQL script waits for
      the owner's local run.
    - Not run: GitLab, Tauri, Capacitor.
- **Next:**
  - **P0.6 part 2:** the GitHub transport, as soon as the owner's spike
    results are in (they settle the empty-repo bootstrap and the CAS
    details); then GitLab.
  - P0.7 App shells can start in parallel: platform interfaces, theme, i18n
    and the onboarding UI against the fake forge.
- **Blockers / needs owner input:**
  - **GitHub spike: the owner needs to run `pnpm github` locally** (see
    spikes/README.md). Cloud sessions' GitHub proxy blocks REST writes,
    GraphQL and `OPTIONS`. GitLab still needs a scratch project and a token.
- **Known risks:**
  - **Tauri SQL transactions** (ADR-018): `tauri-plugin-sql` uses a
    connection pool, so BEGIN/COMMIT may hit different connections. The
    Tauri spike must check this before P0.7.
  - GitLab commit concurrency (`last_commit_id`) and archive-download CORS
    are still unverified.
  - API rate limits during the first sync of large repos.
  - The HLC has no maximum-drift guard; one device with a far-future clock
    drags every HLC forward. Still open (ADR-012, ADR-020).
  - A 50k-record first import into sqlite-wasm takes about 5 s; it needs
    batching and a progress bar.
- **Unverified:**
  - the forge spikes;
  - Argon2id on Android (it may lower the ADR-016 default to 128 MiB);
  - the Tauri and Capacitor SQL drivers on real devices, including FTS5 in
    their SQLite builds;
  - OPFS `createWritable` in Safari;
  - the nightly workflow (it first runs after merge).

## Handoff notes for the next session

**P0.2 GitHub spike.** Status: waiting on the owner. The script is merged;
the spike stays unchecked until the owner's results are in.

1. The owner runs `pnpm github` in `spikes/` against their own private,
   empty scratch repo with a fine-grained PAT (Contents: Read and write on that
   repo only). The script writes `spikes/forges/github-result.json`; ask the
   owner to paste or commit it. Never put the repo name or token in the repo.
2. When the results arrive:
   - Fill in the GitHub section of `spikes/README.md` and the results table.
   - Write an ADR (the next free number in DECISIONS.md) covering:
     - **Empty-repo bootstrap.** If the git data API rejects writes on an
       empty repo (expected: 409), SYNC.md §7/§8 and the `SyncTransport`
       design need a first-commit path through
       `PUT /repos/{o}/{r}/contents/lm.json`. A 409 from
       `GET /git/ref/heads/{b}` means "empty repo" (verified).
     - **CAS.** Confirm that `force:false` gives 422 for a same-parent race,
       for a stale (ancestor) parent, and under truly concurrent PATCHes. If
       any of these returns 200, the CAS design in SYNC.md §7 is broken: stop
       and ask the owner (AGENTS.md §8).
     - Whether GraphQL returns `text: null` / `isBinary: true` for `.lmb`
       blobs. SYNC.md already plans REST for binary; confirm it.
     - Whether the empty `s2` directory disappears after its last file is
       deleted.
     - Whether the author `noreply@invalid` is accepted, and what committer
       GitHub records for a PAT. It must not leak a device name (SECURITY.md).
     - The GraphQL point cost of a 100-blob query, to size batches for the
       rate-limit tracker.
   - Update SYNC.md in the same commit if anything changed. Tick the GitHub
     spike in ROADMAP.md.
3. **Cloud-session limits found this session** (also in AGENTS.md §7): the
   session's GitHub proxy injects its own token and allows REST reads only.
   - REST writes (`git/blobs`, `git/trees`, `git/refs`, `contents` PUT) →
     403.
   - GraphQL → 403.
   - `OPTIONS` → 405.
   - The GitHub MCP integration also can't create repositories.

   So no real-forge write test or browser CORS test can run in a cloud
   session. Don't retry them; give the owner a script to run instead. Read-only
   REST works (Node needs `NODE_USE_ENV_PROXY=1`).

**P0.4 crypto, for whoever uses it next (P0.6–P0.7):**

- Call `await initCrypto()` once at startup. Every other function is
  synchronous and throws `LmCryptoError` with a stable `code`; the messages
  are safe to log.
- The public API is in `packages/crypto/src/index.ts`. Envelope JSON
  encoding is the caller's job; crypto takes bytes.
- **Don't change pinned test vectors to make tests pass.** They lock the
  on-repo format.
- Web (P0.7): run `unlockWithPassphrase`/`createLmJson` in a worker (the
  256 MiB Argon2id blocks for about 1 s), and lazy-load `@lm/crypto` (the
  bundle is 223 KB gzipped).
- Still to build in P0.7: the web "unlock for 7 days" wrap and the `lm-locl`
  secret store.

**P0.6 sync, for the GitHub/GitLab transports and P0.7:**

- `SyncEngine({ db, transport, keys, rng })` and `engine.sync()`, which
  returns `ok | conflict | rateLimited | authError | error`.
  `packages/sync/src/test-support/devices.ts` shows the wiring.
- **A real transport must behave exactly like `FakeForge`:**
  - `commit` returns `'conflict'` when the branch moved;
  - `listTree` returns direct children with SHAs;
  - `readBlobs` leaves out missing blobs;
  - it throws `RateLimitedError` and `AuthError`.

  Write the contract tests (`LM_TEST_GITHUB_*`) as one shared suite run
  against both `FakeForge` and the real transport.
- **The engine doesn't create `lm.json` or the first commit.** It reports an
  error on an empty repo. Onboarding (P0.7) does that, through
  `createLmJson` and the transport, and the spike decides how on GitHub.
- **The simulator:** `SIM_SEEDS`, `SIM_OPS` and `SIM_FIRST_SEED` control
  `pnpm --filter @lm/sync exec vitest run src/sim`. Run it after any change
  to `packages/sync` or the merge (AGENTS.md §4.3).

**P0.5 db, for P0.6 (sync) and P0.7 (shells):**

- Open the database with `LmDatabase.open({ driver, clock, rng, onProblem })`.
  It migrates and loads the device id and HLC state.
  - Drivers: `openWorkerDriver(worker, file)` on the web, with the worker
    entry at `packages/db/src/web/sqlite.worker.ts`;
    `createTauriDriver(db)`; `createCapacitorDriver(conn)`;
    `openMemoryDriver()` for tests.
- Sync uses `LmDatabase.syncTransaction` (added in P0.6) for everything it
  writes.
- **Attachments:** the stored files are already the `.lmb` repo bytes, named
  `basename(blobPath(keys, hash))`. Sync uploads and downloads them as they
  are; verify downloads with `AttachmentStore.get`.
- **The repository suite** (`src/test-support/repository-suite.ts`) runs in
  Vitest and in Chromium (`pnpm --filter @lm/db test:e2e`, part of
  `pnpm test:e2e` and CI). Add new cases there so both runs get them.
- **P0.7 shell duties:**
  - Elect the owner tab with Web Locks (ADR-011) before starting the worker.
  - Pass `crypto.getRandomValues`-backed `rng` and `Date.now` as `clock`.
  - Wire `onProblem` to the sync status UI.

## Session log

### 2026-10-10 — P0.6 part 1: sync engine, fake forge, simulator
- **Spec contradiction, fixed with the owner (ADR-019).** Records were bound
  to their id, which a device can't learn from a keyed file name. They are
  now bound to the file name, and the engine checks the id against the path
  after decrypting. The pinned `.lmr` vector changed.
- **`@lm/db`:** `syncTransaction` (read, merge and write in one
  transaction; base, change log, remote snapshot, kept files, metadata) and
  `keptFiles()`.
- **`@lm/sync`:**
  - the `SyncTransport` interface (`listTree` instead of
    `getTree`/`getTreeRecursive`);
  - `FakeForge`;
  - `SyncEngine`, with:
    - the Merkle-diff pull and batched apply-or-merge;
    - kept files with reasons;
    - push with CAS, paging over several commits and backoff;
    - rate-limit skips and the one-cycle lock.
- **Tests:**
  - 23 engine and forge tests, 97.6% branch coverage;
  - the simulator: 6 seeds × 300 ops in CI, with an assertion that real CAS
    races occurred.
  - Locally, 40 seeds × 1,000 ops and 1,000 seeds × 300 ops (seeds 1000–1999, 22 minutes) all converged.
  - A deliberately broken merge made the simulator fail, as it should.
  - Nightly workflow: 1,000 seeds × 1,000 ops in 10 shards.
- **Surprise:** the first Merkle-walk version kept stale snapshot entries
  when a whole directory disappeared. A test caught it, and it's fixed.
- **Left for P0.6 part 2:** the GitHub and GitLab transports and their
  contract tests, after the owner's spike run.

### 2026-10-10 — P0.5 Local DB
- **Drivers** (`SqlDriver`): in-memory sqlite-wasm (tests), a web worker on
  `opfs-sahpool` over `postMessage` RPC, and Tauri and Capacitor adapters
  over the plugins' connection objects.
  - All share a serial queue, and transactions use `BEGIN IMMEDIATE`.
  - One contract suite runs against all four; the Tauri and Capacitor runs
    use fakes backed by real SQLite.
- **Migrations:**
  - a numbered runner that refuses a database from a newer app;
  - migration 1 creates 46 `ent_*` tables (JSON `data` plus expression
    indexes), `sync_meta`/`sync_remote`/`sync_base`/`change_log`/
    `sync_kept` and an FTS5 index.
- **`LmDatabase`:**
  - create, get, list (where, orderBy, limit), update with per-field HLCs
    on changed fields only, delete (tombstone) and restore;
  - change log, persisted device id and HLC, decode-on-read with problem
    reporting;
  - live queries;
  - Persian-aware prefix search.
- **`AttachmentStore`** over a new `FileStore` interface in `@lm/platform`
  (memory and OPFS). Files are `.lmb` bytes under keyed names.
- **Tests:**
  - 48 unit tests, covering 100% of lines and 96% of branches;
  - a Playwright browser suite that runs the same repository cases through
    the real worker on OPFS, plus persistence across a new worker and OPFS
    attachments. Both pass, and the browser suite is now part of
    `pnpm test:e2e`.
- **Surprises:**
  - The `opfs-sahpool` VFS has only 6 file slots by default and fails with
    `SQLITE_CANTOPEN` when they run out. The worker now reserves capacity.
  - FTS5's `unicode61` tokenizer splits Persian words at the ZWNJ. The index
    stores both forms.
- **Left for later:**
  - sync-side record writes (P0.6);
  - device verification of the Tauri and Capacitor drivers (with their
    spikes).

### 2026-10-10 — P0.4 Crypto
- The owner accepted the Argon2id proposal (ADR-016): one setting per repo,
  default ops 3 / 256 MiB, falling to 128 MiB if Android is too slow.
- `packages/crypto`:
  - Argon2id KEK, XChaCha20-Poly1305 seal/open, BLAKE2b keyed hash and
    `crypto_kdf` sub-keys;
  - recovery key as BIP-39 words (`@scure/bip39`) and as Crockford base32
    with a checksum;
  - `lm.json` create, parse (zod), unlock by passphrase or recovery key,
    rewrap of either, and a key check;
  - `.lmr`/`.lmb` codecs with AD binding, and sharded record/blob paths.
- **Surprise:** SECURITY.md's 7-character sub-key contexts are invalid for
  libsodium, which needs exactly 8 bytes. They are NUL-padded now (ADR-017).
  I also added an `lm-chk1` context for the key check.
- **Tests (41, 100% coverage enforced):**
  - published vectors: the XChaCha draft and BLAKE2b from RFC 7693;
  - BIP-39 reference vectors;
  - cross-checks against `@noble` for Argon2id, BLAKE2b, `crypto_kdf` and
    XChaCha;
  - pinned regression vectors (sub-keys, paths, an `.lmr` file, a v1
    `lm.json` fixture);
  - tamper, relocation and truncation rejection;
  - a check that SECURITY.md lists every context and AD prefix.
- Specs updated: SECURITY.md §2, SYNC.md §1–2, TECH-STACK.md.

### 2026-10-10 — P0.2 GitHub spike: empty-repo case, more checks, partial run
- The owner created a private, empty scratch repo. `forges/github.mjs` used
  to crash on an empty repo, which is exactly the onboarding case. It now
  records how the git data API behaves on an empty repo and bootstraps the
  first commit with the contents API.
- New checks:
  - locally computed blob SHAs match the tree;
  - the `.lmr` sharded layout;
  - the `noreply@invalid` author;
  - delete via `sha:null`;
  - a binary `.lmb` round trip, and what GraphQL returns for binary blobs;
  - stale-parent → 422;
  - 5 rounds of concurrent fast-forwards.
- It writes `forges/github-result.json`.
- **Surprise:** the cloud session proxy blocks every REST write
  (`git/blobs`, `git/trees`, `contents` PUT), GraphQL and `OPTIONS`, even
  for a repo attached with push access. Writes, CAS and GraphQL can't be
  tested from a cloud session; the owner has to run the script locally.
- **Verified here:**
  - an empty repo answers `GET /git/ref` with 409 "Git Repository is
    empty.";
  - local git blob SHAs match GitHub's (20/20, read-only on the code repo);
  - the non-recursive tree walk agrees with the recursive tree;
  - CORS and rate-limit headers are present on real responses;
  - a REST blob read takes about 260 ms.
- No ADR yet; it waits for the owner's run.

### 2026-10-10 — P0.3 Core primitives (part 4): recurrence engine
- `occurrences(rule, start, range, {weekStart})` expands fixed series.
  `nextInstance(rule, {due, completedOn}, {weekStart})` computes the next
  task instance and the rule to store on it.
- **Supported rules:**
  - daily, weekly, monthly and yearly;
  - interval;
  - `byWeekday`, `byMonthDay` (negative counts from the end, clamped),
    `byMonth`, `bySetPos`;
  - `until`, `count`;
  - Gregorian and Jalali periods;
  - `fixed` and `afterCompletion` modes.
- Time-zone-free: everything uses Julian Day Numbers, and Jalali conversion
  uses `jalaali-js` (ADR-015).
- **Tests:**
  - known Jalali dates (Nowruz, 30 Esfand in leap years);
  - RFC-style cases (2nd Tuesday, last Friday, Friday the 13th,
    Thanksgiving, Feb 29);
  - week-start effects, edges of the calendar range, and impossible rules.
  - **Properties:** results match an independent day-by-day oracle;
    chaining `nextInstance` reproduces `occurrences`; Gregorian conversion
    agrees with `Date.UTC`; Jalali dates round-trip.
  - Core stays at 100% coverage.
- **Surprises:**
  - The first version scanned 10,000 empty periods before ending an
    impossible rule, which timed out under coverage instrumentation. The cap
    is now per frequency, and day matching no longer allocates.
  - DATA-MODEL's `Recurrence` has no start date, so `count` on a stored rule
    now means "instances left".

### 2026-10-10 — P0.3 Core primitives (part 3): merge function
- `mergeRecords(base, ours, theirs)` in `@lm/core` implements SYNC.md §6:
  - scalars by field HLC;
  - sets as base + additions − removals;
  - lists by item id, sorted by (order, id);
  - long text through line-based diff3 (`node-diff3`), with conflict blocks;
  - edit-beats-delete, reported as `restored`.
- `_unknown` fields and unknown envelope keys merge per key.
- Merged records that break a cross-field rule are returned whole, with
  `issues`.
- `hasConflict` became the envelope field `conflicts: string[]`, which merges
  as a set (ADR-014).
- **Tests:** unit tests for every row of the §6 table, plus fast-check
  properties:
  - commutativity, byte for byte;
  - idempotence;
  - one-sided changes applied unchanged;
  - convergence between two devices;
  - no lost set element, list item or text line;
  - the deletion rules.
  - Core stays at 100% coverage.
- Surprise: none in the merge laws. The only property failure was an empty
  `_unknown: {}` being dropped, which broke idempotence. Fixed.

### 2026-10-10 — P0.3 Core primitives (part 2): envelope and entity schemas
- `@lm/core` now has zod schemas for all 45 entities in DATA-MODEL.md plus
  `settings`, grouped by section in `entities/modules/`, and the shared value
  types in `entities/primitives.ts`.
- Each entity declares its version, upgraders and merge kinds
  (`text`/`set`/`list`). `decodeRecord` validates, upgrades and returns
  either `ok` or `kept` with a reason; it never throws or drops data.
  `parseEntityData` is the throwing variant for local writes.
- Tests:
  - A fixture for every entity (the compiler enforces completeness).
  - A check that the registry matches DATA-MODEL.md's tables.
  - Upgrade-chain tests with a fake v3 entity.
  - Property tests that no key is ever lost and that parsing is idempotent.
  - Core stays at 100% coverage.
- Filled spec gaps (Goal status, settings fields, BlobRef, tag ids, and
  others) are recorded in ADR-013 and DATA-MODEL.md. SYNC.md §3 gained
  `createdAt` and the decode rules.
- Surprise: a fast-check run found that a data key named `__proto__` was
  silently dropped by plain assignment, `z.record` and zod loose objects.
  Free-form maps are now passed through untouched.

### 2026-10-10 — P0.2 Spikes (part 2): forge preflights, SQLite cache size
- Ran unauthenticated CORS preflights against GitHub (GraphQL,
  `git/trees`, `git/refs`) and GitLab (tree, commits, archive). All pass with
  `Access-Control-Allow-Origin: *`, and GitLab exposes its pagination
  headers. Added `spikes/forges/preflight.mjs`.
- A second sqlite-wasm run on a 31 MiB DB showed the default 2 MiB page cache
  makes full scans take 3.5–5 s, compared with about 50 ms at 32 MiB. The web
  driver must set `cache_size` (noted for P0.5). About 20 ms per committed
  transaction on `opfs-sahpool`.
- Surprise: this session first re-did the whole P0.2 spike on a branch that
  was stale, without the merged PR #4. Only the new findings were kept.

### 2026-10-09 — P0.3 Core primitives (part 1): ULID, HLC, order keys
- `@lm/core` now exports `Clock`/`Rng` (injected), `createUlidGenerator` /
  `isUlid`, `HybridLogicalClock` with `formatHlc`/`parseHlc`/`compareHlc`,
  and `orderBetween`/`ordersBetween`/`compareByOrder`.
- Property tests (fast-check) cover HLC monotonicity under arbitrary clock
  jumps and remote receives, wire-format order, ULID monotonicity, and
  arbitrary insert sequences for order keys. `core` tests now run with a
  100% coverage gate (`@vitest/coverage-v8`).
- Added the `ulid` and `fractional-indexing` dependencies. Recorded the format
  details as ADR-012 and updated SYNC.md §3, DATA-MODEL.md §1 and TECH-STACK.
- Surprise: `ulid`'s `isValid` accepts lowercase and overflowing ids, so
  `isUlid` uses a stricter canonical check.

### 2026-10-09 — P0.2 Spikes (part 1)
- Added `spikes/` (outside the workspace, ESLint-ignored) with results in
  `spikes/README.md`.
- sqlite-wasm 3.53 in a worker, 50k rows + FTS5, headless Chromium: both OPFS
  VFSes work and persist; FTS5 is available; no WAL. Chose `opfs-sahpool` with
  a single owner tab (ADR-011) and updated ARCHITECTURE and TECH-STACK.
- Argon2id timings in Node and Chromium (64 MiB ≈ 0.2 s, 256 MiB ≈ 0.8–1 s on
  a 2.1 GHz Xeon). Found that SECURITY.md's per-platform parameters conflict
  with the single `kdf` block in `lm.json`; raised as a blocker.
- Wrote the GitHub and GitLab spike scripts (CORS, GraphQL batch read, CAS
  races, keyset pagination, `last_commit_id`, archive). Not run: probing the
  forges from this session was not permitted.
- Surprise: the sqlite-wasm README's `'opfs' in sqlite3` check is stale; use
  `sqlite3.oo1.OpfsDb`.

### 2026-10-09 — P0.1 Monorepo & tooling
- Set up the pnpm + Turborepo workspace, with skeletons for every package in
  ARCHITECTURE.md §3. `apps/desktop` and `apps/mobile` are placeholders until
  P0.7.
- Strict TS base config, ESLint flat config and Prettier.
  - `@lm/eslint-plugin` adds `no-physical-direction` (Tailwind classes and
    inline styles), with 41 tests.
  - `@lm/core` is restricted from DOM, network and Node APIs.
  - `@lm/repo-checks` (`lm-check-deps`) enforces the dependency direction and
    runs in `pnpm lint`.
- Vitest in every package (ui uses jsdom + Testing Library); a Playwright
  smoke test in light and dark (RTL projects come in P0.7, together with RTL
  support); Ladle for `@lm/ui`.
- Added the CI workflow (`check` and `e2e` jobs) and a cloud SessionStart hook
  (installs deps, sets `PW_CHROMIUM_PATH`).
- Pinned TypeScript 6.0 and ESLint 9 because of plugin compatibility
  (ADR-009). Packages ship TS source with no build step (ADR-010).
- Turborepo writes an agent-guidance block into AGENTS.md automatically; it is
  kept on purpose.

### 2026-10-09 — Planning session
- Gathered requirements from the owner and recorded them as decisions
  ADR-001…008.
- Wrote ARCHITECTURE, SYNC, SECURITY, DATA-MODEL, DESIGN, TECH-STACK, RELEASE
  and ROADMAP, plus AGENTS.md and CLAUDE.md.
- Owner's answers: sync through GitHub/GitLab, including from the web; iOS
  eventually; installers without app stores; usable by anyone with their own
  repo; importers wanted; minimal modern design with dark and light modes; en
  + fa (RTL); Jalali; multi-currency; Claude + Ollama; all four calendar
  source types.
