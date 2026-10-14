# Data Model

These are the canonical entity definitions. The zod schemas in
`packages/core/src/entities/` are the source of truth in code and must match
this document. If you change one, change the other in the same PR.

## 1. Conventions

- **Every entity** carries the sync envelope fields:
  - `id`: a ULID.
  - `type`, `schema`, `hlc`, `fieldHlc`, optional `textVersions` (ADR-013).
  - `deletedAt`: an ISO timestamp, or null.
  - `createdAt`.
  - Only `data` is listed below.
- **Dates and times:**
  - A date with no time is `LocalDate` (`YYYY-MM-DD`, always in the Gregorian
    proleptic calendar). Jalali is only a display and recurrence concern.
  - A moment in time is `Instant` (ISO UTC).
  - A time of day is `LocalTime` (`HH:mm`).
  - Time zones are IANA names.
- **Money:** `Money = { amount: integer minor units, currency: ISO4217 }`.
- **References** are ids (`Ref<Task>`). Cross-module relationships use the
  generic **Link** entity rather than foreign keys, so any entity can link to
  any other.
- **Ordering** uses fractional-index strings (`order: string`).
- **Long text fields** (merged with diff3, see SYNC.md §6) are named `body`,
  `notes` or `content`. Use these names only for long text.
- **Schema evolution:**
  - Bump the entity's `schema` number and add an upgrader in
    `core/src/entities/<entity>/upgrade.ts`.
  - Upgraders must be pure and must not drop fields they don't recognize. Keep
    them under `data._unknown`.

Implementation conventions (ADR-012): envelope type names use lower camel case
(e.g. `inboxItem`). `BlobRef = {hash, name, mime, size}` carries the plaintext
BLAKE2b-256 content hash, original filename, MIME type and plaintext byte size.
Goal status uses Project's `active | onHold | done | archived` enum; manual
progress is a fraction in [0, 1]. Resource ratings are 1–5 and FSRS states 0–3.
The settings record remains preserved as an unknown type until P0.7 defines
its complete schema. Unknown/newer records must never be overwritten.

Recurrence uses Sunday-anchored weeks; invalid fixed month/day dates are skipped.
`until` is inclusive and `count` includes the initial matching occurrence. For
`afterCompletion`, the caller supplies the completion date and total consumed
instances; the next interval is anchored to completion. A bounded search that
cannot find a match reports an error rather than silently marking a rule ended.

## 2. Shared types

```ts
type Priority = 1 | 2 | 3 | 4;                    // 1 = highest
type CalendarSystem = 'gregorian' | 'jalali';

interface Recurrence {                            // subset of RFC 5545 + calendar system
  calendar: CalendarSystem;
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;                               // ≥ 1
  byWeekday?: (0|1|2|3|4|5|6)[];                  // 0 = Sunday
  byMonthDay?: number[];                          // in `calendar`; -1 = last day
  byMonth?: number[];                             // in `calendar`
  bySetPos?: number[];                            // e.g. "2nd Tuesday"
  until?: LocalDate; count?: number;
  mode: 'fixed' | 'afterCompletion';              // "every 3 days after I finish it"
}

interface Reminder { offsetMinutes: number; channel: 'notify'; }   // relative to the due/start time
```

## 3. Structure

| Entity | data |
|---|---|
| **Area** | `name, color, icon, targetWeight (0–10), order, archived` |
| **Tag** | `name, color` |
| **Link** | `from: {type,id}, to: {type,id}, kind: 'related'\|'mentions'\|'blocks'\|'partOf'\|'about'` |

Backlinks are a derived index: `Link`s plus references parsed from text
(`[[Note title]]`, `@person`, `#tag`). They are rebuilt locally and never
synced.

## 4. Planning

