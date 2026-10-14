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

Research checkboxes complete research only. They do not complete implementation
milestones. The owner requested a fresh, broader product direction on
2026-10-14; [PRODUCT-RESEARCH.md](PRODUCT-RESEARCH.md) now defines module depth,
connected journeys, evidence and data-design gates. The earlier audit remains
historical evidence. Candidate schemas still require design before code.

- [x] **R2026-10-14:** Fresh primary-source research across 19 product references,
  current browser/source diagnosis, module experience contracts, motion direction
  and a staged expansion plan. No UI or feature implementation is included.

### Current delivery order — owner-directed product expansion

The first unchecked foundation milestone remains P0.2. The owner's product
brief prioritizes the local web design/depth track below alongside foundation
validation. Do not require unavailable forge tokens/native tooling to start
local prototype work. Do not mark platform-wide milestones complete from web
work alone. One scoped vertical workflow per branch/PR remains the default.

| Wave | Roadmap scope | Dependency / completion boundary |
|---|---|---|
| W1 | P0.8 design system/prototypes; P0.9 shell/search/recovery | Existing local web foundations; resolve G01 before draft/preferences persistence. |
| W2 | P2.1 People depth showcase; P1.1 processing; P1.2 Tasks/Projects; Today | W1 usable shell, current Note/Link/Interaction/Task APIs; recoverable compound writes. |
| W3 | P1.3 local Planner; P3 habits/routines/focus | Connected tasks, recurrence/time and recovery contracts. |
| W4 | P2.2/P2.3 writing; P5.3/P5.4 learning | Links/search/Markdown/review services; attachments for media only. |
| W5 | P4 Money; P5 wellbeing; P6 Admin/Goals; P3.3/P8.5 review/insights | Independent module releases; required domain/data gates before each. |
| W6 | P7/P8/P9/native entry points | Validated recovery, adapters and explicit integration/privacy configuration. |

**Next product slice:** P0.8 compare two realistic visual prototypes of Inbox,
Tasks, Projects, Planner and People; establish module-specific layouts and
motion. Then build a local People profile with multiple linked notes,
conversation history and follow-up tasks. §4 of PRODUCT-RESEARCH supplies a
workflow gate for every module; §5 supplies connected-journey gates.

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
  - [x] Web session drafts, keep/discard, focus restoration, edited-field writes
    and conditional save acknowledgments; named task priorities
  - [ ] Durable reload recovery, other field errors and remaining state inventory
- [ ] Calendar-aware date entry independent of language/digits (U10)
- [ ] Accessibility verification: axe plus manual keyboard/screen-reader,
  focus, contrast, 320px reflow and 44px touch targets in en/fa and both themes

**AC:** On a fresh install, a user can connect a GitHub or GitLab repo. A
second device joins with the passphrase and both stay in sync.

---


### P0.8 Product design system and dedicated module prototypes
- [ ] Compare warm editorial and crisp compact directions using realistic
  synthetic data; select a coherent shell, typography, density and surface system
- [ ] Prototype distinct Inbox processing, task actions, project workspace,
  planner timeline and People profile/notes/timeline layouts (DESIGN §11)
- [ ] Define semantic surface/status/area tokens and shared motion tokens;
  implement completion, expansion, sheet, reordering and status choreography
  with system reduced-motion equivalents (DESIGN §12)
- [ ] Add shared component stories and state inventory; review phone/tablet/
  desktop, en/fa and light/dark before rolling the language into modules
- [ ] Review actual motion, interruption, readability, contrast, keyboard/focus
  and first-use/populated/error states; record visual/usability findings

**Dependencies:** current local web shell/repository. No new network integration
or schema required for synthetic prototypes. New dependencies require the
existing stack approval rules.
**AC:** Five recognizable module prototypes with working primary interactions,
realistic fixtures and reduced-motion review; headings/colors alone do not
provide differentiation. Design review evidence is recorded. No module is
called implemented merely because its prototype exists.

### P0.9 Shared workspace navigation, discovery and continuity
- [ ] Grouped navigation/favorites, mobile tabs/More and tablet overlay;
  contextual verbs and compact global capture, with storage status on phone
- [ ] Routable module/details and Back/refresh behavior; preserve view filters,
  selection, scroll and opener focus across contextual navigation
- [ ] Local global search/command palette with snippets, type/context, keyboard
  results and separate per-view filters; open linked entities in context
- [ ] Specify G01, then durable draft and interrupted-focus recovery with limits,
  versioning and explicit resume/discard; saved records and drafts stay distinct
