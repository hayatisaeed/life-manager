# Life Manager — Architecture

Status: **approved plan, not yet implemented.** This is the top-level overview.
The detailed specs are:

| Doc | Covers |
|---|---|
| [SYNC.md](SYNC.md) | Sync protocol, repo layout, merge algorithm, GitHub/GitLab transports |
| [SECURITY.md](SECURITY.md) | Threat model, cryptography, key management, secrets handling |
| [DATA-MODEL.md](DATA-MODEL.md) | Every entity and its fields, plus recurrence and invariants |
| [DESIGN.md](DESIGN.md) | Visual design system, theming, layout, RTL, accessibility |
| [TECH-STACK.md](TECH-STACK.md) | Chosen libraries and versions policy |
| [RELEASE.md](RELEASE.md) | Building, signing and distributing installers |
| [DECISIONS.md](DECISIONS.md) | Decision log (ADRs). Read it before changing anything below. |
| [ROADMAP.md](ROADMAP.md) | Phased build plan with acceptance criteria |
| [STATUS.md](STATUS.md) | What is done and what is next. Agents update this every session. |

## 1. Product decisions

| Topic | Decision |
|---|---|
| Audience | Built first for the owner, but **anyone can use it**. Each user connects their own private repo. Nothing is hard-coded to one person, and there is no shared backend. |
| Server | **None, ever.** All logic runs on the device. Django was dropped (ADR-001). |
| Clients | One React + TypeScript codebase. **Tauri 2** for macOS and Windows, **Capacitor** for Android (and iOS later), and a web build (PWA). |
| Sync | A private **GitHub or GitLab** repo (cloud or self-hosted), reached through their **REST/GraphQL APIs** from every platform, the browser included (ADR-003). |
| Sync format | **One encrypted file per record.** End-to-end encrypted, merged at the field level. |
| AI | **Pluggable**: Claude API (the user's key) or a local or LAN model through Ollama. |
| Calendars | Built-in events, plus Google Calendar, CalDAV/iCloud and `.ics` subscriptions. |
| Locale | English and Persian (RTL) UI, Gregorian and **Jalali** calendars, multiple currencies. |
| Voice notes | Record now (encrypted audio), transcribe later. |
| Distribution | **Installers outside the app stores**: `.dmg`, `.msi`/`.exe` and `.apk` on GitHub Releases, with in-app updates. |
| Design | Minimal and modern, with **light, dark and system** themes. |
| Imports | Todoist, Notion, Obsidian, vCard, bank CSV and Anki. |

## 2. High-level shape

```
┌──────────────────────────── each device ──────────────────────────────┐
│ React UI (packages/ui) ── theme · i18n · RTL · Jalali · currency       │
│      │                                                                 │
│ Domain services (packages/core) — pure TS, no platform imports         │
│ tasks · planner · habits · focus · money · health · notes · people …   │
│      │                                                                 │
│ Repository layer (packages/db) ──► SQLite (local source of truth)      │
│      │   change log + per-record sync base                             │
│ Sync engine (packages/sync)                                            │
│   fetch remote changes ─► decrypt ─► 3-way merge ─► apply              │
│   dirty records ─► encrypt ─► atomic commit via forge API              │
│      │                                                                 │
│ Platform adapters (packages/platform): sqlite driver · http · keychain │
│   notifications · audio · files · tray/hotkey · deep links             │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ HTTPS + user's access token
                ┌──────────────▼───────────────┐
                │ user's private GitHub/GitLab │  ← ciphertext only
                └──────────────────────────────┘
```

- The app is **fully usable offline and without sync**. Sync is enabled in
  onboarding or later in Settings.
- The domain core never imports platform code. Anything platform-specific goes
  through an interface in `packages/platform`, which keeps an iOS port cheap.

## 3. Monorepo layout

pnpm workspaces + Turborepo.

```
life-manager/
├─ apps/
│  ├─ web/          Vite + React PWA. Also the UI bundle the other apps load.
│  ├─ desktop/      Tauri 2 (macOS, Windows); src-tauri/ holds the Rust side
│  └─ mobile/       Capacitor (android/ now, ios/ later)
├─ packages/
│  ├─ core/         entities (zod), domain services, recurrence, streaks, budgets,
│  │                FSRS, correlations, HLC, ULID. Pure and deterministic, fully unit-tested.
│  ├─ db/           SQLite schema, migrations, repositories, live queries, FTS5
│  ├─ sync/         sync engine, record codec, merge, GitHub + GitLab transports
│  ├─ crypto/       libsodium wrappers (Argon2id, XChaCha20-Poly1305, BLAKE2b keyed hash)
│  ├─ calendar/     ICS, Google, CalDAV connectors
│  ├─ ai/           provider interface, Claude + Ollama, prompts, tool schemas, validators
│  ├─ importers/    Todoist, Notion, Obsidian, vCard, bank CSV, Anki
│  ├─ i18n/         en/fa catalogs, calendar-system date utils, number/currency formatting
│  ├─ ui/           design tokens, components, shared screens (feature folders)
│  └─ platform/     adapter interfaces + web / tauri / capacitor implementations
├─ docs/
├─ AGENTS.md        instructions for coding agents (CLAUDE.md points here)
└─ CLAUDE.md
```

Dependencies only point downward:
`apps → ui → (core, db, sync, ai, calendar, importers, i18n) → (crypto, platform interfaces)`.
`core` depends on nothing except `zod` and small pure utilities.

## 4. Local storage

- **SQLite everywhere**, behind one `SqlDriver` interface:
  - Web: `@sqlite.org/sqlite-wasm`, with OPFS when available.
  - Desktop: `tauri-plugin-sql`.
  - Mobile: `@capacitor-community/sqlite`.
- Two layers of tables:
  - **One `records` table** holding every entity as JSON, with per-type
    expression indexes on `json_extract(data, …)` for queries (ADR-011).
  - **Sync bookkeeping tables:** `sync_base` (the last-synced plaintext of each
    record), `sync_remote` (the remote path → blob SHA map and tree SHAs) and
    `change_log` (dirty record ids).
- Every entity row carries:
  - `id`: a ULID.
  - `hlc`: when it was last modified.
  - `field_hlc`: a JSON map of per-field HLCs.
  - `deleted_at`: a tombstone.
  - `device_id`.
- Attachments are content-addressed files in the app data directory, encrypted
  at rest with the data key.
- **Live queries:** repositories emit change events, and React hooks
  (`useLiveQuery`) re-run on the tables they touched.
- **Migrations** are numbered SQL files plus optional TS data migrations. The
  synced record JSON carries a `schema` version, and `core` has upgraders for
  older record versions (see DATA-MODEL.md §1).

## 5. Sync (summary — full spec in [SYNC.md](SYNC.md))

- The remote is a git repo, but devices never clone it. They use the forge
  APIs:
  - **GitHub:** REST git-data endpoints for trees, blobs, commits and refs, plus
    GraphQL for batched blob reads.
  - **GitLab:** the repository tree/files API and the commits API with
    multi-file actions.

  Both send CORS headers, so **the same code runs in the browser, Tauri and
  Capacitor**.
- Each record is stored at `r/<shard>/<keyed-hash-of-id>.lmr`, encrypted with
  XChaCha20-Poly1305.
- **Merge** is a 3-way merge per field:
  - The base is the local `sync_base`, "ours" is the local DB and "theirs" is
    the remote.
  - Scalars: the newer HLC wins.
  - Sets: a 3-way set merge.
  - Long text: diff3, keeping both versions when edits overlap.
  - Delete vs. edit: the edit wins.
- **Writes** are one atomic commit per sync cycle, using compare-and-swap on
  the branch head. A rejected write means re-fetch, re-merge and retry. The
  remote history stays linear.
- **Change detection:** walk tree SHAs (a Merkle diff) to find changed shards,
  then batch-fetch only the blobs that changed.

## 6. Security (summary — full spec in [SECURITY.md](SECURITY.md))

- **Keys:**
  - A random **data key** encrypts all data.
  - The data key is wrapped with an Argon2id key derived from the user's
    **passphrase**, and again with a one-time **recovery key**.
  - The key never leaves the device unencrypted.
- **Secrets** (forge token, AI key, calendar OAuth tokens) live in the OS
  keychain. The web build keeps them encrypted in IndexedDB under a key
  derived from the passphrase.
- **What the forge can still learn:** the number of records, their sizes, and
  commit times. It can't learn their types, ids, contents or names.

## 7. Domain (summary — full spec in [DATA-MODEL.md](DATA-MODEL.md))

| Module | Main entities |
|---|---|
| Structure | Area, Tag, Link (generic cross-entity links → backlinks everywhere) |
| Planning | InboxItem, Project, Task (subtasks, recurrence), Goal, Milestone |
| Calendar | Event (local/external), TimeBlock (event linked to a task) |
| Habits | Habit (flexible schedules), HabitLog, Routine, RoutineRun, WeeklyReview |
| Time | FocusSession, TimeEntry |
| Money | Account, Category, Transaction, Budget, Bill, SavingsGoal, FxRate |
| Health | HealthLog (sleep, water, exercise, mood, custom), JournalEntry |
| Learning | Note (Markdown, wikilinks, mentions), Resource (book/course), Deck, Card (FSRS), ReviewLog |
| Life admin | Document (vault + expiry), ShoppingList, ShoppingItem, Asset, MaintenancePlan |
| People | Person, Interaction, Relationship, ImportantDate, GiftIdea |
| AI | PlanProposal, Insight |

**Recurrence** is our own engine. It supports a subset of RFC 5545 RRULE with a
`calendar: 'gregorian' | 'jalali'` field, so rules like "the 15th of every
Jalali month" work.

## 8. Planner and calendars

- The **Planner** is a day/week timeline that merges:
  - Local events and time blocks.
  - The external event cache.
  - Scheduled tasks, plus a sidebar of tasks due without a time.
  - Habits and routines due today, and bills due.
- **Time-blocking:** drag a task onto the timeline (dnd-kit) to create a
  TimeBlock. Its length comes from the task's estimate. Completing the block can
  create a TimeEntry.
- **Connectors** (all device-local, all opt-in):
  - **ICS:** URL subscription or file import.
  - **Google Calendar:** OAuth PKCE. Desktop uses a loopback redirect; mobile
    and web use a redirect URI. A default OAuth client id is shipped and the
    user can override it in Settings.
  - **CalDAV** (iCloud, Fastmail, Nextcloud): `tsdav`.
  - Each connector starts read-only. Writing time blocks back comes in Phase 7b.
  - **CORS:** CalDAV and some ICS hosts don't send CORS headers, so in the web
    build these connectors are disabled with an explanation. Native builds use
    native HTTP.

## 9. Reminders

- **Local notifications on each device:** the Tauri notification plugin on
  desktop, Capacitor Local Notifications on mobile, and the Notification API on
  the web while the tab is open.
- **Per device:** reminder categories can be turned on or off, so the same
  reminder doesn't fire on every device. Dismissals and completions sync.
- **Desktop:** runs in the tray, with an optional launch at login.
- **Gentle by default:** quiet hours, at most one nudge per habit per day,
  snooze until tomorrow, and a daily digest instead of many separate pings.

## 10. Insights

- A local job runs nightly and on app open. It builds a **daily feature table**:
  sleep, water, exercise, mood, energy, habit completions, focus minutes, spend,
  journal written, and interactions.
- **Correlations:**
  - Same-day and next-day pairs, using Pearson or point-biserial.
  - A pair is shown only with at least 21 paired days, a Benjamini–Hochberg q
    below 0.1, and a minimum effect size.
  - Wording is never causal.
- **Weekly dashboard:** tasks done and slipped, focus by area, habit
  consistency, budget status, sleep and mood trends, people nudges, and the top
  correlations.
- **Life wheel:** a radar chart of each Area's time, tasks, habit adherence and
  goal progress over 4 weeks, compared with the user's target weights.
  Neglected areas are flagged.
- All of this is deterministic. AI is only an optional narrative layer on top.

## 11. AI layer

```ts
interface AIProvider {
  id: 'claude' | 'ollama';
  chat(req: ChatRequest): Promise<ChatResult>;   // supports tools + JSON-schema output
  capabilities: { toolUse: boolean; structuredOutput: boolean; maxContext: number };
}
```

- **Claude:**
  - Calls the Messages API directly with the user's key. The web build needs
    the browser-access header.
  - The model id is configurable. The default is kept in one constant in
    `packages/ai`.
- **Ollama:** a user-configured URL. Desktop uses localhost; mobile and web can
  point at a LAN host.
- **"Plan my week":**
  1. Build context: tasks, events, habits, working hours, energy preferences
     and goals.
  2. The model returns structured `TimeBlock[]` with a short rationale.
  3. A **deterministic validator** checks overlaps, working hours, due-date
     feasibility and capacity. It repairs small problems or re-asks the model.
  4. The proposal appears as an overlay on the planner. The user edits it and
     clicks Accept. **Nothing is written without approval.**
- **Other features:** inbox triage suggestions, natural-language capture,
  weekly-review and journal assistance, flashcards generated from notes, and a
  narrative for weekly insights.
- **Privacy:**
  - Per-module "never send" toggles. Money, People, Health and the document
    vault are off by default for remote providers.
  - A "show what will be sent" preview.
  - No AI calls unless the user starts them or turns on a schedule.

## 12. Voice capture

- **Record:** one tap creates an InboxItem with an encrypted audio blob right
  away.
- **Transcription** runs from a queue, in this order of preference:
  1. whisper.cpp as a Tauri sidecar on desktop (offline; handles fa and en).
  2. A speech-to-text endpoint the user configures
     (`/audio/transcriptions`-compatible). Claude doesn't take audio input.
  3. **Deferred:** the item is marked `needs_transcription`, and the next
     desktop with Whisper that syncs processes it.

## 13. Localization

- **Strings:** i18next with `en` and `fa` catalogs. No hard-coded user-visible
  strings.
- **Layout:** only CSS logical properties, with `dir` on `<html>`. Icons that
  imply direction are mirrored.
- **Calendar system** is a separate setting from language:
  - Gregorian or Jalali, using `date-fns-jalali`.
  - The week start is configurable (Saturday by default for Jalali).
  - Latin or Persian digits are a setting.
- **Money:**
  - Integer minor units plus an ISO 4217 code.
  - A base currency per user, with FX rates entered manually or optionally
    fetched.
  - IRR has a "display as Toman" option.

## 14. Platform matrix

| Capability | Web (PWA) | macOS / Windows (Tauri) | Android (Capacitor) |
|---|---|---|---|
| SQLite | sqlite-wasm + OPFS | tauri-plugin-sql | capacitor-sqlite |
| Sync (GitHub/GitLab API) | ✅ | ✅ | ✅ |
| Secrets | encrypted IndexedDB | OS keychain | Android Keystore |
| Notifications | while tab open | ✅ tray + autostart | ✅ |
| Voice record | ✅ | ✅ | ✅ |
| Local transcription | ❌ | ✅ whisper.cpp | deferred to desktop |
| CalDAV / some ICS | ❌ (CORS) | ✅ | ✅ |
| Quick capture | ⌘K / shortcut | global hotkey | widget + share target |
| Updates | always latest | Tauri updater (GitHub Releases) | in-app APK update check |

## 15. Testing

- **core:** exhaustive unit tests (Vitest). Recurrence is tested in both
  calendar systems, plus streaks, budgets, FSRS and the statistics. Use
  property-based tests (fast-check) where possible.
- **sync:**
  - An in-memory **fake forge** that implements the transport interface, with
    the same CAS semantics.
  - A **multi-device convergence simulator:** N devices make random concurrent
    edits and sync in random orders, and must reach identical state.
  - Contract tests run against real GitHub and GitLab test repos. They are
    opt-in and use tokens from env vars.
- **crypto:** known-answer vectors, and tests that tampered or relocated files
  are rejected.
- **UI:** Playwright on the web build, in light and dark, LTR and RTL.
  Accessibility checks with axe.