| Entity | data |
|---|---|
| **InboxItem** | `text, audioBlob?: BlobRef, transcript?, transcriptStatus: 'none'\|'pending'\|'done'\|'failed', source: 'quick'\|'share'\|'voice'\|'import', processedAt?` |
| **Project** | `name, areaId?, status: 'active'\|'onHold'\|'done'\|'archived', notes, color?, order` |
| **Task** | `title, notes, projectId?, parentId?, areaId?, goalId?, milestoneId?, priority, status: 'todo'\|'doing'\|'done'\|'cancelled', dueDate?: LocalDate, dueTime?: LocalTime, scheduledAt?: Instant, estimateMin?, recurrence?, reminders: Reminder[], tags: string[], completedAt?, order` |
| **Goal** | `title, why: body, areaId?, targetDate?, status, progressMode: 'milestones'\|'tasks'\|'manual', manualProgress?` |
| **Milestone** | `goalId, title, dueDate?, doneAt?, order` |

- **Completing a recurring task:**
  1. Mark the current instance done.
  2. Create the next instance as a **new Task**, copying fields and setting
     `recurrenceOf` to the original's id.
  3. Move the `recurrence` rule to the new task.

  This keeps history immutable and avoids merge conflicts on one ever-changing
  row.
- **Goal progress is derived:**
  - `milestones` mode: done milestones ÷ all milestones.
  - `tasks` mode: done linked tasks ÷ all non-cancelled linked tasks.
  - `manual` mode: the stored value.

## 5. Calendar

| Entity | data |
|---|---|
| **Event** | `title, notes, start: Instant, end: Instant, allDay, timeZone, location?, recurrence?, reminders, source: 'local'` |
| **TimeBlock** | `taskId?, title, start, end, kind: 'task'\|'focus'\|'routine'\|'buffer', proposalId?` |

External events (Google, CalDAV, ICS) are **not** synced entities. They live in
a device-local `external_events` cache table with
`connectorId, externalId, etag, …`.

## 6. Habits & routines

| Entity | data |
|---|---|
| **Habit** | `name, areaId?, icon, color, kind: 'boolean'\|'count'\|'duration', target? (e.g. 8 glasses), schedule: HabitSchedule, reminderTime?, startDate, archived` |
| **HabitLog** | `habitId, date: LocalDate, value (1 for boolean), note?` |
| **Routine** | `name, kind: 'morning'\|'evening'\|'custom', steps: {id, title, habitId?, durationMin?, order}[], reminderTime?` |
| **RoutineRun** | `routineId, date, completedStepIds: string[], startedAt?, finishedAt?` |
| **WeeklyReview** | `weekStart: LocalDate, done: body, slipped: body, next: body, highlights?: body, statsSnapshot: json` |

```ts
type HabitSchedule =
  | { kind: 'daily' }
  | { kind: 'weekdays'; days: number[] }
  | { kind: 'timesPer'; times: number; period: 'week' | 'month' }
  | { kind: 'everyNDays'; n: number };
```

**Streaks:**

- `timesPer` habits count streaks in periods ("3× per week" kept for N weeks).
- Other habits count streaks in scheduled days.
- One "skip" token per period doesn't break a streak. Streak logic lives in
  `core/habits/streak.ts` and is fully unit-tested.

## 7. Time & focus

| Entity | data |
|---|---|
| **FocusSession** | `taskId?, plannedMin, start, end?, breaks: {start,end}[], interruptions: number, note?` |
| **TimeEntry** | `taskId?, projectId?, areaId?, start, end, source: 'timer'\|'manual'\|'block'\|'focus', note?` |

## 8. Money

| Entity | data |
|---|---|
| **Account** | `name, kind: 'cash'\|'bank'\|'card'\|'savings'\|'investment', currency, openingBalance: Money, archived` |
| **Category** | `name, kind: 'expense'\|'income', parentId?, color, icon` |
| **Transaction** | `accountId, date, amount: Money (negative = outflow), categoryId?, payee?, notes, tags, fxToBase?: number, transferId?, billId?` |
| **Budget** | `month: 'YYYY-MM' (in the user's calendar system), categoryId, limit: Money (base currency), alertAtPct: number (default 80)` |
| **Bill** | `name, amount: Money, recurrence, nextDue: LocalDate, accountId?, categoryId?, autopay: boolean, kind: 'bill'\|'subscription', url?, reminders` |
| **SavingsGoal** | `name, target: Money, accountId?, targetDate?, manualSaved?: Money` |
| **FxRate** | `date, from, to, rate, source: 'manual'\|'fetched'` |

