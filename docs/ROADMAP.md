# Roadmap

Work is split into **phases → milestones (P<phase>.<n>) → tasks**.

**How to work through it:**

- Take the **first unchecked milestone whose dependencies are done**.
- Check boxes in the same PR that completes the work.
- Record progress in [STATUS.md](STATUS.md).
- Each milestone lists **acceptance criteria (AC)**. A milestone is done only
  when every AC holds and CI is green.

**Phase-wide definition of done:**

- Works on web, desktop and Android.
- Strings exist in en and fa.
- Works in light and dark, and in LTR and RTL.
- Core logic has unit tests.
- No new lint errors.

---

## Research and product planning

- [x] **R2026-10-13:** Expert UI/UX audit, source review, internal-browser
  walkthrough and primary-source feature research; documented findings,
  priorities, dependencies and acceptance gates in
  [UX-RESEARCH.md](UX-RESEARCH.md).

This checkbox completes research only. It does not complete any implementation
milestone. The first unchecked engineering milestone remains **P0.2**. The audit
recommends continuity/recovery and the daily planning loop before adding new
modules; follow-up tasks below belong to their existing milestones. Candidate
features F23/F24 require separate schema/merge design before acceptance.

- [x] **R2026-10-13 maintenance draft:** Specify safe maintenance/offline recovery
  for owner review in [SYNC-MAINTENANCE-PROPOSAL.md](SYNC-MAINTENANCE-PROPOSAL.md).
- [x] Owner approval of repository migration, vault v2/write gate and indefinite
  tombstone/text retention (ADR-016, 2026-10-13). Runtime maintenance and
  P0.6/P10.4 acceptance remain outstanding.

## Phase 0 — Foundations

### P0.1 Monorepo & tooling
- [x] pnpm workspace, Turborepo, and the package skeletons from ARCHITECTURE.md §3
  (desktop and mobile are placeholders until P0.7)
- [x] TS strict base config, ESLint and Prettier configs, the `no-physical-direction` lint rule
  (plus the `lm-check-deps` dependency-direction check)
- [x] Vitest workspace, a Playwright scaffold, and Ladle
- [x] `.github/workflows/ci.yml` (lint, typecheck, test, build, Playwright smoke test)
- [x] `.claude/` SessionStart hook that runs `pnpm i` so cloud agents can run tests

**AC:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passes on a
clean clone and in CI.

### P0.2 Spikes (throwaway code under `spikes/`; record results in DECISIONS.md)
- [ ] **GitHub API from the browser:** CORS for REST and GraphQL with a
  fine-grained PAT; GraphQL batch blob read of 100 text blobs;
  tree → commit → ref CAS with `force:false`, and a 422 on a race
- [ ] **GitLab API from the browser:** CORS on gitlab.com; tree pagination
  returning SHAs; the commits API with `last_commit_id`, confirming it rejects
  stale updates; archive download CORS
- [ ] **sqlite-wasm OPFS** in a worker: performance with 50k rows; FTS5
  available
- [ ] **Tauri 2:** sql plugin, keyring crate and http plugin on macOS and
  Windows
- [ ] **Capacitor:** sqlite, secure storage and native HTTP on Android
- [ ] **libsodium-wrappers-sumo:** Argon2id timing on a mid-range Android phone
  (pick memlimit)

**AC:** Each spike has a written result. Any design change is recorded as an
ADR and reflected in SYNC.md.

### P0.3 Core primitives (`packages/core`)
- [x] ULID, HLC (with tests for monotonicity and remote receive), fractional
  indexing
- [ ] Envelope + zod entity schemas for **all** entities in DATA-MODEL.md, with
  schema versions and the upgrader framework
- [ ] The merge function (SYNC.md §6) with property tests for commutativity,
  idempotence and convergence
- [ ] Recurrence engine (Gregorian and Jalali, `fixed` and `afterCompletion`
  modes)

**AC:** 100% branch coverage on merge, HLC and recurrence.

