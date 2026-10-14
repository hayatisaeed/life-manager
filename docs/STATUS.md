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
- **Research:** [UX-RESEARCH.md](UX-RESEARCH.md) records 18 UI/UX findings and
  24 feature opportunities from source/browser inspection and primary sources.
  Priorities are continuity/recovery, the daily planning loop, then module depth;
  research is complete, implementation is still pending.
- **Approved direction:** ADR-016 accepts snapshot migration to a fresh private
  repo, authenticated vault v2/write gates and indefinite tombstone/text
  retention. The accepted protocol remains at
  [SYNC-MAINTENANCE-PROPOSAL.md](SYNC-MAINTENANCE-PROPOSAL.md); acceptance does not
  mean runtime maintenance is available.
- **New foundations:** authenticated v2 crypto/control/rewrap and sync-vault
  helpers; SQLite migration 2, transactional pulls and conditional dirty-version
  acknowledgments; preserved ciphertext/export; record sync lock/Merkle/batching/
  retries/rate limits; GitHub and experimental GitLab transports; HTTPS allowlist,
  encrypted web-secret codec/IndexedDB adapter and Web Locks adapter.
- **Next work:** P0.2 dedicated forge/CORS/native spikes; durable identity/key/
  generation pinning, fresh-repo initialization and full onboarding; attachment
  sync, migration orchestration and offline recovery UI. Continue complete P0.3
  schema/coverage acceptance, native DB/platform adapters and remaining domain
  UIs. These new APIs are not yet connected to the local web workspace.
- **Publication:** sync foundations are committed locally on
  `codex/sync-recovery-protocol` (`c38ea79`); continuity work is on
  `codex/workspace-continuity`. Terminal push lacks credentials. Connector read
  checks confirmed both remote targets absent and research base `2ac1fbc` has
  the same tree as local `27f66b8`. Automatic approval review rejected branch
  creation twice (unconfirmed base/overwrite risk, then a documentation base
  rather than the local tested tip). No remote write or PR was created.
  Publication now requires exact authorization for the two tested branch snapshots
  and their verified base; do not bypass the automatic review rejection.
- **Blockers / external validation:** no dedicated forge test repositories/tokens
  supplied for authenticated CAS/CORS contract tests. `cargo` and `adb` are not
  available on this host. Windows/Android packaging and mobile KDF timing cannot
  be verified here. No owner's live data repo has been used for tests.
- **Local UX improvements:** draft input and active/paused Focus state survive
  module navigation; stable IDs and save/finish guards prevent duplicate retries;
  editor saves patch only edited fields and acknowledge the submitted draft
  revision. Persistent capture, keyboard focus and save feedback work everywhere.
  Today excludes undated backlog unless selected, and priorities have named choices.
- **Remaining UX risks:** drafts/focus state are memory-only; before-unload and
  localized notices communicate the reload limit. Mobile still hides storage
  status and uses a navigation strip. Restore UI, calendar-aware entry, routing,
  field errors and the remaining planning/detail depth are unfinished.
- **Known gaps:** product-connected sync/onboarding, AI, external calendars, PWA offline shell caching,
  notifications, native shells, importers, advanced planner/time blocking,
  budgets, streaks, routines, flashcards, document vault and insights remain
  unfinished. Date entry is Gregorian; date display can be Jalali. Notes use a
  plain textarea. Mobile navigation is a scrollable strip. Text-version graph
  pruning is explicitly unavailable pending a separate accepted protocol. Required 100% branch coverage and all primitive
  known-answer vectors are not yet established.
- **Verified locally:** `pnpm check` (124 unit tests; two opt-in forge contracts
  not run), production web build, `pnpm test:e2e` (28 tests in light/dark and en/fa), persisted data after reload,
  the Ladle story build, and page overflow checks at 1440/768/390/320px. Browser visual review covered
  English light desktop, Persian dark phone, and tablet layouts. Native
  platforms, the full 1,000-seed/all-domain simulator, authenticated network integrations, accessibility axe
  checks and installer distribution are unverified.

## Session log

### 2026-10-13 — Local workspace continuity fixes
- Continued the original completion request after the approved sync checkpoint,
  on a separate local branch for reviewable scope.
- Added independent session drafts with stable IDs, explicit keep/discard,
  before-unload protection, opening/closing focus and textarea labels. Editor
  writes only edited fields; late saves rebase/ack their own submitted fields and
  cannot erase a newer draft or close another editor.
- Kept running/paused Focus mounted across module navigation; added stable
  session IDs, pending-finish protection and finite integer-minute validation.
  Reload recovery remains pending; localized notices state that limitation.
- Made capture reachable on every screen, Cmd/Ctrl-K focus in the current view,
  success feedback and stable pending retries. A completed capture does not clear
  input typed during IO. Today keeps undated backlog opt-in; priorities are named.
- Added six UI logic tests and eight Playwright cases across en/fa/light/dark.
  Validation: pnpm check (124 unit tests), production build and 28 Playwright
  tests; reviewed desktop English light, tablet dark and 320px Persian dark
  screenshots, with no overflow. No native or assistive-technology claim is made.
- Browser QA caught restored textarea label lookup including its initial text;
  explicit localized labels fixed the cause. Save-after-navigation tests then
  verified that newer input and background fields survive acknowledgments.
- Publication: terminal Git lacks credentials; automatic review rejected remote
  branch creation. Read checks established byte-identical research bases and
  missing target refs. Exact publication authorization is required; no remote
  changes or PRs were made and no workaround bypassed the rejection.
- Remaining: native/forge validation, product-connected sync and maintenance,
  reload recovery, mobile navigation/status, routing/search/planner depth,
  import/restore, remaining modules and release packaging. No phase is complete.


