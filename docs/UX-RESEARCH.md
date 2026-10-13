# UI/UX audit and feature opportunities

Research date: **2026-10-13**. Scope: the current local web workspace, not a
released native client. This is an expert inspection and desk research, not
interviews, a usability study, a security audit, or proof of market demand.
Recommendations below are planned work; no feature is implemented by this report.

## 1. Product diagnosis

Life Manager has broad coverage but shallow workflows. A user can create many
kinds of records, yet cannot reliably move through **capture → organize → plan →
do → review → recover**. More unrelated modules would increase navigation and
maintenance costs before making the app feel complete.

The strongest direction is a private daily workspace that connects commitments,
knowledge, people and life admin. Finish that daily loop first, then deepen the
modules. Keep the existing no-server, ciphertext-only forge, no-telemetry and
user-approved AI constraints. Competitor features inform interaction ideas;
their hosting, subscriptions and integrations are not architecture proposals.

### Evidence and limitations

- Read STATUS, ROADMAP, DESIGN, ARCHITECTURE, DATA-MODEL, SECURITY and DECISIONS,
  and inspected App, Editor, Focus, module definitions, tokens, repository API
  and the existing Playwright smoke suite.
- Audited the running app in the internal browser at an isolated local origin
  with synthetic data. Reviewed English light desktop (1440×900), Persian dark
  phone (390×844), and English dark tablet (768×900).
- Reproduced an undated task appearing on Today, a draft disappearing after
  navigating away, an active focus session resetting after navigation, and
  priority `99` producing a generic save error while retaining the form input.
- Inspected onboarding, task editing, Planner, Focus and Settings. The remaining
  module observations are source-backed, not individually exercised end to end.
- No real personal data, forge data repository, native device, assistive
  technology, large dataset, offline reload or authenticated sync was tested.
  No axe audit or WCAG conformance claim is made. Existing smoke tests mainly
  cover CRUD and overflow, not workflow continuity or accessibility.

Source evidence: [App](../packages/ui/src/app/App.tsx),
[Editor](../packages/ui/src/features/workspace/Editor.tsx),
[Focus](../packages/ui/src/features/workspace/Focus.tsx),
[modules](../packages/ui/src/features/workspace/modules.ts),
[tokens](../packages/ui/src/theme/tokens.css),
[repository](../packages/db/src/index.ts),
[smoke tests](../apps/web/e2e/smoke.spec.ts).

## 2. UI/UX findings

Priority means **user impact**, not a claim of measured frequency:
**P0** = continuity or recovery risk; **P1** = blocks a core daily workflow;
**P2** = quality or depth improvement. B = browser reproduced/observed;
S = source confirmed; H = hypothesis needing user validation.

