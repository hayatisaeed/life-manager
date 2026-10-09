# Design System

**Direction:** minimal and modern. Calm, content-first, lots of whitespace, one
accent color, and soft depth. It should feel closer to Linear, Things or Notion
than to a dashboard full of widgets. Light, dark and system themes are
first-class: every screen is designed and tested in both.

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
| `--text-muted` | `#63636B` | `#9A9AA3` |
| `--accent` | `#5B5BD6` (indigo) | `#7C7CF0` |
| `--accent-contrast` | `#FFFFFF` | `#0E0F11` |
| `--success` / `--warning` / `--danger` | `#2F9E6A` / `#C98A12` / `#D64545` | `#4CC38A` / `#E5A836` / `#F06A6A` |

- **Area colors:** a fixed set of 10 hues with light and dark variants, tuned
  to similar perceived lightness. They're used for areas, projects and chart
  series.
- **Contrast:** at least 4.5:1 for text and 3:1 for UI elements, in both
  themes. CI checks this with axe.
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
