# Design System

**Direction (2026-10-14):** polished, warm and purposeful. Strong typography,
considered spacing, layered surfaces and useful motion should make the workspace
attractive and easy to read. Each module gets a layout and interaction model
suited to its job; a shared design language connects them. A generic list/form
with a different heading is insufficient. Light, dark and system themes and
Persian RTL are first-class.

The owner's new brief explicitly asks for richer features, distinct module
experiences and more visual appeal. [PRODUCT-RESEARCH.md](PRODUCT-RESEARCH.md)
is the fresh external evidence and module blueprint. Sections 11–12 below
extend this specification; they describe targets, not shipped UI.

**Implementation status:** This document defines the target experience. The
current local web slice implements only part of it; component inventory, bottom
tabs, calendar-aware entry, command palette and accessibility CI are not all
present. See [PRODUCT-RESEARCH.md](PRODUCT-RESEARCH.md) for the current direction and
[UX-RESEARCH.md](UX-RESEARCH.md) for the earlier audit.

**Local web continuity (2026-10-13):** capture is reachable on every screen,
Cmd/Ctrl-K focuses it without changing views, and success is announced. Per-editor
session drafts retain IDs and edited-field sets across navigation; explicit
save/keep/discard actions and before-unload protection distinguish drafts from
saved records. Saves do not discard newer draft revisions or patch untouched
fields. Drafts and running focus state remain memory-only across navigation;
reload recovery is still pending and the UI says so. Today defaults to dated or
scheduled commitments with an opt-in undated backlog. Priorities use named
choices. These changes do not complete the native shell or planning phases.

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
- **Motion:** shared duration/easing/distance tokens and the interaction
  choreography in §12. Honor `prefers-reduced-motion`; timing ranges are targets
  to validate, not currently implemented tokens.

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

- **Immediate feedback with truthful persistence.** Reflect reversible local
  intent promptly. A local write can still fail or take time: show scoped pending
  status when needed, acknowledge success after persistence, and roll back or
  retain the draft on failure. Animation is never proof that data was saved.
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


## 11. Dedicated module experiences

These requirements replace the prototype's shared record-list/editor as the
product-level composition. Share buttons, form fields, date/money inputs,
status patterns and repository hooks. Feature folders own their screens,
reading surfaces, detail layouts and workflow state. A shared row primitive
is useful; a single generic screen is not an acceptable module architecture.

### Visual direction and hierarchy

- Establish an intentional shell: quiet tinted navigation surface, readable
  canvas and elevated detail/editor surfaces. Use semantic surface/elevation
  tokens; dark mode uses luminance and edges rather than oversized shadows.
- Use generous display type for a home or profile introduction, compact headings
  for action lists and bounded readable measure for prose (roughly 60–75 Latin
  characters as an initial target; validate Persian independently). Reading
  width must not constrain a calendar or finance register.
- Balance whitespace with useful density. Offer comfortable and compact list
  density after preference persistence is specified. Avoid sparse empty canvases
  with identical generic text. Desktop lists can be compact while interaction
  targets retain the product's 44px touch requirement.
- Give modules appropriate identity through composition, content, iconography
  and a small semantic accent vocabulary. A person's avatar, a book's progress,
  a timeline's time grid and an account's amount columns are functional anchors.
  Color is a secondary cue and always has a text/icon equivalent.
- Use one coherent icon set, aligned baselines, consistent toolbar heights,
  restrained borders and tested light/dark status colors. Keep Inter/Vazirmatn
  locally bundled; do not introduce a new font or animation library by default.
- Prototype two visual directions with the same realistic content: a warm
  editorial workspace and a crisp compact workspace. Compare clarity, density,
  attractiveness and RTL before selecting the final token refinements. This is
  a design validation task, not a required owner permission step.

### Screen contracts

| Module | Primary composition | Primary actions and useful context |
|---|---|---|
| Today | Agenda with chosen priorities, due actions and a compact focus strip | Plan day, start next action; capacity and reasons for inclusion. |
| Inbox | Capture composer + processing queue + destination preview | Capture, process next, convert/link; source and recoverable processing state. |
| Tasks | Grouped action rows + filters + expandable task detail | Add inline, complete, schedule, bulk move; project/estimate/deadline. |
| Projects/Areas | Portfolio + project brief, task board/list and contextual notes | Define outcome, add next action, review; progress basis and ongoing area responsibilities. |
| Planner | Day/week time grid + unscheduled tray + accessible agenda | Schedule, resize, create event; conflicts, source, timezone and available capacity. |
| People | Directory + avatar/profile header + timeline/notes/follow-up tabs | Add note, log conversation, create follow-up; relationship context and last contact. |
| Notes | Library/list + spacious editor/reader + backlinks | Write, link, find; note context and source navigation. |
| Journal | Calendar/chronology + writing canvas + optional prompt/mood | Write and revisit; day context and private reading. |
| Habits | Due check-ins + period progress + history/heatmap | Log/correct; schedule, target/unit and compassionate feedback. |
| Routines | Step runner + progress + resume controls | Start, check step, pause/resume; optional linked habit action. |
| Focus | Focused timer + selected task + persistent compact controls | Start/pause/finish, record interruption; recovery and time history. |
| Money | Account summary + aligned transaction register + budgets/bills/reports | Record, transfer, categorize, mark paid; exact balance and currency basis. |
| Health | Metric-specific quick inputs + trends + date navigator | Log/correct; units, missing observations and annotation context. |
| Library/Learning | Resource shelf/list + progress/detail + card review runner | Continue resource, take note, review card; source and learning history. |
| Life admin | Due queue + asset dossier + document gallery/list + shopping checklist | Find document, renew, maintain, check off; warranty/expiry/task history. |
| Goals/Review/Insights | Goal milestones + connected work; guided review; drillable reports | Choose next step, reflect, apply changes; explain progress/data completeness. |
| Settings/Data | Grouped settings and recovery center | Configure, export/restore, recover; local/remote/storage status. |

