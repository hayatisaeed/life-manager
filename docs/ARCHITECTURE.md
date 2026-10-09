# Life Manager — Architecture

Status: **draft for review**. Nothing here is built yet. This document records the
decisions made so far and the design that follows from them. Open questions are
collected at the end.

## 1. Decisions so far

| Topic | Decision |
|---|---|
| Server | **None, ever.** All logic runs on the device. Django is dropped (see §2). |
| Clients | One React + TypeScript codebase. **Tauri 2** for macOS and Windows, **Capacitor** for Android, plus a web build (PWA). |
| Sync | A private git repo on GitHub, GitLab, Gitea or any HTTPS git server. |
| Sync format | **One encrypted JSON file per record**, merged at the field level. |
| AI | **Pluggable**: Claude API (your key) or a local model through Ollama. |
| Calendars | Built-in events, plus Google Calendar, CalDAV/iCloud and `.ics` subscriptions. |
| Locale | English and Persian (RTL) UI, Gregorian and **Jalali** calendars, multiple currencies. |
| Voice notes | Record now (encrypted audio), transcribe later. |

## 2. Why no Django

With no remote server, Django would have to be bundled into every app as a local
engine. That has three problems:

- Every desktop install would have to ship and run a Python runtime.
- It can't run on Android in any practical way, so Android would need a second
  implementation of all the logic anyway.
- Its main strengths (ORM, admin, auth, HTTP API) are aimed at serving many
  clients, which this design never does.

Instead, all domain logic lives in a **shared TypeScript core** that runs
unchanged in the web, Tauri and Capacitor apps. Tauri's Rust side is used only
for the few things TypeScript can't do well, such as the OS keychain, a tray
icon with autostart, and a local Whisper sidecar.

## 3. High-level shape

```
┌──────────────────────────── each device ─────────────────────────────┐
│                                                                       │
│   React UI (packages/ui)  ── i18n / RTL / Jalali / currency           │
│        │                                                              │
│   Domain core (packages/core)                                         │
│   tasks · habits · money · people · notes · SRS · correlations · …    │
│        │                                                              │
│   Repository layer ──► SQLite (local source of truth, fast queries)   │
│        │                                                              │
│   Sync engine (packages/sync)                                         │
│     ├─ export changed records ─► encrypt ─► git working tree          │
│     └─ fetch ─► 3-way merge (decrypted) ─► SQLite + commit ─► push    │
│                                                                       │
│   Platform adapters: SQLite driver · filesystem · HTTP · keychain ·   │
│                      notifications · audio · file picker              │
└───────────────────────────────┬───────────────────────────────────────┘
                                │  HTTPS (token auth)
                       ┌────────▼─────────┐
                       │ private git repo │  ← only ciphertext lives here
                       └──────────────────┘
```

The app is **fully usable offline and without sync configured**. Sync is an
add-on that you turn on by connecting a repo.

## 4. Monorepo layout

pnpm workspaces + Turborepo.

```
life-manager/
├─ apps/
│  ├─ web/              Vite + React PWA
│  ├─ desktop/          Tauri 2 (macOS, Windows); src-tauri/ holds the Rust side
│  └─ android/          Capacitor project wrapping the shared web build
├─ packages/
│  ├─ core/             entities, zod schemas, domain services, recurrence, streaks,
│  │                    budgets, FSRS, correlations; pure TS, no platform code
│  ├─ db/               SQLite schema + migrations + repository layer; driver interface
│  ├─ sync/             isomorphic-git wrapper, record codec, 3-way merge, blob store
│  ├─ crypto/           libsodium wrappers: Argon2id, XChaCha20-Poly1305, HMAC
│  ├─ calendar/         Google, CalDAV (tsdav), ICS (ical.js) connectors
│  ├─ ai/               provider interface; Claude + Ollama implementations; tools
│  ├─ i18n/             en + fa catalogs, Jalali/Gregorian date utilities, number/currency formatting
│  ├─ ui/               design system, RTL-safe components, shared screens
│  └─ platform/         adapter interfaces + web / tauri / capacitor implementations
└─ docs/
```

## 5. Local storage

