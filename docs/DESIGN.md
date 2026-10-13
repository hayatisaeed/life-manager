# Design System

**Direction:** minimal and modern. Calm, content-first, lots of whitespace, one
accent color, and soft depth. It should feel closer to Linear, Things or Notion
than to a dashboard full of widgets. Light, dark and system themes are
first-class: every screen is designed and tested in both.

**Implementation status:** This document defines the target experience. The
current local web slice implements only part of it; component inventory, bottom
tabs, calendar-aware entry, command palette and accessibility CI are not all
present. See [UX-RESEARCH.md](UX-RESEARCH.md) for observed gaps and priorities.

## 1. Principles

1. **Content over chrome.** Borders and backgrounds separate content only when
   spacing can't.
2. **One primary action per screen.** Secondary actions go in menus or ⌘K.
3. **Fast capture everywhere.** Quick add is never more than one keystroke or
   tap away.
4. **Calm by default.** No red badges for counts. Reminders are gentle. Use
   color for meaning, not decoration.
5. **Keyboard-first on desktop, thumb-first on mobile.**
6. **RTL and LTR are equal.** No layout may break when mirrored.

## 2. Tokens

Tokens are CSS custom properties in `packages/ui/src/theme/tokens.css` and
mapped into Tailwind v4 `@theme`. **Components use semantic tokens only, never
raw colors.**

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#FFFFFF` | `#0E0F11` |
| `--bg-subtle` | `#F7F7F8` | `#16171A` |
| `--bg-muted` | `#EFEFF1` | `#1E1F23` |
| `--border` | `#E4E4E7` | `#2A2B30` |
| `--text` | `#18181B` | `#EDEDEF` |
| `--text-muted` | `#63636B` | `#A2A2AC` |
| `--accent` | `#5B5BD6` (indigo) | `#9090F5` |
| `--accent-contrast` | `#FFFFFF` | `#0E0F11` |
| `--success` / `--danger` | `#247950` / `#BE3333` | `#4CC38A` / `#F06A6A` |

- **Warning token:** planned; define and verify contrast before first use.
- **Area colors:** a fixed set of 10 hues with light and dark variants, tuned
  to similar perceived lightness. They're used for areas, projects and chart
  series.
- **Contrast:** at least 4.5:1 for text and 3:1 for UI elements, in both
  themes. Automated axe checks and manual review are required acceptance
  checks; axe is not yet wired into the current smoke suite.
- **Radius:** `--radius-sm 6px`, `--radius 10px`, `--radius-lg 14px`.
- **Shadows:** soft in light mode. Dark mode uses a slightly lighter surface
  plus a 1px border instead of a shadow.
- **Spacing:** a 4px base grid; most layout uses 8, 12, 16, 24 and 32.
- **Motion:** 150–200ms ease-out for UI, 250ms for panels. Respect
  `prefers-reduced-motion`.

## 3. Typography

- **Latin:** Inter (variable, bundled locally; never loaded from Google Fonts).
- **Persian:** Vazirmatn (variable, bundled locally).
- Font stacks are chosen by `lang`. Numbers use tabular figures in tables and
  timers.
- **Scale:**

  | Name | Size / line height | Weight |
  |---|---|---|
  | display | 28/34 | 600 |
  | title | 20/28 | 600 |
  | heading | 16/24 | 600 |
  | body | 14/22 | 400 |
  | small | 12/18 | 400 |

  Mobile body text is 16px.

## 4. Theming

- `theme` setting: `'system' | 'light' | 'dark'`. It sets
  `data-theme="light|dark"` on `<html>`, resolving `system` through
  `matchMedia`.
- Native shells follow the theme too: Tauri window theme, Android status and
  navigation bar colors.
- Charts read their colors from tokens, so they switch themes automatically.

## 5. Layout

- **Desktop / wide (≥ 1024px):**
  - Collapsible left **sidebar**: Today, Inbox, Planner, Tasks, Habits, Money,
    Health, Notes, People, Library, Admin, Insights, then Settings.
  - Main content.
  - An optional right **detail panel** for the selected item.
- **Tablet (640–1023px):** the sidebar becomes an overlay, and detail opens as a
  sheet.
- **Mobile (< 640px):**
  - A **bottom tab bar** with 5 tabs: Today, Planner, ＋ Capture, People, More.
  - Detail views push as full screens. Bottom sheets hold editors.
  - Safe-area insets are respected.
- **Today screen** (the home screen):
  - A greeting with the date in the user's calendar system.
  - Agenda (timeline), top 3 tasks, habits due, routine checklist, and
    nudges (birthdays, people to contact, bills due, expiring documents).
- **⌘K command palette** (desktop and web): search everything, run commands,
  and quick-add with natural language.

## 6. Components (`packages/ui/src/components`)

- **Built on Radix primitives:** Button, IconButton, Input, Textarea, Select,
  Combobox, Checkbox, Switch, RadioGroup, DatePicker (calendar-system aware),
  TimePicker, Dialog, Sheet, Popover, Tooltip, DropdownMenu, ContextMenu, Tabs,
  Toast, Avatar, Badge, Tag, EmptyState, Skeleton, ProgressRing, ProgressBar,
  Stat, Sparkline, Chart wrappers, Timeline, Kanban, ListRow,
  CommandPalette, MarkdownEditor, MarkdownView, Rating, MoneyInput,
  DurationInput.
- **Icons:** lucide-react, 1.5px stroke, 16px or 20px. Icons that imply
  direction get the `rtl-flip` class.
- **Every component has stories** (Ladle or Storybook) in light and dark, LTR
  and RTL.

## 7. Interaction patterns