| ID | Priority / evidence | Problem and consequence | Proposed correction / verification |
| --- | --- | --- | --- |
| U01 | P0 · B+S | Editor state belongs to a mounted form; navigation and Escape close it. Unsaved writing can disappear without explanation. | Keep a recoverable draft or ask before discarding dirty input. Test navigation, Escape, Cancel, reload recovery and save failure; distinguish drafts from saved records. |
| U02 | P0 · B+S | Focus state is component-local. Leaving the page resets the running timer before a session is recorded. | Keep the active session outside the screen lifecycle; specify interruption/reload recovery. Show a persistent running indicator and prevent duplicate Finish writes. |
| U03 | P0 · B+S | Settings exports plaintext JSON but has no restore flow. Browser storage clearing can remove the only usable copy. | Ship validated restore preview and rollback before presenting export as a complete backup solution. Show storage and backup guidance; preserve unknown records. |
| U04 | P1 · B+S | Fifteen same-level destinations compete for attention. On phone most are outside the visible navigation strip, and local status is hidden. | Implement DESIGN §5 bottom tabs/More, tablet overlay and grouped desktop navigation. Test finding Notes/Settings with touch and keyboard; retain storage status on mobile. |
| U05 | P1 · B+S | Today includes every open undated task, with four global counts but no agenda or habit actions. Backlog can overwhelm daily priorities. | Separate overdue, due today, scheduled today and optional next actions; show agenda and due habits. Cap the suggested priorities with an explicit Show all action. |
| U06 | P1 · B+S | Planner is an event CRUD list rather than a calendar. It cannot expose free time, conflicts or task allocation. | Day/week timeline plus an accessible agenda; integrate TimeBlocks and tasks using existing schemas. Test keyboard scheduling, overlaps, time zones and both calendars. |
| U07 | P1 · S | Task editors lack project/area/tag assignment, subtasks, estimates, recurrence and useful filters despite domain support. Projects are disconnected records. | Finish P1.2 relations and detail views; make linked tasks visible from projects and goals. Separate completed work from active work. |
| U08 | P1 · B+S | Search is honestly labelled “Search this view,” but only scans serialized current-module data. It is also shown on screens where it has no visible result list. | Add local global search through repository FTS, with type/context labels and open-result navigation. Retain an explicitly scoped list filter; hide irrelevant filters. |
| U09 | P1 · B+S | Priority accepts arbitrary numbers; `99` reaches schema rejection and a generic error. Numeric money entry asks users for minor units and accepts decimal input in the form. | Named priority choices and field-level validation. Format ordinary currency input into exact integer minor units; explain currency/sign. Never silently round invalid money. |
| U10 | P1 · B+S | Jalali display and Persian digits work, but date input remains Gregorian. The hint is honest, yet users still have to translate their intended date. | Calendar-aware picker/text entry, localized examples and explicit calendar selection independent of language; test leap dates, clearing and round trips. |
| U11 | P1 · S | Inbox conversion only creates a task then removes the source in separate operations. There is no choice of destination or visible processing flow. | Preview task/note/event/interaction conversions; specify atomic or recoverable conversion so retry cannot duplicate or lose the source. Keep capture accessible everywhere. |
| U12 | P1 · B+S | Fresh-use empty text is reused for no results and every module. Loading can coexist with empty-looking content. Users receive little guidance about the next useful action. | Separate loading, first use, no results, unavailable and failure states. Give each module one relevant action; announce capture/save success without moving focus. |
| U13 | P1 · S | Habit logs are daily boolean only. A logged habit cannot be corrected from the UI; schedule, counts, skips and history are absent. | Editable logs, flexible due schedules and a gentle consistency view. Completion and correction must be keyboard/touch accessible and tested. |
| U14 | P2 · S | Notes use a textarea and plain rendered text; long bodies become nested scrolling regions. No reading detail, Markdown preview, links or backlinks are exposed. | Full reading/editing detail, safe Markdown and contextual links, then templates. Preserve original text and disable raw HTML as specified. |
| U15 | P2 · S | Money, People, Library, Admin and Goals mainly expose generic forms. Balance/budget decisions, follow-ups, reading progress, expiry and linked goal progress are missing. | Deepen each module around a useful outcome, as in §4, instead of adding more generic record types. |
| U16 | P1 · S | Navigation uses React state rather than URLs. Refresh returns to Today and browser Back cannot restore a selected module/detail. Inline editors do not establish a complete focus-management pattern. | Use the specified router for routable views/details; restore focus to the opener and expose unique row action names. Test Back, refresh, keyboard and deep links. |
| U17 | P2 · B+S+H | Visuals are calm and readable, but global counts, generic subtitles and repeated Add buttons do not explain each module's purpose or next step. | Outcome-specific headings and action labels; use space for context rather than more dashboard tiles. Validate hierarchy with first-use task tests. |
| U18 | P1 · S | Whole-workspace list/load and JSON filtering run in the UI; no paging or virtualization is exposed. Large-workspace responsiveness is unknown. | Benchmark realistic long notes and 10k+ records; use indexed query/paging when measured results justify it. This is a risk, not an observed slowdown. |

### Preserve what already works

Keep local persistence, honest “local only” wording, en/fa catalogs, independently
selectable language/calendar/digits, bundled Inter/Vazirmatn, semantic colors,
visible focus rings, 44px button heights, mixed-direction content, deletion undo
and plaintext-export disclosure. No contrast or tiny-target failure was established
by this inspection. Add keyboard, screen-reader, reflow and contrast checks before
claiming accessibility compliance.

The proposed navigation hierarchy and richer contextual actions follow NN/G's
recognition, consistency and error-recovery heuristics; grouping and optional
advanced controls also follow progressive disclosure. These are design grounds,
not evidence that a particular user will prefer the proposal. [S1, S2]