### P0.4 Crypto (`packages/crypto`)
- [x] KDF, AEAD, keyed hash, sub-key derivation, recovery key encode/decode
- [x] `lm.json` create, unlock and rewrap
- [x] Record and blob codecs with associated-data binding

**AC:** Known-answer tests pass. Tampered, relocated or truncated files are
rejected.

### P0.5 Local DB (`packages/db`)
- [ ] `SqlDriver` interface + web, Tauri and Capacitor drivers
- [ ] Migrations runner; tables for all entities; sync bookkeeping tables
- [ ] Repository API (CRUD that stamps the HLC and writes the change log),
  live queries, FTS5 search
- [ ] Encrypted attachment store
- [ ] Recovery primitives for safe restore and multi-step conversion: specify
  validation, rollback/resume and duplicate prevention before implementation
  (audit U03/U11; coordinate P1.1 and P9.1)

**AC:** The same repository test suite passes against the web driver in CI;
desktop and mobile drivers are checked manually.

### P0.6 Sync engine (`packages/sync`)
- [x] `SyncTransport` interface + fake forge
- [ ] Sync cycle (SYNC.md §5), Merkle diff, batching, backoff, rate-limit
  tracking, lock
  - [x] Existing-v2-vault record cycle, transactional SQLite pull/ack, Merkle
    traversal, bounded batches/retries/rate handling and local/Web Locks APIs
  - [ ] Product scheduling/onboarding, attachment sync and durable vault pins
- [ ] GitHub transport; GitLab transport
  - [x] Implemented API adapters and mocked contract branches
  - [ ] Authenticated real-forge/CORS verification; GitLab writes remain gated
- [ ] **Convergence simulator:** 5 devices × 1,000 random operations, random
  sync order, must reach identical state. Runs in CI (short) and nightly
  (long).
- [ ] Opt-in contract tests against real repos (`LM_TEST_GITHUB_*`,
  `LM_TEST_GITLAB_*` env vars)
  - [x] Dedicated-repo atomic-gate race tests and environment documentation
  - [ ] Actual execution with supplied test vaults/tokens and browser CORS tests

**AC:** The simulator passes 1,000 seeds. A real two-device sync works on
GitHub and on GitLab.

### P0.7 App shells & onboarding
- [ ] `packages/platform` interfaces + implementations (sql, http, secrets,
  notifications, files, audio, deep links)
- [ ] `apps/web`, `apps/desktop` and `apps/mobile` boot the same UI
- [ ] Design tokens, theme switcher (system/light/dark), fonts, base
  components, app layout (sidebar / bottom tabs)
- [ ] i18n (en/fa), RTL switching, calendar-system and digits settings
- [ ] Onboarding wizard (SYNC.md §8): local-only, create a new repo, or join an
  existing repo; Settings → Sync page; sync status pill

- [ ] Grouped desktop navigation, tablet overlay and five mobile tabs/More;
  capture and storage status remain reachable; routable views/details support
  Back and refresh (U04/U16)
- [ ] Editor draft/discard policy, field errors, focus restoration and distinct
  loading/first-use/no-results/unavailable states (U01/U09/U12)
- [ ] Calendar-aware date entry independent of language/digits (U10)
- [ ] Accessibility verification: axe plus manual keyboard/screen-reader,
  focus, contrast, 320px reflow and 44px touch targets in en/fa and both themes

**AC:** On a fresh install, a user can connect a GitHub or GitLab repo. A
second device joins with the passphrase and both stay in sync.

---

## Phase 1 — Core planning
### P1.1 Inbox & quick capture
- [ ] Inbox list, capture field, ⌘K quick add, desktop global hotkey, Android
  share target and home-screen widget
- [ ] Process inbox: convert an item into a task, note, event or person
  interaction
- [ ] Destination preview and atomic or recoverable Inbox conversion; retry
  cannot lose a source item or create duplicates (U11, F08)
- [ ] Persistent capture entry point from every screen (F03)
### P1.2 Areas, projects, tasks
- [ ] Area management; project list and Kanban
- [ ] Task list views: Today, Upcoming, By project, By area, Filters
- [ ] Subtasks, priorities, due dates, tags, recurrence UI (Jalali-aware),
  bulk edit