- [ ] Module visibility and comfortable/compact density after preference design;
  hidden data remains searchable and exportable
- [ ] Contextual empty/loading/error/success states, localized shortcut discovery
  and representative formative usability sessions (PRODUCT-RESEARCH §6)

**Dependencies:** P0.8 selected design language; repository FTS/link queries;
G01 before new preference/draft persistence. Deliver local web slices separately
from P0.7 native/onboarding acceptance.
**AC:** Capture → search → detail → Back works on keyboard and phone; no lost
input on navigation/reload or fabricated save success. All hidden modules are
reachable through More/search. Existing continuity tests remain green.

## Phase 1 — Core planning
### P1.1 Inbox & quick capture
- [ ] Inbox list, capture field, ⌘K quick add, desktop global hotkey, Android
  share target and home-screen widget
- [ ] Process inbox: convert an item into a task, note, event or person
  interaction
- [ ] Destination preview and atomic or recoverable Inbox conversion; retry
  cannot lose a source item or create duplicates (U11, F08)
- [ ] Persistent capture entry point from every screen (F03)
  - [x] Shared web UI capture on every screen; Cmd/Ctrl-K focus, success
    announcement and pending-input/duplicate-submit protection
  - [ ] Native shell entry points and platform verification
- [ ] Dedicated processing queue with selected-item/destination preview,
  keyboard next-item flow, source context and recoverable archive/defer semantics
- [ ] Multi-line capture split preview, bulk processing and deterministic en/fa
  date parsing; specify G02 before new processing states/provenance

**Inbox AC (M02):** Capture from People, process into a project task and retry a
failed conversion; one destination exists and the source remains recoverable.

### P1.2 Areas, projects, tasks
- [ ] Area management; project list and Kanban
- [ ] Task list views: Today, Upcoming, By project, By area, Filters
- [ ] Subtasks, priorities, due dates, tags, recurrence UI (Jalali-aware),
  bulk edit
- [ ] Connected task/project/area detail views with estimates and named
  priorities; active/completed separation (U07/U09)
- [ ] Today separates overdue/due/scheduled commitments from optional undated
  backlog and lets users choose a small priority list (U05, F05)
- [ ] Dedicated task rows/details with inline add, expandable metadata,
  Anytime/Upcoming views, estimates, completion history and reversible bulk actions
- [ ] Project portfolio and workspace: brief, next actions, task list/board,
  linked notes/resources, area context and transparent derived completion
- [ ] Area detail with ongoing responsibilities and active projects; review
  prompts for projects without next actions; active/on-hold/archive workflows
- [ ] Visual saved filters/templates; specify G03 project sections/milestones/
  target dates and G04 waiting/dependency/cycle semantics before those extensions

**Tasks/Projects AC (M03/M04):** Create project + note + parent/subtask, schedule
work and complete from Today; views agree and project progress excludes cancelled
work. Empty projects show no tasks rather than fake completion.

### P1.3 Calendar & planner
- [ ] Local events with recurrence; day and week timeline; month view
- [ ] Planner combining events, scheduled and due tasks, habits, bills
  (hooks are filled in as later modules land)
- [ ] **Time-blocking:** drag a task onto the timeline to make a TimeBlock;
  resize; keyboard alternative
- [ ] Accessible agenda alternative, overlap feedback and derived daily
  capacity from estimates/blocks; scheduling never silently changes deadlines
  (U06, F07)
- [ ] Unscheduled-task tray, all-day lane, source visibility, working-hours/
  buffer controls and planned workload versus capacity with unknown estimates
- [ ] Recurring-event occurrence/series edit policy and undo; explicit timezone,
  DST and calendar-boundary validation; honest stale external-cache status
- [ ] Today agenda/priorities/due actions and guided plan/shutdown flow; priority
  selection persistence must be specified before adding a new saved field

**Local planner AC (M01/M05):** Plan three tasks, schedule/resize one by keyboard,
see overlap feedback and undo without changing its deadline. Due habits and
source-linked follow-ups surface as their implementations land.

### P1.4 Notifications
- [ ] Reminder scheduler per platform, quiet hours, per-device categories,
  daily digest, snooze

**AC:** You can plan a full day with tasks, events and blocks, and reminders
fire on desktop and Android.

## Phase 2 — People & knowledge
### P2.1 People CRM — complete relationship workflow
- [ ] Dedicated searchable directory with circle/tag/reconnect filters and
  person profiles (Overview, Timeline, Notes, Follow-ups)
