# Life Manager — Roadmap

Each phase ends with something usable on every platform. The order follows the
dependencies: sync and the data layer first, because every module builds on
them; then the modules you use daily; then the integrations and the AI layer.

## Phase 0 — Foundations

- Monorepo (pnpm + Turborepo), TypeScript strict mode, lint, format and CI.
- `core`: entity schemas (zod), HLC, ULIDs, the links/tags/areas model.
- `db`: SQLite driver interface, three drivers, migrations, FTS5 search.
- `crypto`: Argon2id, the record codec, the keyring and the recovery key.
- `sync`: the isomorphic-git adapters, export, fetch, 3-way merge and push loop,
  the blob store, and the **multi-device convergence simulator**.
- `i18n`: en and fa, RTL layout primitives, Jalali/Gregorian utilities, money
  formatting.
- App shells: web, Tauri (macOS and Windows), Capacitor (Android). Navigation,
  settings, an onboarding wizard (create or join a repo, passphrase, recovery
  key) and a sync status indicator.

**Exit:** two devices edit a test entity offline and converge after syncing.
The repo contains only ciphertext.

## Phase 1 — Core planning

- Inbox: quick capture with text, a global hotkey on desktop, and the Android
  share target and widget.
- Areas, Projects and Tasks: priorities, due and scheduled dates, subtasks, and
  recurrence (Jalali-aware).
- The built-in calendar and the **Planner** day/week timeline.
- **Time-blocking:** drag tasks onto the timeline.
- The local notification framework (reminders, quiet hours, per-device
  settings).

## Phase 2 — People and knowledge

- People CRM: persons, interactions, relationships, important dates, cadence
  nudges and the timeline. vCard import.
- Notes: Markdown editor, `[[wikilinks]]`, `@mentions`, tags, a backlinks panel
  and search.
- Journal with optional daily prompts.

## Phase 3 — Habits, routines and focus

- Habits with flexible schedules, streaks that respect "3× per week", and
  gentle reminders.
- Morning and evening routine checklists.
- The weekly review flow: what got done, what slipped, what's next. It creates
  tasks from the answers.
- A Pomodoro/focus timer tied to a task. Time tracking, and a report of
  where your hours actually went.

## Phase 4 — Money

- Accounts, categories, and income/expense logging (multi-currency, base
  currency, FX rates).
- Monthly budgets with threshold alerts.
- A bills and subscriptions tracker with due reminders.
- Savings goals.
- CSV import for bank statements.

## Phase 5 — Health and learning

- Sleep, water, exercise, mood and custom metric logs, built for quick entry.
- The daily feature table and the **correlation engine**.
- A reading/course tracker.
- Spaced-repetition flashcards (FSRS). Anki import is optional.

## Phase 6 — Life admin

- Document vault: encrypted attachments, document metadata and expiry
  reminders.
- Shopping lists.
- Home and asset maintenance schedules.
- Goals with milestones, linked tasks and automatic progress. This could move
  earlier if you'd like it sooner.

## Phase 7 — External calendars

- ICS subscriptions and import.
- Google Calendar (read, then write-back of time blocks).
- CalDAV/iCloud (read, then write).

## Phase 8 — Smart layer

- The AI provider abstraction, with Claude and Ollama, privacy toggles and a
  send preview.
- "Plan my week": a proposal, deterministic validation, then accept or edit.
- Inbox triage, natural-language capture, and review/journal assistance.
- Voice notes: recording, then transcription through whisper.cpp, a configured
  endpoint, or deferred to desktop.
- The weekly insights dashboard and the **life-areas wheel**.

## Phase 9 — Release

- Signed macOS (notarized) and Windows installers, with auto-update.
- A signed Android build (Play Store or APK).
- Backup and export to plain JSON/Markdown, so the data is never locked in.
- Repo compaction tooling and a key-rotation flow.