- [ ] Connected task/project/area detail views with estimates and named
  priorities; active/completed separation (U07/U09)
- [ ] Today separates overdue/due/scheduled commitments from optional undated
  backlog and lets users choose a small priority list (U05, F05)
### P1.3 Calendar & planner
- [ ] Local events with recurrence; day and week timeline; month view
- [ ] Planner combining events, scheduled and due tasks, habits, bills
  (hooks are filled in as later modules land)
- [ ] **Time-blocking:** drag a task onto the timeline to make a TimeBlock;
  resize; keyboard alternative
- [ ] Accessible agenda alternative, overlap feedback and derived daily
  capacity from estimates/blocks; scheduling never silently changes deadlines
  (U06, F07)
### P1.4 Notifications
- [ ] Reminder scheduler per platform, quiet hours, per-device categories,
  daily digest, snooze

**AC:** You can plan a full day with tasks, events and blocks, and reminders
fire on desktop and Android.

## Phase 2 — People & knowledge
### P2.1 People CRM
- [ ] Person list (search, circles, tags) and detail page with timeline
- [ ] Interactions (quick log, multiple people, follow-up → task),
  relationships, important dates (calendar-aware), gift ideas
- [ ] Cadence nudges ("haven't talked in a while"); birthday reminders
### P2.2 Notes
- [ ] CodeMirror Markdown editor, `[[wikilinks]]` with autocomplete,
  `@person` mentions, `#tags`
- [ ] Backlinks panel, unlinked mentions, full-text search
- [ ] Local global search/command palette with contextual result opening,
  keyboard navigation and explicit scope; use repository FTS (U08, F04)
- [ ] Full reading details for long notes, safe Markdown and contextual links
  to projects/people (U14, F12)
### P2.3 Journal
- [ ] Daily entry, prompts (daily/weekly/random), mood, calendar view

## Phase 3 — Habits, routines & focus
- [ ] **P3.1** Habits: flexible schedules, streaks with skip tokens, heatmap,
  gentle reminders
- [ ] **P3.2** Morning and evening routines: checklist runner, links to habits
- [ ] **P3.3** Weekly review: guided flow (done / slipped / next), stats
  snapshot, creates tasks
- [ ] **P3.4** Focus timer tied to a task (Pomodoro presets, breaks,
  interruptions); time entries; "where did my hours go" report by area,
  project and task

- [ ] **P3.4 follow-up:** Active focus session persists across module navigation; specify reload
  recovery, pauses and duplicate-Finish prevention (U02, F01)
- [ ] **P3.1 follow-up:** Habit log correction and schedule-aware Today actions (U13, F11)

## Phase 4 — Money
- [ ] **P4.1** Accounts, categories, transactions (multi-currency, transfers),
  quick entry
- [ ] **P4.2** Monthly budgets in the user's calendar system, with threshold
  alerts
- [ ] **P4.3** Bills and subscriptions with due reminders; "mark paid" creates
  the transaction
- [ ] **P4.4** Savings goals; FX rates (manual plus an optional fetch)

- [ ] **P4.1 follow-up:** Human-readable MoneyInput with exact integer conversion, currency/sign
  guidance, field errors and account balance feedback (U09/U15, F14)

## Phase 5 — Health & learning
- [ ] **P5.1** Health logs: sleep, water, exercise, mood, energy, weight,
  custom metrics. One-tap logging.
- [ ] **P5.2** Daily feature table + correlation engine (ARCHITECTURE §10)
  with tests on synthetic data
- [ ] **P5.3** Reading and course tracker
- [ ] **P5.4** Flashcards with FSRS: decks, review session, stats; cards
  created from notes

## Phase 6 — Life admin & goals
- [ ] **P6.1** Document vault: encrypted files, camera capture on mobile,
  expiry reminders
- [ ] **P6.2** Shopping lists (fast check-off, reorder, reuse items)
- [ ] **P6.3** Assets and home maintenance plans that generate tasks
- [ ] **P6.4** Goals and milestones with automatic progress; goal page with
  linked tasks