## 3. Comparative research

Official product documentation establishes available patterns; it does not prove
that copying a feature improves Life Manager. Source-derived summaries below are
intentionally narrow. Recommendations are our inference.

| Reference | Documented pattern | Implication for Life Manager |
| --- | --- | --- |
| Things [S7] | Today/Upcoming/Anytime/Someday separate when work becomes relevant; start dates differ from deadlines. | Keep backlog out of Today and explain planned time versus due date using the existing task schedule model. |
| Todoist [S8] | Calendar layouts visualize work in time; documentation includes weekly/monthly and mobile agenda views. | Offer timeline and agenda choices with equivalent scheduling actions. Do not copy paid gating or assume external calendar support already works. |
| Obsidian [S9, S10] | Backlinks show linked and unlinked mentions; templates insert reusable text. | Let notes connect to people/projects and reduce repeated writing with safe local templates. |
| Actual Budget [S11, S12] | Documents data export/backups and an envelope budgeting workflow. | Add restore and understandable account/category/budget feedback. Do not adopt its server architecture or change the existing budget model implicitly. |
| Monica [S13] | Presents interaction history, relationship context, important dates and follow-up reminders. Its page separates future v3 plans. | Complete personal CRM around remembering and following up; avoid social ranking, feeds and unverified future-feature claims. |

Accessibility gates should draw on WCAG 2.2: status updates must be available to
assistive technology, focus must remain discoverable, and content should reflow
at 320 CSS pixels. WCAG AA target-size minimum is generally 24×24 CSS pixels
with exceptions; Life Manager deliberately sets a stronger 44×44 product target.
Axe alone cannot verify all of these requirements. [S3–S6]

Browser persistence can be affected by quotas and eviction rules. Recovery and
clear storage messaging are core product requirements for an offline-first web
app; installation is not a substitute for backups. [S14]

## 4. Potential features and prioritization

**A** = finish an existing roadmap promise; **B** = newly scoped improvement;
**C** = exploratory candidate requiring a separate design decision.
Effort S/M/L is relative scope, not a time estimate. Confidence reflects the
inspection and product fit, not user-demand measurement. Order favors dependency
readiness, everyday value and preservation over novelty. All operate locally;
existing optional providers/connectors remain opt-in.