- **Account balances** are derived from transactions and are never stored.
- **Budget months follow the user's calendar system.** A Jalali user's
  "Mehr 1405" budget covers the Gregorian date range of that Jalali month.

## 9. Health & journal

| Entity | data |
|---|---|
| **HealthLog** | `date, metric: 'sleep'\|'water'\|'exercise'\|'mood'\|'energy'\|'weight'\|'custom:<key>', value: number, unit, start?, end?, note?` |
| **MetricDef** | `key, name, unit, kind: 'number'\|'scale5'\|'boolean'` (for custom metrics) |
| **JournalEntry** | `date, body, promptId?, mood?: 1–5, tags` |
| **JournalPrompt** | `text, schedule?: 'daily'\|'weekly'\|'random', active` |

- **Sleep** is attributed to the date of the night it started. Duration =
  `end − start`.
- **Mood** and **energy** use a 1–5 scale.

## 10. Learning & knowledge

| Entity | data |
|---|---|
| **Note** | `title, content (Markdown), tags, pinned, folder?` |
| **Resource** | `kind: 'book'\|'course'\|'article'\|'video'\|'podcast', title, author?, url?, status: 'want'\|'doing'\|'done'\|'dropped', progress: {current, total, unit: 'pages'\|'percent'\|'lessons'}, rating?, startedAt?, finishedAt?, notes` |
| **Deck** | `name, description?` |
| **Card** | `deckId, front (Markdown), back (Markdown), sourceNoteId?, fsrs: {due, stability, difficulty, elapsedDays, scheduledDays, reps, lapses, state, lastReview?}, suspended` |
| **ReviewLog** | `cardId, rating: 1–4, reviewedAt, elapsedDays, scheduledDays, state` |

Use `ts-fsrs` for scheduling. ReviewLogs are append-only, so card state can be
replayed from them if two devices review the same card at the same time.

## 11. Life admin

| Entity | data |
|---|---|
| **Document** | `kind: 'id'\|'passport'\|'license'\|'warranty'\|'contract'\|'insurance'\|'medical'\|'other', title, number?, issuer?, issueDate?, expiryDate?, files: BlobRef[], remindDaysBefore: number[] (default [90, 30, 7]), personId?, assetId?, notes` |
| **ShoppingList** | `name, store?` |
| **ShoppingItem** | `listId, name, qty?, unit?, done, order, category?` |
| **Asset** | `name, kind: 'home'\|'appliance'\|'vehicle'\|'device'\|'other', purchaseDate?, warrantyDocId?, notes` |
| **MaintenancePlan** | `assetId?, title, recurrence, lastDone?, nextDue, notes` → creates Tasks when due |

## 12. People (personal CRM)

| Entity | data |
|---|---|
| **Person** | `name, nativeName?, nickname?, pronouns?, photo?: BlobRef, emails: {label,value}[], phones: {label,value}[], addresses: {label,value}[], socials: {kind,handle}[], company?, role?, howWeMet?, relationshipKind: 'family'\|'friend'\|'colleague'\|'acquaintance'\|'professional'\|'other', circle?: string, tags, cadenceDays?: number, customFields: {key,value}[], notes, archived` |
| **ImportantDate** | `personId, kind: 'birthday'\|'anniversary'\|'other', label?, month, day, year?, calendar: CalendarSystem, remindDaysBefore: number[]` |
| **Interaction** | `date: Instant, kind: 'call'\|'meeting'\|'message'\|'email'\|'inPerson'\|'other', personIds: string[], summary, notes, sentiment?: -2..2, followUpTaskIds: string[]` |
| **Relationship** | `aId, bId, kind: 'spouse'\|'partner'\|'parent'\|'child'\|'sibling'\|'colleague'\|'introducedBy'\|'custom', label?` |
| **GiftIdea** | `personId, idea, occasion?, url?, given: boolean` |