### 2026-10-13 — Approved protocol and encrypted record sync foundations
- Recorded the owner's approval as ADR-016 and replaced the unsafe maintenance
  sketch in SYNC/SECURITY/ARCHITECTURE. No source purge or key rotation occurred;
  maintenance remains unavailable pending the accepted protocol's full tests.
- Implemented strict authenticated vault v2 controls, canonical header digest,
  active/frozen/staging/redirect receipts, safe rewrap and new sync-vault helpers.
  Added independent digest-vector, tamper, control-swap, key, metadata and state
  tests. Legacy v1 remains readable, but ordinary sync refuses v1 writes.
- Added SQLite migration 2 with a creation/ever-synced ledger and retained
  ciphertext variants. Pulls merge in transactions, receive HLCs and roll back on
  IO failure. Acknowledgments clear only captured HLCs; resolved ciphertext stays
  exportable. Clean clock/ancestry regressions are preserved as problems.
- Implemented record sync on existing v2 vaults: locks, pinned Merkle traversal,
  bounded batches/retries, rate handling, state/generation guards and unknown /
  rejected record preservation. Lock during IO aborts before later crypto use.
- Added GitHub REST writes/GraphQL batches, experimental GitLab keyset/raw/file
  guard adapter, platform HTTPS allowlist, encrypted web-secret codec/IndexedDB
  adapter and Web Locks adapter. These APIs are not wired into the product UI.
- Fake-forge tests cover encrypted transfer, merge/delete, lost responses, CAS,
  local edits during push, corrupt/relocated/missing records, schema preservation,
  IO rollback, replay and disposal races. Short simulator passed three distinct
  seeds × five replicas × 1,000 operations, retaining every observed original
  text version. Added opt-in 1,000-seed sharded workflow; that full run is unverified.
- Added dedicated real-forge race contracts and setup documentation. No test
  tokens/repos/passphrases were supplied, so both opt-in tests were not run.
  GitLab writes remain gated. Node mocks/contracts do not establish browser CORS.
- Validation: pnpm check, production web build and 20 Playwright tests passed;
  a browser test checks IndexedDB byte persistence across reload and malformed
  stored-value rejection. No UI runtime changed; the UI repository test double
  was updated for the new sync-store interface. Native tooling remains unavailable.
- Surprises: a naive fake tree rebuild was costly at hundreds of records; changed
  it to grouped traversal with immutable byte sharing/hash reuse. Scoped pnpm
  dependency installation and local Playwright server binding needed sandbox
  escalation; locked dependencies were restored without changing their versions.
- Remaining: fresh-repo initialization/onboarding, durable pins, attachment sync,
  maintenance orchestration/recovery UI, real-forge/CORS/native spikes and the
  full unchecked roadmap. Only the interface/fake-forge task is marked complete.


### 2026-10-13 — Maintenance and offline recovery protocol draft
- Reviewed the roadmap, domain/crypto implementation and sync/security specs
  after the request to complete the project. The owner explicitly chose to
  specify and review safe recovery before further implementation.
- Added SYNC-MAINTENANCE-PROPOSAL.md with authenticated write fencing, complete
  snapshot verification, independent-key rotation, returning-device recovery,
  crash/abort transitions, retention rules and required tests.
- Checked current official GitHub/GitLab API documentation. Forced GitHub ref
  updates expose no expected-head argument; GitLab file concurrency is not a
  documented whole-branch lease. A shared gate is proposed, but remains subject
  to a real-forge CAS/CORS spike. No authenticated remote experiments were run.
- No runtime, UI, dependency or accepted data format changed. No maintenance was
  executed and no engineering milestone was marked complete. ADR/spec updates
  are explicitly deferred until owner acceptance; draft links identify its
  pending status.
- Validation: `pnpm check` passed (lint/format plus cached typechecks and 86 unit
  tests). `git diff --check` passed. No UI changed, so Playwright was not rerun.
  This validates the unchanged code baseline, not the proposed protocol.
- Publication: local Conventional Commit on `codex/sync-recovery-protocol`;
  push failed with DNS resolution failure, and the browser fallback also could
  not reach GitHub. No remote branch or PR was created.
- Remaining: review the three choices in proposal §12, then implementation and
  the full unchecked roadmap. Native tooling/test-token blockers are unchanged.

### 2026-10-13 — UI/UX audit and feature research
- Audited source/specs and the running local app in the internal browser with
  synthetic data: English light desktop, Persian dark phone and English dark
  tablet. Reproduced draft loss, focus reset, undated Today behavior and generic
  priority validation; inspected onboarding, Planner and recovery controls.
- Added UX-RESEARCH.md: 18 ranked findings, 24 feature opportunities mapped to
  milestones, comparator patterns from Things/Todoist/Obsidian/Actual/Monica,
  WCAG guidance, delivery sequence and formative user-research/acceptance tasks.
- Updated DESIGN with planned interaction requirements and corrected current
  token values/accessibility-test wording; added actionable ROADMAP follow-ups
  and a research-only completion checkbox; linked research from README.
- No app code, dependency, data format, sync protocol or architectural choice
  changed. F23/F24 remain candidates requiring separate design. No new ADR is
  needed for this documentation-only prioritization.
- Validation: `pnpm check` passed using cached repository pnpm 10.28.0; existing
  typecheck/unit tasks used Turbo cache. Browser inspection is an expert audit,
  not participant research or native/assistive-technology validation. No UI code
  changed, so the existing e2e suite was reviewed rather than rerun.
- Publication uses the explicitly authorized signed-in GitHub browser workflow.
  Remaining work: implement unchecked tasks and conduct the proposed formative
  research; native tooling and forge test-token blockers are unchanged.

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