## Phase 7 — External calendars
- [ ] **P7.1** ICS subscription and import
- [ ] **P7.2** Google Calendar read
- [ ] **P7.3** CalDAV/iCloud read
- [ ] **P7.4** Write time blocks back to a chosen external calendar

## Phase 8 — Smart layer
- [ ] **P8.1** `packages/ai`: provider interface, Claude and Ollama, settings,
  privacy toggles, send preview
- [ ] **P8.2** "Plan my week": context builder, structured output, validator,
  proposal overlay, accept
- [ ] **P8.3** Inbox triage, natural-language capture, review and journal
  assistance, flashcard generation
- [ ] **P8.4** Voice capture and the transcription queue (whisper.cpp sidecar,
  configurable endpoint, deferred to desktop)
- [ ] **P8.5** Weekly insights dashboard and life-areas wheel (deterministic),
  plus an optional AI narrative

## Phase 9 — Imports & exports
- [ ] **P9.1** Full export to plain JSON and Markdown, as a zip (never locked
  in)
- [ ] **P9.2** Importers: Todoist, Notion (Markdown/CSV export), Obsidian
  vault, vCard, bank CSV (column mapper), Anki `.apkg`

- [ ] Validated restore preview into a fresh/existing workspace; cancel has no
  writes, apply is recoverable, unknown records and relationships are preserved
  (P9.1, U03, F02)
- [ ] Import mapping, duplicates preview and safe retry before accepting data
  (P9.2, F21)
- [ ] **P9.1 follow-up:** Recoverable Trash UI beyond the latest undo toast; no new purge or
  compaction behavior without the sync protocol (F02)

## Phase 10 — Release
- [ ] **P10.1** Release workflow, updater signing, Android release signing
  (RELEASE.md)
- [ ] **P10.2** In-app update check on Android; Tauri updater on desktop
- [ ] **P10.3** User guide (`docs/user/`): install, create repo and token,
  unsigned-app first launch, backups
- [ ] **P10.4** Repo compaction, passphrase change and key-rotation flows
- [ ] **P10.5** Optional SQLCipher for local DB encryption

## Later / backlog
- iOS build (Capacitor). Generic git transport (Gitea/SSH). Settings sync of
  secrets. Shared lists with other users. Wear OS and tablet layouts. Apple
  Health and Health Connect import.

## Researched extensions — not yet accepted schemas

- [ ] **F13:** Bundled localized note/journal/review templates, then editable
  local templates after persistence/version rules are specified (P2/P3).
- [ ] **F19:** Device-local module visibility/favorites and saved task views;
  preserve hidden data/search; specify Settings before syncing preferences.
- [ ] **F20:** Deterministic en/fa quick-capture parsing with preview and explicit
  ambiguity handling, including Jalali dates and Persian digits (P1.1).
- [ ] **F23 candidate:** Waiting-for/task dependencies; validate demand and
  specify status, cycle and merge semantics before changing Task.
- [ ] **F24 candidate:** Finance reconciliation and repeat-entry rules; validate
  workflow and specify audit/undo/duplicate metadata before changing records.

Detailed value, effort, confidence and prerequisites for **F01–F24** are in
[UX-RESEARCH.md §4](UX-RESEARCH.md#4-potential-features-and-prioritization).
These extensions introduce no server, paid service or automatic AI action.

## Implementation note — 2026-10-13

A local web workspace now provides minimal capture, tasks/projects, events, daily
boolean habits, focus sessions, accounts/transactions, health/journal logs, notes,
people, resources, assets and manual goals. These are partial feature slices,
not completion of their respective milestones. Gregorian date entry, Jalali
display, en/fa, themes, SQLite OPFS persistence, tombstones/undo and JSON export
work. Core schemas omit Settings pending P0.7. Pairwise and five-replica text
merge tests exist; the full sync convergence simulator and required coverage
acceptance remain outstanding. P0.2 external/native spikes require separate
validation. Crypto codecs are implemented but the complete primitive vector
suite and mobile Argon2id timing are not yet verified.