- [ ] Rich optional contact methods, avatar, aliases, company/role/how-we-met,
  personal context and custom fields; progressive disclosure at creation
- [ ] Multiple independently editable long-form notes per person via Note +
  Link; Person.notes remains overview context; full reading and content search
- [ ] Dated interaction log, multiple people, summary/conversation notes,
  history correction and source-linked follow-up tasks
- [ ] Important dates in either calendar, birthdays/anniversaries, relationships
  between people and gift ideas/given history
- [ ] Per-person cadence and gentle reconnect queue; specify G05 snooze/reset/
  partial-date semantics; writing a note alone does not reset last contact
- [ ] vCard import and duplicate resolution preview; specify reference rewrite,
  undo/merge preservation before applying duplicate merges (P9.2, G05)

**Dependencies:** usable W1 shell, current Note/Link/Interaction/Task APIs;
recoverable compound writes. G05 gates advanced extensions, not basic notes.
**AC (M06):** From a profile add two separate notes, log a two-person call and
create a follow-up. Find notes by content and history from either profile;
complete the task in Today and see its state in People. Important-date/cadence
behavior is deterministic and calendar-aware. Profile workflows pass both
themes, directions, keyboard and phone review. No automatic contact scraping
or enterprise sales pipeline is included.

### P2.2 Notes
- [ ] CodeMirror Markdown editor, `[[wikilinks]]` with autocomplete,
  `@person` mentions, `#tags`
- [ ] Backlinks panel, unlinked mentions, full-text search
- [ ] Local global search/command palette with contextual result opening,
  keyboard navigation and explicit scope; use repository FTS (U08, F04)
- [ ] Full reading details for long notes, safe Markdown and contextual links
  to projects/people (U14, F12)
- [ ] Dedicated library/editor/reader with comfortable prose measure,
  folders/tags/pins, contextual backlinks and navigable related entities
- [ ] Confirm ambiguous person/unlinked mentions; stable identity across rename;
  bundled templates, revision/conflict reading and attachment IO states

**Notes AC (M07):** One note links a person and project; navigate from either
and return without losing selection, scroll or draft. Markdown stays safe.

### P2.3 Journal
- [ ] Daily entry, prompts (daily/weekly/random), mood, calendar view

- [ ] Calendar/chronological browsing, spacious writing, optional mood,
  tag/date search and past-entry resurfacing (On This Day)
- [ ] Templates/reflection collections and media after G07/attachment design;
  specify multiple-entry-per-day behavior before promising it in the UI

**Journal AC (M08):** Write, revisit, correct and retrieve an entry by month/tag;
input survives navigation and missing days use neutral language.

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
  - [x] Web running/paused state across navigation, stable session IDs and
    duplicate-Finish guard
  - [ ] Durable process/reload recovery and native lifecycle verification
- [ ] **P3.1 follow-up:** Habit log correction and schedule-aware Today actions (U13, F11)

- [ ] **P3.1 depth:** Boolean/count/duration inputs, target/unit context,
  schedule-aware period summaries, heatmap and editable history with notes
- [ ] **P3.2 depth:** Sequential routine runner, pause/resume, optional duration,
  linked habit actions and retry-safe log identity
- [ ] **P3.3 depth:** Guided review with linked completed/slipped work, area/time
  summary, reflection and preview/apply for next-week adjustments
- [ ] **P3.4 depth:** Task-linked Pomodoro/free timer, break/interruptions,
  persistent compact controls, manual time correction and area/project/task reports

**AC (M09/M10/M15):** Correct a three-times-per-week habit; resume a routine
without duplicate logs; recover a focus session after reload and finish once;
review planned versus actual time and deliberately accept next-week changes.

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

- [ ] **P4.1 depth:** Account summaries and aligned register with categorization,
  search/filter/bulk actions, transfer pairing and payment history
- [ ] **P4.2/P4.3 depth:** Dedicated budget/bills/subscriptions views, upcoming
  obligations, visible remaining budget and retry-safe “mark paid” flow
- [ ] **P4.4 depth:** Savings progress and spending/cash-flow reports with
  visible currency conversion basis/date and drill-down to transactions
- [ ] **P4.5 planned contract:** G06 for reconciliation/cleared state, split
  transactions, audit corrections and previewable categorization rules; implement
  only after schemas, migrations, preservation and convergence tests are specified

**AC (M11):** Transfer between accounts, categorize an expense, mark a recurring
bill paid and retry; exact balances, budget totals and reminder state agree.
Transfers do not count as spending; mixed currencies require explicit FX.