| ID | Feature and user outcome | Class / priority / effort / confidence | Owner milestone and dependencies |
| --- | --- | --- | --- |
| F01 | Recoverable drafts and a continuous focus session: leave a screen without losing work. | B · now · M · high | P0.7 / P3.4; web DB available; lifecycle/recovery design first. |
| F02 | Backup restore preview, rollback and a recovery center with Trash: recover mistakes beyond the last toast. | B · now · L · high | P0.5 / P9.1; tombstones/export exist; specify restore validation and recovery before implementation. |
| F03 | Persistent mobile Capture and More, grouped navigation, routable details and contextual empty states. | A+B · now · M · high | P0.7 / P1.1; existing shell and catalogs. |
| F04 | Global local search/command palette: find a note, person, task or command without knowing its module. | A · next · M · high | P0.7 / P2.2; repository FTS exists, routing/result opening needed. |
| F05 | Today agenda, selected priorities and due habits: answer “what should I do now?” | A · next · M · high | P1.2 / P1.3 / P3.1; task scheduling and habit due rules. |
| F06 | Project/task detail, subtasks, tags, estimates, recurrence and bulk edits: finish a project rather than store its name. | A · next · L · high | P1.2; accepted schemas and recurrence coverage. |
| F07 | Day/week planning with keyboard time blocking and capacity/overlap feedback. | A+B · next · L · high | P1.3; TimeBlock, estimates and calendar-aware date/time controls. Capacity display starts as derived local data. |
| F08 | Typed Inbox processing with preview and recoverable conversion. | A+B · next · M · high | P1.1; destination editors and repository transaction/retry design. |
| F09 | Local reminders with quiet hours, snooze and a digest; honest capability/permission status. | A · next · L · high | P1.4 / P0.7 platform adapters; web tab-open limits remain explicit. |
| F10 | Guided weekly review: resolve stale Inbox items, unfinished commitments and next week's priorities. | A · deepen · M · high | P3.3; completed tasks, focus/history and planning. |
| F11 | Habits with schedules, editable count/boolean logs, heatmap, skips and routine runner. | A · deepen · L · high | P3.1 / P3.2; recurrence, HabitLog, RoutineRun and tested streak policy. |
| F12 | Markdown reading/editing, backlinks and contextual person/project links. | A · deepen · L · high | P2.2; safe renderer/editor and existing Link relationships. |
| F13 | Local templates for notes, journals, reviews and task checklists; preview before inserting. | B · deepen · M · medium | P2.2 / P2.3 / P3.3; template persistence/version rules need specification. Start with bundled localized text. |
| F14 | Account balances, category budgets, transfers, bills and savings progress with ordinary currency entry. | A · deepen · L · high | P4.1–P4.4; MoneyInput, exact minor units, transfer and FX rules. |
| F15 | People timeline, quick interaction logging, follow-up tasks and calendar-aware birthdays. | A · deepen · L · high | P2.1; Interaction, ImportantDate, Link and reminders. |
| F16 | Reading/course progress and note-to-flashcard review: turn saved resources into learning. | A · deepen · L · medium | P5.3 / P5.4; Resource progress, Deck/Card/ReviewLog and FSRS tests. |
| F17 | Document expiry, encrypted attachments, maintenance tasks and reusable shopping lists. | A · deepen · L · high | P6.1–P6.3; encrypted blob persistence before sensitive uploads; reminders. |
| F18 | Goal detail with milestones and linked progress: show evidence of progress rather than a manually entered percentage alone. | A · deepen · M · high | P6.4; Milestone and task/goal relations. |
| F19 | User-selected module visibility, favorites and saved views: reduce navigation to the user's actual needs. | B · later · M · medium | P0.7 / P1.2; start device-local; specify settings schema before syncing definitions. Hidden modules must retain data and remain searchable. |
| F20 | Deterministic en/fa capture helpers: preview parsed dates, tags and destinations without requiring AI. | B · later · L · medium | P1.1; Jalali/digits parser fixtures and explicit ambiguity handling. Remote AI remains P8 and user-initiated. |
| F21 | Import preview, duplicate detection and mapping: migrate existing habits/tasks/notes/contacts/CSV safely. | A+B · later · L · high | P9.2; each importer needs parse/validate/preview/accept and safe retry. No silent replacement. |
| F22 | Weekly local insights with sample-size/coverage explanations, plus optional accepted AI proposals. | A · later · L · medium | P5.2 / P8; complete stats validation and privacy previews first. No causal health claims. |
| F23 | Task dependencies/waiting-for and saved constraint views: surface blocked work. | C · explore · L · low | Candidate extension to P1.2; data/merge/cycle semantics are not yet specified. Existing todo/doing/done/cancelled remain unchanged. |
| F24 | Transaction reconciliation and repeat-entry rules: explain account discrepancies and reduce manual finance work. | C · explore · L · medium | Candidate extension to P4/P9.2; reconciliation metadata, duplicates and rule audit/undo need a schema/merge proposal. No bank credential service. |

### Recommended delivery sequence

1. **Make current work trustworthy.** F01–F03, U09 field validation and U10 date
   entry. Parallel product planning can continue, but external/native foundation
   spikes remain the first unchecked engineering milestone (P0.2).
2. **Complete the daily planning loop.** F04–F09 plus the existing sync/onboarding
   foundation when its contract tests and simulator can be run. Local daily
   planning must be useful without connecting a forge.
3. **Connect and deepen the existing modules.** F10–F18. Ship one complete
   outcome per PR; People and Money do not need to wait for an AI layer.
4. **Personalize and expand carefully.** F19–F22, then validate F23/F24 before
   adding fields or implementing them.

Do not add shared workspaces, server relays, background web push servers, social
feeds, remote analytics, automatic bank aggregation or autonomous AI mutations.
Those conflict with the accepted architecture or add risk without resolving the
observed daily-loop gaps. This plan adds no paid dependency or external service.

## 5. Concrete acceptance gates

These are proposed product gates, not tests that already pass. ROADMAP owns
implementation checkboxes and DESIGN owns interaction requirements.

### Continuity and recovery