- **Optimistic UI everywhere.** Writes are local, so they are instant. Never
  show a spinner for a local write.
- **Undo toast** for destructive actions instead of confirmation dialogs.
  Confirm only irreversible actions such as wiping data or compaction.
- **Drag and drop** (dnd-kit) for time-blocking, reordering, Kanban and
  inbox → project. There is a keyboard alternative for every drag.
- **Empty states** teach the feature in one sentence and offer one action.
- **Sync status** is a small pill in the sidebar footer, or a status dot on
  mobile.

## 8. RTL & localization rules

- Use logical properties only (`ms-*`, `me-*`, `ps-*`, `start-*`). Physical
  `left`/`right` are banned by lint rule.
- Numbers, money, durations and dates always go through `@lm/i18n` formatters.
- The timeline time axis follows reading direction. Charts keep time flowing
  start → end.
- Mixed-direction text uses `dir="auto"` on user-content elements.

## 9. Accessibility

- Every interactive element is reachable by keyboard and has a visible focus
  ring (`--accent`, 2px offset).
- Screen-reader labels go through i18n. Drag-and-drop has keyboard and
  screen-reader announcements.
- The minimum touch target is 44×44px.

## 10. Workflow requirements from the 2026-10-13 audit

These are **planned acceptance requirements**, not claims about current behavior.
Finding IDs refer to [UX-RESEARCH.md §2](UX-RESEARCH.md#2-uiux-findings).

### Navigation, capture and search (U04, U08, U11, U16)

- Preserve §5's mobile tabs and tablet overlay. Group desktop destinations into
  Planning, Knowledge & People, and Life; keep Today, Inbox and Settings easy to
  find. More exposes every module without deleting or hiding its data.
- Capture remains reachable from every screen. Desktop shortcuts and a visible
  button open the same flow. Until global search ships, describe a list filter
  as a filter and omit it from screens it cannot affect.
- Global search opens local results with type, title and enough context to
  recognize them. Commands and results have keyboard navigation and translated
  labels. Preserve position and focus when returning from detail.
- Use routable module/detail views with the specified router. Back and refresh
  restore the view; native deep links follow platform capabilities.
- Conversion names the destination and previews the result. The UI reports
  completed conversion only after the source/destination recovery guarantees
  hold; persistence semantics belong to the repository and domain specs.

### Today and planning (U05, U06, U07, U13)

- Separate overdue and due-today commitments from optional undated next actions.
  An undated backlog does not automatically become today's agenda.
- Put a compact agenda, a small chosen priority list and due habit actions above
  global statistics. Show all opens the full list. Avoid punitive streak/count
  badges; display why something appears today.
- Distinguish a deadline from planned work time. Scheduling never silently moves
  a deadline. Planner offers an accessible agenda alongside timeline views,
  explicit time zone, calendar-aware dates and keyboard scheduling/resizing.
- Show project/area relations and status in task detail. Completed/archived work
  stays retrievable but is separated from active work.
- Habit logging supports correction; due state follows the schedule, not merely
  the presence of a Habit record. Routine and history views follow P3.

### Editors, validation and continuity (U01, U02, U09, U10, U14)

- Dirty input survives navigation or triggers an explicit discard choice. Escape
  and Cancel obey the same policy. Recovery after reload must be designed before
  claiming durable drafts; drafts are distinct from accepted saved records.
- Opening an editor establishes focus; closing it returns focus to the opener.
  Repeated row actions include the record title in their accessible names.
- Validate at the field and schema boundaries. Use named priorities, constrained
  values and actionable field errors. Failed saves retain entered values.
- MoneyInput accepts human-readable amounts and converts exactly to integer
  minor units according to currency. Never silently round excess decimals;
  display sign/currency meaning and support the specified IRR/Toman convention.
- Date entry follows the selected calendar independently of language and digits.
  Native Gregorian-only inputs remain clearly labelled until replaced.
- Reading details accommodate long content without forcing a small nested scroll
  region. Markdown uses the specified safe renderer; raw HTML stays disabled.
- An active focus timer remains discoverable across navigation. Interrupted
  sessions expose recovery rather than silently restarting. Save/Finish pending
  states prevent duplicate submissions and announce the actual result.

### Trust, states and recovery (U03, U12, U17, U18)

- Expose local storage status on phone as well as desktop. Distinguish local
  save, offline shell availability, configured sync and successful remote sync;
  none implies another. “Encrypted sync” never implies encrypted local SQLite.
- First-use emptiness explains the module and one useful action. No-result states
  offer clearing filters. Loading does not present an authoritative zero count
  or empty list; unavailable capability states name their prerequisite.
- Give capture/save/log success concise accessible feedback. Recoverable IO errors
  explain the next step and retain input; do not expose secrets or record dumps.
- Settings → Data provides export, restore preview, backup guidance and Trash as
  those features ship. Plaintext export is labelled before download. Restore
  cannot silently overwrite data; purge and compaction remain separate protocols.
- Large collections use measured query and rendering improvements. Benchmark
  before choosing virtualization; keyboard access and result context survive it.

### Review gate

For each implemented workflow, verify light/dark, en/fa, keyboard/touch,
320px reflow, tablet, long mixed-direction content, focus, status announcements,
contrast and reduced motion. Retain the 44×44px product touch-target requirement.
WCAG 2.2 AA is the accessibility target; automated checks supplement manual
screen-reader and keyboard review. An overflow test or screenshot is insufficient
on its own. Full workflow gates and formative research tasks are in
[UX-RESEARCH.md §§5–6](UX-RESEARCH.md#5-concrete-acceptance-gates).