- **SQLite everywhere**, behind one `Driver` interface:
  - Web: official `@sqlite.org/sqlite-wasm` with the OPFS backend.
  - Desktop: `tauri-plugin-sql` (SQLite).
  - Android: `@capacitor-community/sqlite`.
- SQLite is the local source of truth and the query engine (FTS5 for search).
  The git working tree is a separate on-disk copy, used only as the sync transport.
- Every row has:
  - `id`: a ULID.
  - `type`.
  - `updated_at`: a hybrid logical clock (HLC) value.
  - `updated_by`: the device id.
  - `deleted`: a tombstone flag.
  - A per-field HLC map, used to break merge ties.
- Attachments (scans, voice notes, photos) are stored as content-addressed files
  in the app data directory and referenced by hash.

## 6. Sync design

### 6.1 Repo layout (what the git server sees)

```
lm.json                  format version + KDF params + wrapped data key (no plaintext)
r/3f/3fa9…e1.lmr         one encrypted record per file
r/a0/a07c…44.lmr
b/9c/9c12…ff.lmb         encrypted attachment blobs
devices/<hmac>.lmr       encrypted device registry entries
```

- The file name is `HMAC(key, record id)`. Record types, ids and creation times
  (ULIDs contain a timestamp) are **not** visible from the outside. The type is
  stored inside the encrypted payload.
- Commit messages are generic (`sync`). **What still leaks:** commit times
  (activity patterns), the number of records, and the size of each file. If
  that matters, a later option can pad files and batch commits.

### 6.2 Record encryption

- File format: `version(1) ‖ nonce(24) ‖ XChaCha20-Poly1305(JSON)`. The AAD is
  the record id, so a file can't be moved to another path without failing
  authentication.
- **Keys:**
  - A random 256-bit **data key** encrypts everything.
  - The data key is wrapped by a key derived from your **passphrase** with
    Argon2id, and the wrapped copy is stored in `lm.json`.
  - A one-time **recovery key** is shown at setup and wraps a second copy.
  - Each device caches the unwrapped key in the OS keychain: Keychain on macOS,
    Credential Manager on Windows, Android Keystore. The web build keeps it only
    in memory and asks for the passphrase each session.
- Changing your passphrase only re-wraps the data key. **Full key rotation**
  means re-encrypting every record, and git history still contains the old
  ciphertext. Section 6.5 covers squashing history if you need that.

### 6.3 Sync cycle

1. **Export:** write each record changed since the last sync to its `.lmr`
   file, then commit locally.
2. **Fetch** from the remote.
3. If the remote moved, **merge**. For each record changed on either side since
   the merge base, decrypt `base`, `ours` and `theirs`, then merge field by field:
   - **Only one side changed the field:** take that side.
   - **Both changed a scalar:** the higher field HLC wins (ties go to the
     larger device id).
   - **Both changed a set** (tags, links): 3-way set merge, applying both
     sides' additions and removals.
   - **Both changed long text** (notes, journal, person notes): diff3 against
     the base. If the edits overlap, keep both versions with a visible conflict
     marker block for you to resolve.
   - **One side deleted the record while the other edited it:** the edit wins
     and the record is restored. This is the safer default.
4. Apply the merged records to SQLite and create a merge commit.
5. **Push.** If the push is rejected as non-fast-forward, go back to step 2,
   with backoff.

Triggers: on app start and on resume, about 30 seconds after the last local
edit, on a timer (default 5 minutes), and from a manual "Sync now" button.

Because the merge works on decrypted structure rather than text, git's own
merge never touches ciphertext. Git provides only the transport, the history
and the merge base.

### 6.4 Git client

- **isomorphic-git** (pure JS) is used on every platform, so there is one sync
  implementation. It is given:
  - A **filesystem adapter**: Tauri `fs` plugin, Capacitor Filesystem, or
    LightningFS (IndexedDB) on the web.
  - An **HTTP adapter**: Tauri `http` plugin or CapacitorHttp. Both are native,
    so CORS doesn't apply.
- **Auth:** HTTPS with a personal access token or deploy token, stored in the
  keychain. Works with GitHub, GitLab, Gitea/Forgejo and any smart-HTTP server.
