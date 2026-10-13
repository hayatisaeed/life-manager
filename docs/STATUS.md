# Status

**Update this file at the end of every working session.** Keep "Current state"
short and current. Add new log entries at the top.

## Current state

- **Phase:** 0 foundations plus an early local web feature slice. P0.1 remains
  complete; later milestones are partially implemented, not release-ready.
- **Implemented:** core IDs/clocks/order, 45 domain schemas (Settings preserved
  pending its complete schema), recurrence in both calendars, scalar/set/ordered
  merges and causal long-text provenance; libsodium vault/record/blob wrappers;
  SQLite worker OPFS persistence, migrations, FTS5, HLC/change log, CRUD,
  tombstones/undo, live-query subscription and JSON export.
- **Usable web screens:** Today, Inbox capture/conversion, Tasks, Projects, local
  Events, daily boolean Habits, Focus sessions, Accounts/Transactions, Health and
  Journal logs, Notes, People, Resources, Assets, manual Goals and Settings.
  These are minimal slices, not completed feature phases.
- **Next work:** P0.2 external/native spikes, complete P0.3 coverage/schema
  acceptance, native DB/platform adapters, encrypted attachment persistence,
  sync transports/cycle/simulator and full onboarding; then finish domain UIs.
- **Publication method:** the owner explicitly authorized signed-in GitHub
  browser publication on 2026-10-13. Browser branch creation and commits work.
  Terminal Git credentials and connector write access remain unavailable;
  browser publication replaces the earlier access blocker.
- **Blockers / external validation:** no dedicated forge test repositories/tokens
  supplied for authenticated CAS/CORS contract tests. `cargo` and `adb` are not
  available on this host. Windows/Android packaging and mobile KDF timing cannot
  be verified here. No owner's live data repo has been used for tests.
- **Known gaps:** sync, AI, external calendars, PWA offline shell caching,
  notifications, native shells, importers, advanced planner/time blocking,
  budgets, streaks, routines, flashcards, document vault and insights remain
  unfinished. Date entry is Gregorian; date display can be Jalali. Notes use a
  plain textarea. Mobile navigation is a scrollable strip. Text-version graph
  pruning remains unspecified. Required 100% branch coverage and all primitive
  known-answer vectors are not yet established.
- **Verified locally:** `pnpm check` (86 unit tests), production web build,
  `pnpm test:e2e` (16 tests in light/dark and en/fa), persisted data after reload,
  the Ladle story build, and page overflow checks at 1440/768/390/320px. Browser visual review covered
  English light desktop, Persian dark phone, and tablet layouts. Native
  platforms, the full sync simulator, network integrations, accessibility axe
  checks and installer distribution are unverified.

## Session log

### 2026-10-13 — Domain foundations and persistent local web workspace
- Cloned the remote project into the empty local workspace and implemented a
  broad local slice at the owner's request to code the project in one pass.
- Added deterministic primitives, entity validation/upgrades with preservation,
  Gregorian/Jalali recurrence and tested merges. Five-replica text tests run 1,000
  random delivery orders including stale resends; this is not the full sync
  convergence simulator.
- Fixed two sync-spec problems with explicit owner approval: bind record AEAD to
  the opaque remote path so a new device can decrypt; retain causal original
  text versions to avoid order-dependent diff3 conflict nesting (ADR-011/013).
- Added libsodium key derivation, recovery encoding, vault create/unlock/rewrap,
  authenticated codecs, tamper/relocation tests and a keyed BLAKE2b vector.
- Added SQLite WASM OPFS worker storage, serial transactions, migration 1,
  query views, FTS5, record preservation, change-log writes and live updates.
- Replaced the placeholder with working local screens, locally bundled fonts,
  en/fa catalogs, RTL, light/dark/system themes, calendar/digit preferences,
  delete/undo, focus-session recording and plain JSON export.
- Checks passed: lint/format/typecheck/unit tests, production web build and all
  16 Playwright tests. Reviewed rendered desktop/tablet/phone layouts. Fixed the
  account selector's accessible label, optional date clearing, local event time
  editing and the ULID library's ambient-time fallback at epoch zero.
- Remaining scope and external blockers are listed above. No phase-wide or
  cross-platform completion is claimed.


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
