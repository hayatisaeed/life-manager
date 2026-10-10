# Data Model

These are the canonical entity definitions. The zod schemas in
`packages/core/src/entities/` are the source of truth in code and must match
this document. If you change one, change the other in the same PR.

- Schemas are grouped by section in `entities/modules/<section>.ts`.
- They are registered under their envelope `type` in `entities/registry.ts`.
- Type names are the entity names in lower camelCase (`inboxItem`). They are
  part of the record format, so never rename one.
- A test checks that the registry lists exactly the entities in the tables
  below.

## 1. Conventions

- **Every entity** carries the sync envelope fields (SYNC.md §3):
  - `id`: a ULID.
  - `type`, `schema`, `hlc`, `fieldHlc`.
  - `deletedAt`: an `Instant`, or null.
  - `createdAt`: an `Instant`.
  - `conflicts?`: the fields that hold an unresolved text-merge conflict
    (SYNC.md §6).
  - Only `data` is listed below.
- **Optional fields** (`field?`) are left out when empty. They are never
  `undefined` or `null`.
- **Defaults** (such as `alertAtPct` 80) are applied by the UI when a record
  is created, not by the schema. A stored record always has every required
  field.
- **Dates and times:**
  - A date with no time is `LocalDate` (`YYYY-MM-DD`, always in the Gregorian
    proleptic calendar). Jalali is only a display and recurrence concern.
  - A moment in time is `Instant`: UTC with milliseconds, exactly as
    `Date#toISOString` writes it (`2026-10-09T10:15:00.000Z`). Every field
    ending in `At` is an `Instant`.
  - A time of day is `LocalTime` (`HH:mm`).
  - Time zones are IANA names.
- **Money:** `Money = { amount: integer minor units, currency: ISO4217 }`.
- **Attachments:**
  `BlobRef = { hash, size, mime, name? }`.
  - `hash` is the lowercase hex BLAKE2b-256 of the plaintext.
  - That hash is the blob's associated data and its path input (SYNC.md §1).
- **Colors and icons:**
  - `color` is the name of one of the fixed palette hues in DESIGN.md. It is
    never a raw color value.
  - `icon` is a lucide icon name.
- **Tags:** `tags` fields hold **Tag ids**, not names, so renaming a tag
  touches one record.
- **References** are ids (`Ref<Task>`). Cross-module relationships use the
  generic **Link** entity rather than foreign keys, so any entity can link to
  any other.
- **Ordering** uses fractional-index strings (`order: string`). Lists sort by
  `(order, id)` with plain code-unit comparison, so two items that got the same
  key on different devices still sort identically everywhere (ADR-012).
- **Merge kinds:** each entity declares how the merge treats its non-scalar
  fields (`merge` in its definition):
  - `text`: long text, merged with diff3 (SYNC.md §6).
  - `set`: arrays of ids or values.
  - `list`: ordered arrays of objects with `id` and `order`.
  - Undeclared fields are scalars.
- **Long text names:** fields named `body`, `notes` or `content` are always
  `text`, and a test enforces this. Other long text fields, the ones marked
  `body` in the tables (`why`, `done`, `rationale`, …), are declared
  explicitly.
- **Schema evolution:**
  - Bump the entity's `version` and append an upgrader to its `upgraders` list.
    `upgraders[i]` turns schema `i + 1` into `i + 2`.
  - Upgraders must be pure and must not drop fields they don't recognize. Keep
    them under `data._unknown`.
  - An upgrader that renames a field also renames its `fieldHlc` key.
  - Decoding moves any field the schema doesn't define into `_unknown`, so
    validation never strips data.
  - Nested objects are strict: an unknown key inside one makes the record
    `invalidData`, and the raw record is kept (SYNC.md §3).

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
| **Task** | `title, notes, projectId?, parentId?, areaId?, goalId?, milestoneId?, priority, status: 'todo'\|'doing'\|'done'\|'cancelled', dueDate?: LocalDate, dueTime?: LocalTime (needs dueDate), scheduledAt?: Instant, estimateMin?, recurrence?, recurrenceOf?: Ref<Task>, reminders: Reminder[], tags: Ref<Tag>[], completedAt?, order` |
| **Goal** | `title, why: body, areaId?, targetDate?: LocalDate, status: 'active'\|'onHold'\|'done'\|'dropped', progressMode: 'milestones'\|'tasks'\|'manual', manualProgress?: 0–100 (percent)` |
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
| **PlanProposal** | `range: {start,end}, blocks: ({id} & Omit<TimeBlock,'proposalId'>)[], rationale: body, provider, status: 'pending'\|'accepted'\|'discarded', acceptedBlockIds` |
| **Insight** | `period: {start,end}, kind: 'weekly'\|'correlation'\|'wheel', payload: json, narrative?: body` |

- A proposed block's `id` becomes the id of the TimeBlock created when the
  user accepts it. `acceptedBlockIds` lists those ids.

## 14. Settings

- **Account settings** sync as a single `settings` record. It always has the
  id `00000000000000000000000000` (`SETTINGS_ID`), so two devices that create
  it offline produce one record that merges, not two. Its data:

  ```ts
  { language: 'en'|'fa', calendar: CalendarSystem, weekStart: 0–6,
    digits: 'latin'|'native', baseCurrency: ISO4217,
    theme: 'system'|'light'|'dark',
    workingHours: {weekday, start: LocalTime, end: LocalTime}[],
    energyProfile: {start, end, level: 'low'|'medium'|'high'}[],
    lifeWheelAreaIds: Ref<Area>[],
    ai: { excludedModules: string[] } }    // "never send" modules (ARCHITECTURE.md §11)
  ```
- **Device settings** never sync: per-device reminder categories, the sync
  interval, connectors, and secrets.
