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
- [x] **sqlite-wasm OPFS** in a worker: performance with 50k rows; FTS5
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
- [x] Envelope + zod entity schemas for **all** entities in DATA-MODEL.md, with
  schema versions and the upgrader framework
- [x] The merge function (SYNC.md §6) with property tests for commutativity,
  idempotence and convergence
- [x] Recurrence engine (Gregorian and Jalali, `fixed` and `afterCompletion`
  modes)

**AC:** 100% branch coverage on merge, HLC and recurrence.

### P0.4 Crypto (`packages/crypto`)
- [x] KDF, AEAD, keyed hash, sub-key derivation, recovery key encode/decode
- [x] `lm.json` create, unlock and rewrap
- [x] Record and blob codecs with associated-data binding

**AC:** Known-answer tests pass. Tampered, relocated or truncated files are
rejected.

### P0.5 Local DB (`packages/db`)
- [x] `SqlDriver` interface + web, Tauri and Capacitor drivers
- [x] Migrations runner; tables for all entities; sync bookkeeping tables
- [x] Repository API (CRUD that stamps the HLC and writes the change log),
  live queries, FTS5 search
- [x] Encrypted attachment store

**AC:** The same repository test suite passes against the web driver in CI;
desktop and mobile drivers are checked manually.

### P0.6 Sync engine (`packages/sync`)
- [x] `SyncTransport` interface + fake forge
- [x] Sync cycle (SYNC.md §5), Merkle diff, batching, backoff, rate-limit
  tracking, lock
- [ ] GitHub transport; GitLab transport
- [x] **Convergence simulator:** 5 devices × 1,000 random operations, random
  sync order, must reach identical state. Runs in CI (short) and nightly
  (long).
- [ ] Opt-in contract tests against real repos (`LM_TEST_GITHUB_*`,
  `LM_TEST_GITLAB_*` env vars)

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

**AC:** On a fresh install, a user can connect a GitHub or GitLab repo. A
second device joins with the passphrase and both stay in sync.

---

## Phase 1 — Core planning
### P1.1 Inbox & quick capture
- [ ] Inbox list, capture field, ⌘K quick add, desktop global hotkey, Android
  share target and home-screen widget
- [ ] Process inbox: convert an item into a task, note, event or person
  interaction
### P1.2 Areas, projects, tasks
- [ ] Area management; project list and Kanban
- [ ] Task list views: Today, Upcoming, By project, By area, Filters
- [ ] Subtasks, priorities, due dates, tags, recurrence UI (Jalali-aware),
  bulk edit
### P1.3 Calendar & planner
- [ ] Local events with recurrence; day and week timeline; month view
- [ ] Planner combining events, scheduled and due tasks, habits, bills
  (hooks are filled in as later modules land)
- [ ] **Time-blocking:** drag a task onto the timeline to make a TimeBlock;
  resize; keyboard alternative
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

## Phase 4 — Money
- [ ] **P4.1** Accounts, categories, transactions (multi-currency, transfers),
  quick entry
- [ ] **P4.2** Monthly budgets in the user's calendar system, with threshold
  alerts
- [ ] **P4.3** Bills and subscriptions with due reminders; "mark paid" creates
  the transaction
- [ ] **P4.4** Savings goals; FX rates (manual plus an optional fetch)

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
