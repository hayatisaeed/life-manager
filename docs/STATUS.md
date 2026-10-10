# Status

**Update this file at the end of every working session.** Keep "Current state"
short and current. Add new log entries at the top.

## Current state

- **Phase:** 0 (foundations). P0.1 is done; **P0.2 Spikes and P0.3 Core
  primitives are in progress.**
  - P0.3: ULID, HLC and fractional indexing are done (ADR-012). Next: the
    envelope and zod entity schemas, then merge, then recurrence.
  - Done: sqlite-wasm OPFS (ADR-011). Partly done: Argon2id (desktop-class
    CPU only).
  - GitHub and GitLab API spikes (`spikes/forges/`): the unauthenticated CORS
    preflights pass for every endpoint we need. The full scripts haven't been
    run; they need a throwaway repo and token.
  - Not started: Tauri and Capacitor spikes (need macOS/Windows/Android).
- **Next milestone:** finish P0.2 by running `spikes/forges/*.mjs` against
  scratch repos (owner or a local session with `LM_TEST_*` tokens). P0.3 Core
  primitives continues in parallel (next task: envelope + entity schemas).
- **Blockers / needs owner input:**
  - **Argon2id parameters (security, data format).** SECURITY.md §2 says
    256 MiB on desktop and 64 MiB on mobile/web, but `lm.json` holds one `kdf`
    block, so the parameters are per repo and set by the device that creates
    it. Proposal: one per-repo setting, default ops 3 / 256 MiB (0.8 s in
    Chromium on a 2.1 GHz Xeon), dropping to 128 MiB if the Android
    measurement exceeds ~3 s. Alternative: one wrapped key per KDF setting in
    `lm.json`. Needs an owner decision before P0.4.
  - Running the forge spikes needs a throwaway GitHub repo and GitLab project
    with tokens; this cloud session could not reach them.
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

## Session log

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