**Derived per person:**

- `lastInteractionAt`.
- `overdueBy = now − lastInteractionAt − cadenceDays`. The "haven't talked in
  a while" list is sorted by `overdueBy / cadenceDays`.
- A timeline that merges interactions, mentions in notes and journal entries,
  linked tasks, documents and gift ideas.

## 13. AI & insights

| Entity | data |
|---|---|
| **PlanProposal** | `range: {start,end}, blocks: Omit<TimeBlock,'proposalId'>[], rationale: body, provider, status: 'pending'\|'accepted'\|'discarded', acceptedBlockIds` |
| **Insight** | `period: {start,end}, kind: 'weekly'\|'correlation'\|'wheel', payload: json, narrative?: body` |

## 14. Settings

- **Account settings** sync as a single `settings` record: language, calendar
  system, week start, digits, base currency, theme preference, working hours,
  energy profile, life-wheel areas, and AI privacy toggles.
- **Device settings** never sync: per-device reminder categories, the sync
  interval, connectors, and secrets.


## 15. Product expansion mapping — planned, no schema change

[PRODUCT-RESEARCH.md](PRODUCT-RESEARCH.md) broadens the product experience.
This section maps that target to current entities; the tables above remain
canonical. No new field/type/version is introduced by this documentation change.

| Planned experience | Current entity basis | Additional contract required |
|---|---|---|
| Multiple notes about a person | Note + Link (`about`), Person.notes for overview | Per-person pin/order only if later required (G05). |
| Conversation history and promises | Interaction + its personIds/followUpTaskIds + Task | Retry-safe compound writes; cadence snooze/reset and duplicate reference rewrite (G05). |
| Project workspace and related knowledge | Project + Task.projectId + Area + Note/Resource links | Project-owned sections/milestones/target dates (G03); existing Milestone belongs to Goal. |
| Waiting/dependency views | Task + Link (`blocks`) | Status/context, cycle and concurrent update semantics (G04). |
| Real calendar and daily execution | Event + TimeBlock + Task + FocusSession/TimeEntry | Chosen-day priority persistence and durable lifecycle contract (G01); recurring edits. |
| Habit/routine/health detail | Habit/HabitLog + Routine/Run + HealthLog/MetricDef | Idempotent occurrences, history correction and units; no new fields by implication. |
| Finance depth | Account/Transaction/Category/Budget/Bill/SavingsGoal/FxRate | Splits/reconciliation/audit/rules/payment identity (G06). |
| Writing, annotations and learning | Note + JournalEntry/Prompt + Resource + Card/Deck/ReviewLog | Highlight source locators, journal cardinality/collections and templates/media (G07). |
| Documents and home management | Document + Asset + MaintenancePlan + ShoppingList/Item | Asset locations/custom fields and maintenance history identity (G08). |
| Goals and review | Goal + Milestone + linked Task/Project + WeeklyReview/Insight | New habit/resource contribution formulas only after G08. |
| Personal workspace preferences/recovery | Settings plan and device-local runtime state | Complete synced/device-local preference and draft/session contract (G01). |
| Inbox processing depth | InboxItem + destination entities | Archive/defer/split provenance and recoverable conversion (G02). |

Derived views must preserve identity across modules. A note save is not an
Interaction and must not count as contact. A follow-up remains the same Task in
People, Today and Planner. Linking a note never copies its text into a person's
record. Deleting/archiving a person must not implicitly purge linked notes,
interactions or follow-ups. Missing/tombstoned references need an explicit
presentation and restore policy; duplicate resolution cannot silently drop them.

G01–G08 require validation, migration/upgraders, unknown-field preservation,
reference/deletion behavior, export/restore and deterministic merge tests before
new schemas are accepted. The relevant implementation must update code and this
canonical document together. Detailed gates are in PRODUCT-RESEARCH §7.