- Enter a long note, switch modules and return: the draft survives or an explicit
  discard decision occurs. Failed save keeps values, marks the failing field and
  offers retry. Successful save visibly separates saved content from a draft.
- Start focus, navigate, return and reload: the active session can be recovered
  under a documented policy; Finish stores one session with correct pauses.
- Export synthetic data and restore into a fresh workspace: preview identifies
  record counts, unsupported schemas and duplicates; existing data is not
  silently overwritten. Cancel changes nothing; interrupted apply has rollback
  or a documented resumable recovery. Verify relationships and unknown records.
- Delete multiple items and dismiss undo: Trash can restore each without
  destroying later edits. Purge/compaction remains governed by the sync protocol,
  not introduced as a convenient UI cleanup.

### Everyday planning

- Today keeps undated backlog separate, shows agenda/due habits, and lets the
  user choose priorities without changing a deadline as a side effect.
- Capture an item from any screen; convert it to a chosen supported destination;
  open it there. Retry after a partial failure cannot create duplicates.
- Find a note/person/task across modules in both languages; open its detail;
  browser Back restores the preceding view. Empty query/results have useful
  states, and unavailable actions explain their prerequisites.
- Assign a task to a project, estimate it, schedule it by keyboard, detect an
  overlap, complete it and inspect the project's progress. Include Jalali month
  boundaries, all-day events, DST and time-zone cases where applicable.

### Responsive and accessible experience

- Exercise desktop, tablet, 390px and 320px phone layouts in light/dark and en/fa,
  long mixed-direction text, enlarged text and reduced motion.
- Keyboard users can capture, edit, schedule, save, cancel and recover. Focus
  moves predictably; overlays do not obscure focused actions. Drag is optional.
- Buttons have specific names in context; form errors identify fields and
  remedies; save/log/status changes are announced without reading the timer
  every second. Validate contrast and product touch targets.
- Run axe plus manual keyboard and screen-reader checks. Passing overflow smoke
  tests alone does not establish reflow or accessibility compliance.
- Benchmark search and list interaction with a reproducible synthetic large
  workspace. Record device/dataset/latency before setting performance budgets.

## 6. User research to validate the proposals

Recruit a small formative round of 5–8 consenting people covering en/fa, phone
and desktop, keyboard usage, Jalali date entry and differing module needs. This
is a practical starting round, not a statistically representative sample. Use
synthetic data and local recordings only with explicit participant consent.

Ask participants to capture and process an idea, plan three commitments, find a
note in another module, record/correct a habit, leave a draft and recover it,
resume focus, and export/restore a workspace. Record completion, wrong turns,
help requests, confidence and why they abandoned a flow. Ask which current tools
this would replace and which modules they would hide. Compare the proposed
navigation with the present strip; do not treat competitor popularity as demand.

Working hypotheses: Today should be smaller than the backlog; recovery increases
trust; cross-module links reduce repeated entry; customizable navigation reduces
first-use overload. Reject or revise any hypothesis the sessions contradict.
Success targets can be set after the baseline round. No production telemetry is
required or proposed.

## 7. Sources

All accessed **2026-10-13**. Product capabilities can change; these links support
the narrow observations above, not a permanent feature inventory.

- **S1:** [NN/G — 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/).
- **S2:** [NN/G — Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/).
- **S3:** [W3C — Target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- **S4:** [W3C — Status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
- **S5:** [W3C — Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
- **S6:** [W3C — Focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).
- **S7:** [Things — Scheduling to-dos](https://culturedcode.com/things/support/articles/2803579/).
- **S8:** [Todoist — Calendar layout](https://www.todoist.com/help/todoist/features/use-the-calendar-layout-in-todoist-lPHRQTu0o).
- **S9:** [Obsidian — Backlinks](https://obsidian.md/help/plugins/backlinks).
- **S10:** [Obsidian — Templates](https://obsidian.md/help/plugins/templates).
- **S11:** [Actual Budget — Backups](https://actualbudget.org/docs/backup-restore/backup/).
- **S12:** [Actual Budget — Envelope budgeting](https://actualbudget.org/docs/getting-started/envelope-budgeting/).
- **S13:** [Monica — Personal CRM](https://www.monicahq.com/en/).
- **S14:** [MDN — Storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
