# Status

**Update this file at the end of every working session.** Keep "Current state"
short and current. Add new log entries at the top.

## Current state

- **Phase:** 0 (foundations). P0.1 and **P0.3 Core primitives are done**;
  P0.2 Spikes is partly done.
  - P0.3 delivered:
    - ULID, HLC and fractional indexing (ADR-012);
    - the envelope and entity schemas (ADR-013);
    - the merge function (ADR-014);
    - the recurrence engine (ADR-015).
  - Done: sqlite-wasm OPFS (ADR-011). Partly done: Argon2id (desktop-class
    CPU only).
  - GitHub and GitLab API spikes (`spikes/forges/`): the unauthenticated CORS
    preflights pass for every endpoint we need.
    - GitHub: the read-side checks pass. The full script (empty-repo
      bootstrap, writes, CAS, GraphQL) is ready but waits for the owner's
      local run.
    - GitLab: the full script hasn't been run.
  - Not started: Tauri and Capacitor spikes (need macOS/Windows/Android).
- **Next milestone:** **P0.4 Crypto** (`packages/crypto`).
  - Building it needs the owner's answer on the Argon2id parameters (see
    Blockers). Everything else in P0.4 can proceed.
  - P0.2's remaining spikes still need tokens or devices (see below).
- **Blockers / needs owner input:**
  - **Argon2id parameters (security, data format).** SECURITY.md §2 says
    256 MiB on desktop and 64 MiB on mobile/web, but `lm.json` holds one `kdf`
    block, so the parameters are per repo and set by the device that creates
    it. Proposal: one per-repo setting, default ops 3 / 256 MiB (0.8 s in
    Chromium on a 2.1 GHz Xeon), dropping to 128 MiB if the Android
    measurement exceeds ~3 s. Alternative: one wrapped key per KDF setting in
    `lm.json`. Needs an owner decision before P0.4.
  - **GitHub spike: the owner needs to run `pnpm github` locally** (see
    spikes/README.md). Cloud sessions' GitHub proxy blocks REST writes,
    GraphQL and `OPTIONS`, so the write, CAS and GraphQL checks can't run here
    even with a scratch repo attached. GitLab still needs a scratch project and
    a token.
- **Known risks:**
  - GitLab commit concurrency (`last_commit_id`) and archive-download CORS
    are still unverified.
  - API rate limits during the first sync of large repos.
  - The HLC has no maximum-drift guard; one device with a far-future clock
    drags every HLC forward. P0.6 should decide how to handle that (ADR-012).
  - A 50k-record first import into sqlite-wasm takes about 5 s; it needs
    batching and a progress bar.
- **Unverified:** the forge spikes, Argon2id on Android, Tauri and Capacitor
  plugins. CI ran on the P0.1 PRs.

## Handoff notes for the next session

**P0.2 GitHub spike.** Status: waiting on the owner. Branch
`ccr-cc42ae27-j072nd`; don't merge it as "spike done" until the owner's
results are in.

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

**Also pending:** the owner's Argon2id decision (Blockers above). It gates
P0.4, which is the next milestone. P0.4 work that doesn't depend on the KDF
parameters (AEAD, keyed hash, sub-keys, recovery-key encoding, record/blob
codecs) can start now.

## Session log

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