Within a shared shell, these layouts must remain visibly and behaviorally
recognizable with headings hidden. Do not implement this requirement by merely
assigning different colors to the existing list. Alternate views should serve
real tasks and keep one record identity; avoid view toggles that have no useful
purpose.

### Navigation and progressive disclosure

Group desktop navigation into Daily (Today, Inbox, Planner, Tasks), Work &
Direction (Projects, Areas, Goals), Knowledge & People (People, Notes, Journal,
Library) and Life (Habits/Routines, Focus, Money, Health, Admin, Review/Insights).
Use expandable groups/favorites to manage density; Settings and honest storage/
sync state remain anchored and reachable. The group names are design labels
that require en/fa copy review, not hard-coded UI strings.

Keep §5's phone tabs and tablet overlay; More groups every module and favorites.
A phone detail is its own navigable screen, not a narrow desktop panel. Keep
Capture reachable via a compact action/composer; it need not occupy a full row
on every specialized screen. Global search is distinct from contextual filters.

Use task-specific verbs: Add note, Log interaction, Schedule task, Record payment,
Start routine. First-use screens explain the module through a small realistic
example and one action. Populated screens show useful summaries, not filler.
Optional sample data must be explicitly chosen, synthetic and removable; do
not seed a real workspace silently.

## 12. Motion, delight and review

Motion is a product requirement. It explains cause/effect, maintains orientation
and gives completion satisfying feedback. It must remain subtle enough for
all-day use and must never delay input, conceal failure or replace meaning.
[W3C's animation guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
identifies disabling nonessential interaction-triggered motion as SC 2.3.3
(Level AAA). Life Manager adopts this behavior in addition to its AA target;
it is not described as an AA-only criterion.

| Interaction | Intended motion / initial range | Reduced-motion equivalent |
|---|---|---|
| Button, chip and selection feedback | Color/opacity feedback, 100–160ms; no scale on every hover | Immediate state/color update. |
| Task/habit completion | Check/progress feedback, 160–220ms; preserve row briefly before settling | Immediate check and status text with undo; avoid sudden focus loss. |
| Task expansion and detail sheet | Small opacity/transform transition, 180–260ms; origin/context remains legible | Immediate panel or short opacity change without translation. |
| Inbox processing | Selected item settles into destination confirmation, 180–240ms | Accessible confirmation and next queue item; source stays recoverable. |
| Reordering/Kanban | Drag preview, insertion cue and settling, 150–220ms | Static insertion cue, keyboard move action and announcement. |
| Calendar move/resize | Live time/duration preview; brief settling after drop | Immediate placement with textual time/conflict feedback. |
| View/tab changes | Stable shell; small content crossfade, 120–180ms | Immediate content update with heading/focus context. |
| Save/error/undo | Non-blocking status appearance, 120–180ms; persistent recovery when needed | Immediate readable and announced status. |
| Goal/routine milestone | Optional one-shot restrained completion accent, 200–300ms | Plain success/progress update; no confetti requirement. |

Use shared motion tokens (fast/normal/panel, easing and small displacement),
prefer transform/opacity, reserve space and measure expensive layouts. No
infinite decoration, auto-playing illustration, staggered delay on every row,
full-page slide per click or animated timer digits. Timer rings may be static
under reduced motion while actual time stays correct. Respect the system
preference; an optional app setting can further reduce motion, not force motion
against the system preference.

### Design acceptance gate

Before a module is marked complete:

1. Review its primary workflow using realistic synthetic data, not just an
   empty screenshot. Cover long Persian/English content, validation, loading,
   no-results, IO failure and success/recovery states.
2. Compare it with neighboring modules: the shape, primary verb and detail
   context must reflect its job while tokens/components remain consistent.
3. Review 320/390/768/1440px, both themes and directions, keyboard/touch,
   screen-reader announcements, focus restoration and system reduced motion.
   Observe actual animation and interruption; a screenshot cannot prove these.
4. Confirm no animation asserts persistence before acknowledgment and that
   interruption/navigation never loses a draft or duplicates an action.
5. Run the module scenario and the connected journey in PRODUCT-RESEARCH §4–5.
   Record formative usability results against §6 targets when participants are
   available. Failed clarity/recovery checks require iteration, not more fields.

These gates extend existing testing; they do not claim that the prototype
already meets them. Motion/token implementation and rendered prototype review
are still unchecked roadmap work.