- **Limitations:**
  - isomorphic-git does not support SSH remotes.
  - Git LFS is not supported, so blobs are capped (default 25 MB per file;
    GitHub's hard limit is 100 MB).
  - Browsers enforce CORS, and GitHub/GitLab don't send CORS headers for git
    traffic. **The web build can't sync directly.** See open question 1.

### 6.5 Repo growth

Every edit adds a new ciphertext blob to history, and encrypted data doesn't
delta-compress. Two tools keep the repo small:

- **Batching:** many edits go into one commit per sync cycle.
- **Compaction:** an optional action that creates a fresh orphan commit with
  only the current state and force-pushes it. Other devices notice the reset
  and re-clone. This is also how old ciphertext is purged after a key rotation.

### 6.6 What syncs and what stays on the device

- **Synced:** all user data, plus settings marked as "account" settings.
- **Device-only:**
  - The git token.
  - Calendar OAuth tokens, CalDAV passwords and the AI API key. These are
    secrets; a later option could sync them encrypted.
  - The external calendar cache.
  - Notification schedule state.
  - The search index.

## 7. Domain model

Every entity can link to other entities through `links`, to life **Areas**, and
to **Tags**. Backlinks are computed by indexing every reference.

| Module | Entities (main fields) |
|---|---|
| Structure | **Area** (name, color, target weight for the wheel) · **Tag** · **Link** (from, to, kind) |
| Planning | **Project** (area, status) · **Task** (title, notes, project, parent, priority P1–P4, due, scheduled, estimate, recurrence, status) · **Goal** (area, why, target date) · **Milestone** (goal, due) · **InboxItem** (text, audio blob, source, processed) |
| Calendar | **Event** (title, start/end, all-day, recurrence, source: local, google, caldav or ics) · **TimeBlock** (event with optional task link) |
| Habits | **Habit** (schedule: daily, specific weekdays, N per week/month, every N days; reminder; area) · **HabitLog** · **Routine** (morning/evening, ordered steps) · **RoutineRun** · **Review** (weekly answers, stats snapshot) |
| Time | **FocusSession** (task, planned and actual minutes, interruptions) · **TimeEntry** (task, project, area, start/end, source: timer, manual or block) |
| Money | **Account** (currency) · **Category** · **Transaction** (amount in minor units, currency, fx rate to base, category, account, payee) · **Budget** (month, category, limit, alert %) · **Bill** (amount, recurrence, autopay, next due) · **SavingsGoal** (target, linked account) · **FxRate** |
| Health | **HealthLog** (date, metric: sleep, water, exercise, mood, energy or custom; value; unit; note) · **JournalEntry** (date, body, prompt, mood) |
| Learning | **Note** (Markdown, `[[wikilinks]]`, `@person` mentions, tags) · **Resource** (book, course or article; progress; status; rating) · **Deck** · **Card** (front/back, FSRS state) · **ReviewLog** |
| Life admin | **Document** (kind, number, issuer, issue/expiry date, blob refs, reminder lead time) · **ShoppingList** · **ShoppingItem** · **Asset** (home item, appliance, car) · **MaintenancePlan** (asset, recurrence, last done) |
| People (CRM) | see §8 |
| AI | **Insight** (generated text, period, inputs hash) · **PlanProposal** (proposed blocks, status) |

**Recurrence** uses an engine based on a subset of RFC 5545 RRULE, extended with
a `calendar` field (`gregorian` or `jalali`). That makes rules like "every 1
Farvardin" or "the 15th of every Jalali month" correct. Plain `rrule.js` can't
express these.

## 8. People (CRM)

- **Person:**
  - Name and aliases (including a Persian name), photo, pronouns.
  - Contact methods, company and role, how you met, relationship type.
  - Tags, custom fields and important dates (birthday, anniversary). Each date
    records its calendar system, so a Jalali birthday repeats on the Jalali date.
  - **Contact cadence:** for example, "every 3 weeks".
- **Interaction:**
  - Date, kind (call, meeting, message, email, in person), the people involved
    (many-to-many), and notes.
  - Sentiment and follow-ups. A follow-up creates a linked Task.
- **Relationship:** person ↔ person (spouse, colleague, introduced-by).
- **Person timeline:** interactions, notes that @mention them, linked tasks,
  documents and gift ideas, all in one feed.
- **Nudges:**
  - "Haven't talked in a while" compares the last interaction with the cadence
    and ranks people by how overdue they are.
  - Upcoming birthdays and important dates are reminded N days ahead.
- **Import:** vCard (`.vcf`) for Google, iCloud and Android contacts; CSV.

## 9. Calendars and planner

- The **Planner** is a day/week timeline that merges:
  - Local events and time blocks.
  - External events (read-only cache).
  - Tasks scheduled for the day, and tasks due without a time (shown in a
    sidebar).
  - Habits and routines due.
  - Bills due.
- **Time-blocking:** drag a task onto the timeline to create a TimeBlock linked
  to the task. Its length comes from the task's estimate. Finishing the block
  can log a TimeEntry.
- **Connectors**, each one device-local and on by choice:
  - **ICS:** subscribe to a URL or import a file, using `ical.js`.
  - **Google Calendar:** OAuth 2.0 with PKCE. Tauri uses a loopback redirect and
    Android uses a custom-scheme redirect. Read first; writing time blocks back
    to a chosen calendar comes later.
  - **CalDAV** (iCloud, Fastmail, Nextcloud): `tsdav` with an app-specific
    password. The same plan: read first, write later.

## 10. Reminders and notifications

- Reminders are scheduled **on each device** as local notifications, using the
  Tauri notification plugin or Capacitor Local Notifications. No push server
  is needed.
- Each device has a "reminders on/off" setting per category, so you can choose
  phone-only reminders instead of getting the same one on every device. When
  you dismiss or complete a reminder, that syncs.
- Desktop reminders fire only while the app runs. It can run in the tray and
  start at login.
- Reminders are "gentle": quiet hours, one reminder per habit per day, and
  snooze-to-tomorrow.

## 11. Insights and correlations

- A nightly local job builds a **daily feature table**: sleep hours, sleep
  quality, water, exercise minutes, mood, habit completions, focus minutes,
  spend, journal written, and interactions.
- **Correlations:**
  - Same-day and next-day lagged pairs, for example exercise today vs. sleep
    tonight. Pearson for continuous metrics; point-biserial for yes/no ones.
  - A pair is shown only when it has **at least 21 paired days**, a
    Benjamini–Hochberg-adjusted p < 0.1, and a non-trivial effect size.
  - Wording is non-causal: "On days you skip exercise, you sleep 40 min less on
    average (28 days of data)."
- **Weekly insights dashboard:**
  - Tasks done vs. slipped, focus hours by area, habit consistency.
  - Budget status, sleep and mood trend, and people nudges.
  - The top correlations.
- **Life wheel:** a radar chart of each Area's share of time, completed tasks,
  habit adherence and goal progress over the last 4 weeks, compared with the
  target weights you set. Neglected areas are highlighted.
- The AI layer is optional: everything above is computed deterministically, and
  the AI only writes a narrative summary on top.

## 12. AI layer

```ts
interface AIProvider {
  id: 'claude' | 'ollama';
  chat(req: { system: string; messages: Msg[]; tools?: Tool[]; schema?: JSONSchema }): Promise<Result>;
  capabilities: { toolUse: boolean; structuredOutput: boolean; maxContext: number };
}
```

- **Claude:**
  - Calls the Anthropic Messages API directly from the device with your key.
  - On the web build, this needs the API's direct-browser-access header.
  - The model is configurable, defaulting to the current Sonnet-class model.
- **Ollama:**
  - Any local model, at a URL you configure (default `localhost:11434`).
  - Desktop only in practice. Android can point at an Ollama instance on your
    LAN.
- **"Plan my week":**
  1. Gather context: open tasks (with estimates, due dates, priorities and
     projects), the week's events, habits, your working hours and energy
     preferences, and goals with deadlines.
  2. The model returns structured `TimeBlock[]` with a short rationale for each.
  3. A **deterministic validator** checks for overlaps, working-hour limits,
     due-date feasibility and estimate totals. It repairs small problems or asks
     the model to retry.
  4. The proposal is shown as an overlay on the planner, where you can edit it
     and **Accept** or **Discard**. Nothing is written without your approval.
- **Other AI features:**
  - Inbox triage suggestions (project, due date, priority).
  - Weekly-review summary and journal prompts.
  - Natural-language capture ("dentist next Tue 3pm").
  - Flashcard generation from notes.
- **Privacy controls:**
  - Per-module "never send to AI" toggles. Money and People are off by default
    for the Claude provider.
  - A "show what will be sent" preview.
  - No background AI calls. Each call is user-initiated or comes from a
    schedule you turned on.

## 13. Voice capture

- **Recording:** one tap records audio in the inbox, using MediaRecorder or a
  Capacitor plugin. The audio is saved as an encrypted blob and an InboxItem is
  created immediately.
- **Transcription** runs from a queue, in this order of preference:
  1. On desktop: **whisper.cpp** as a Tauri sidecar (offline; handles Persian
     and English).
  2. A speech-to-text endpoint you configure (any OpenAI-compatible
     `/audio/transcriptions` service). Claude doesn't take audio input, so it
     can't do this step.
  3. **Deferred:** a note recorded on Android syncs, any desktop device with
     Whisper picks up the queue, and the transcript syncs back.

## 14. Localization

- **Strings:** i18next with `en` and `fa` catalogs.
- **Layout:** only CSS logical properties (`margin-inline-start` and so on),
  plus `dir="rtl"` on the root. Icons that imply direction are mirrored.
- **Fonts:** Vazirmatn for Persian, the system font for Latin.
- **Calendar system** is a separate setting from language:
  - Gregorian or Jalali, using `date-fns-jalali`.
  - The week start is configurable (Saturday by default for Jalali).
  - Persian or Latin digits are a setting.
- **Currency:**
  - Amounts are stored as integer minor units plus an ISO code.
  - You choose a base currency, and budgets and reports convert to it.
  - Rates are entered manually by default, with an optional online rate fetch.
  - IRR has a "display as Toman" option.

## 15. Platform matrix

| Capability | Web (PWA) | macOS / Windows (Tauri) | Android (Capacitor) |
|---|---|---|---|
| SQLite | sqlite-wasm + OPFS | tauri-plugin-sql | capacitor-sqlite |
| Git sync | needs CORS proxy (Q1) | ✅ native HTTP | ✅ native HTTP |
| Keychain | memory only | ✅ | ✅ Keystore |
| Notifications | while tab open | ✅ (tray/autostart) | ✅ |
| Voice record | ✅ | ✅ | ✅ |
| Local transcription | ❌ | ✅ whisper.cpp | deferred to desktop |
| Ollama | if CORS allowed | ✅ | LAN only |
| Widgets / quick capture | — | global hotkey | home-screen widget + share target |

## 16. Testing strategy

- **Core:** Vitest unit tests for recurrence (both calendar systems), streaks
  with flexible schedules, budgets, FSRS and correlation statistics.
- **Sync:** a deterministic multi-device simulator. N in-memory devices make
  random concurrent edits, sync in random orders, and must converge to identical
  state. This includes delete/edit races and text conflicts.
- **Crypto:** known-answer tests, and checks that tampered or moved files are
  rejected.
- **UI:** Playwright against the web build, run in both LTR and RTL.

## 17. Open questions

1. **Web build sync.** Browsers can't talk to GitHub's git endpoint directly
   because of CORS. The options:
   - (a) Make the web build local-only or a demo, with no sync.
   - (b) Run a small CORS proxy you host yourself, which only ever sees
     ciphertext.
   - (c) Use the GitHub/GitLab REST "contents" API, which allows CORS, instead
     of the git protocol. That only supports GitHub and GitLab and needs extra
     code.
   - Recommendation: **(a) for now**, with (c) possible later.
2. **iOS.** Is it wanted eventually? Capacitor makes it cheap to add later, but
   Apple distribution needs a $99/yr developer account.
3. **Distribution.**
   - Code signing for macOS (notarization) and Windows (to avoid SmartScreen
     warnings).
   - Android through the Play Store or a sideloaded APK.
4. **Single user.** I've assumed one person and their own devices, with no
   shared lists or households. Is that right?
5. **Imports.** Should any existing data be imported at launch? For example
   Todoist, Notion, Obsidian (Markdown folder), Google Contacts (vCard), bank
   CSV, or Anki decks.
6. **Visual design.** Do you have preferences (minimal, dense, playful) or
   reference apps you like?