## Phase 5 — Health & learning
- [ ] **P5.1** Health logs: sleep, water, exercise, mood, energy, weight,
  custom metrics. One-tap logging.
- [ ] **P5.2** Daily feature table + correlation engine (ARCHITECTURE §10)
  with tests on synthetic data
- [ ] **P5.3** Reading and course tracker
- [ ] **P5.4** Flashcards with FSRS: decks, review session, stats; cards
  created from notes

- [ ] **P5.1 depth:** Metric-specific water/sleep/exercise/mood/energy/weight
  entry, units, custom definitions, date-range charts and history correction
- [ ] **P5.2 depth:** Missing-data/coverage display, sample counts and
  explainable correlations with source drill-down; no causal/diagnostic claims
- [ ] **P5.3 depth:** Resource shelf/list/detail, author/URL, progress, rating,
  linked notes and reading history; G07 for excerpts/highlight source locations
- [ ] **P5.4 depth:** Dedicated Again/Hard/Good/Easy review runner, source links,
  due workload, suspension and recall/review statistics

**AC (M12/M13):** Correct sleep across midnight and inspect missing observations;
update book progress, make a source-linked card and review it reproducibly.

## Phase 6 — Life admin & goals
- [ ] **P6.1** Document vault: encrypted files, camera capture on mobile,
  expiry reminders
- [ ] **P6.2** Shopping lists (fast check-off, reorder, reuse items)
- [ ] **P6.3** Assets and home maintenance plans that generate tasks
- [ ] **P6.4** Goals and milestones with automatic progress; goal page with
  linked tasks

- [ ] **P6.1 depth:** Document gallery/list/detail with encrypted attachments,
  search, expiry state, renewals and linked person/asset context
- [ ] **P6.2 depth:** Fast quantity/unit entry, reorder, reuse and completed-item
  handling with keyboard/touch alternatives
- [ ] **P6.3 depth:** Asset dossier, purchase/warranty/documents, maintenance due
  queue and linked task history; G08 before locations/serial/custom asset fields
- [ ] **P6.4 depth:** Goal portfolio/detail with why, milestone path, linked
  projects/tasks and explicit manual/derived progress basis

**AC (M14/M15):** Find an asset warranty, complete due maintenance and trace its
history; reuse a shopping list; complete goal-linked work and explain progress.
File IO failure retains the draft. G08 gates new contribution formulas.

## Phase 7 — External calendars
- [ ] **P7.1** ICS subscription and import
- [ ] **P7.2** Google Calendar read
- [ ] **P7.3** CalDAV/iCloud read
- [ ] **P7.4** Write time blocks back to a chosen external calendar

- [ ] Source/calendar visibility and per-connector unavailable/stale/error
  states; external events do not block local planning or imply successful sync
- [ ] Occurrence edits and write-back preview with target calendar and explicit
  acceptance; connector credentials stay in platform.secrets

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

- [ ] **P8.1–P8.4 UX:** Provider/capability/privacy controls, inspectable send
  preview, editable proposal and accept/discard/retry with source context;
  no automatic saving or background contact ingestion
- [ ] **P8.5 depth:** Drillable weekly task/focus/habit/money/wellbeing views,
  neutral language, coverage/sample count and deterministic summary before AI

**AC (M15/M16):** Reports open underlying records; unconfigured providers expose
honest capability states; proposals write only explicitly accepted changes.

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

## Product expansion acceptance and data gates

All new product tasks above are unchecked. Apply PRODUCT-RESEARCH §4's module
workflow and §5's connected journey; DESIGN §§11–12 add module differentiation,
visual and motion requirements. Existing unit/e2e/convergence requirements still
apply. Record visual review and actual usability evidence; no participant
research has been completed yet.

- [ ] **G01–G08:** Resolve each relevant contract from PRODUCT-RESEARCH §7 in
  a scoped specification/code change before introducing new persisted behavior
- [ ] Cross-module journeys: conversation→follow-up, idea→project→focus,
  resource→note→card, warranty→maintenance and bill→payment→budget
- [ ] Synthetic populated-state fixtures and formative usability sessions;
  measure completion, ease, recovery and capture/search responsiveness locally
- [ ] Export/restore of linked records, unknown-field retention and safe retries
  for every newly accepted schema; preserve complete text/edit history

Research expands the target product but does not authorize speculative schemas,
new hosting, a stack replacement or weakening privacy. Advanced candidates F23/
F24 now have concrete contracts G04/G06 to resolve; their runtime remains pending.

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
