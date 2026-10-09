# Status

**Update this file at the end of every working session.** Keep "Current state"
short and current. Add new log entries at the top.

## Current state

- **Phase:** 0 (foundations). P0.1 is done; **P0.2 Spikes is in progress.**
  - Done: sqlite-wasm OPFS (ADR-011). Partly done: Argon2id (desktop-class
    CPU only).
  - Scripts ready but not run: GitHub and GitLab API spikes
    (`spikes/forges/`). They need a throwaway repo and token.
  - Not started: Tauri and Capacitor spikes (need macOS/Windows/Android).
- **Next milestone:** finish P0.2 by running `spikes/forges/*.mjs` against
  scratch repos (owner or a local session with `LM_TEST_*` tokens). P0.3 Core
  primitives does not depend on the spikes and can start in parallel.
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
  - A 50k-record first import into sqlite-wasm takes about 5 s; it needs
    batching and a progress bar.
- **Unverified:** the forge spikes, Argon2id on Android, Tauri and Capacitor
  plugins. CI ran on the P0.1 PRs.

## Session log

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
