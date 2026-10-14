# Life Manager product research and expansion brief

2026-10-14 · Fresh external research commissioned by the owner.

## 1. Outcome and method

Life Manager should become a polished personal workspace with dedicated tools
for planning, relationships, knowledge, wellbeing and life administration.
Each module must have a recognizable purpose, useful depth and a complete
workflow. Shared styling should make these tools feel related; it should not
make them behave like the same database form.

This brief starts from external product research and the owner's experience,
rather than treating the previous project specification as a feature ceiling.
The earlier [UX audit](UX-RESEARCH.md) remains useful historical evidence.
This document establishes the new product direction; [DESIGN.md](DESIGN.md)
defines its presentation and [ROADMAP.md](ROADMAP.md) tracks delivery.

**Evidence:** official product pages, help manuals and a primary open-source
repository for 19 product references; direct inspection of the running local
app and its UI source. Links below were accessed on 2026-10-14. Competitor
features are documented capabilities, not results from hands-on trials or
claims that every plan/platform supports them. Vendor claims do not prove
usability, reliability or encryption equivalence. Historical material is
labelled. We did not create competitor accounts, run user interviews, compare
prices or collect personal data.

**Interpretation:** recommendations, release order and usability targets below
are our product judgments. They need prototype and participant validation.
The no-server, offline-first, encrypted-forge, en/fa and Jalali constraints
remain product commitments. Borrow workflows without importing a vendor's
hosting, automatic ingestion, telemetry or AI behavior.

## 2. What the market teaches us

There are several useful product families rather than one ideal “life app.”
Action managers optimize capture and execution. Planners make time and capacity
visible. Knowledge tools support writing and retrieval. Personal CRMs preserve
relationship context. Finance, health and learning tools need their own
measurement and review surfaces. An integrated product should connect these
families while retaining their specialized interactions.

| Reference and primary evidence | Documented pattern | Application to Life Manager |
|---|---|---|
| [Things](https://culturedcode.com/things/features/) | Today/Upcoming, project headings, checklists and progressive disclosure; the feature page illustrates smooth expansion of a task. | Quiet action lists with inline details; structure projects without requiring every field at capture time. |
| [Todoist filters](https://www.todoist.com/help/todoist/features/introduction-to-filters-V98wIH) | Custom task views combine dates, projects, labels and priority; date and deadline queries are distinct. | A visual filter builder, named saved views and clear planned-time/deadline semantics. |
| [TickTick](https://ticktick.com/?language=en_us) | Tasks, multiple calendar views, Pomodoro, habits, recurring reminders and statistics. | A connected daily loop, with dedicated calendar, habit and focus surfaces. |
| [Sunsama daily planning](https://help.sunsama.com/docs/usage-guides/daily-planning/) and [timeboxing](https://www.sunsama.com/features/timeboxing) | Guided planning, predicted workload and calendar timeboxing. | Plan a realistic day, estimate work, show capacity and offer an intentional shutdown/review. |
| [Amie tasks documentation](https://amie.so/documentation/features/tasks) | Task/calendar integration, duration, recurrence, shortcuts and time-slot drag/resize. | Direct scheduling with an equivalent keyboard flow. Its current homepage emphasizes meeting notes; this task manual is a workflow reference, not a claim about its current product focus. |
| [Linear projects](https://linear.app/docs/projects) and [milestones](https://linear.app/docs/project-milestones) | Project overview, resources, related issues and milestones; multiple project views. | An outcome-oriented project workspace with brief, linked notes and task progress. Avoid team-management overhead. |
| [Notion projects and tasks](https://www.notion.com/en-gb/help/guides/getting-started-with-projects-and-tasks) | Related projects/tasks, completion rollups and contextual board/table/timeline views. | Reuse records in context rather than creating disconnected copies. Offer useful defaults before customization. |
| [Monica](https://www.monicahq.com/en/features/) | Private contact notes, calls, relationships, important dates, gifts and money owed. | A personal CRM centered on memory and follow-through, with a real person detail page. |
| [Dex](https://getdex.com/blog/personal-crm-vs-ai-meeting-assistant/) | Profiles, freeform context, interaction timelines and keep-in-touch reminders. | Separate enduring relationship notes from dated conversations and follow-up commitments. Omit automatic email/social enrichment. |
| [Clay reconnect groups, now hosted by Me.sh](https://library.me.sh/2023/06/16/%F0%9F%91%A5-reconnect-for-groups/) | This 2023 release describes group cadence and suppressing prompts after recent contact. | Historical inspiration for gentle reconnect queues; current feature parity is unverified. Start with per-person cadence. |
| [Obsidian backlinks](https://obsidian.md/help/Plugins/Backlinks) | Linked/unlinked mentions, contextual snippets and navigation back to the source. | Notes connect people, projects and learning; let users confirm ambiguous mentions. |
| [Bear search](https://bear.app/faq/how-to-search-notes-in-bear/) and [Markdown](https://bear.app/faq/how-to-use-markdown-in-bear/) | Quick Open, search operators and a writing-oriented Markdown interface. | A readable editor/library rather than a long textarea in a generic list. |
| [Day One](https://dayoneapp.com/features/) | Calendar/timeline retrieval, templates, media, tags, search and On This Day. | A reflective journal with calendar browsing and past-entry resurfacing; media waits for attachment support. |
| [Habitify progress](https://habitify.me/onboarding-instruction/progress) | Progress summaries depend on the period and habit goal schedule. | Heatmaps and completion rates based on scheduled opportunities, with corrections and contextual notes. |
| [Actual reconciliation](https://actualbudget.org/docs/accounts/reconciliation/) and [schedules](https://actualbudget.org/docs/schedules/) | Account register, statement matching, cleared totals and upcoming scheduled payments. | Dedicated finance workflows; reconciliation needs an explicit new data contract. Borrow the workflow, not its server/bank-sync architecture. |
| [Exist manual tracking](https://exist.io/page/help-manual-tracking/) | Typed manual attributes, units, templates and daily entry. | Metric-specific health input and transparent trends; avoid a one-size-fits-all number/unit form. |
| [Readwise Reader annotations](https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes) and [review](https://docs.readwise.io/readwise/docs/faqs/reviewing-highlights) | Highlights with notes/tags, source context and review collections. | A resource-to-notes-to-review learning loop. Source excerpts require a defined annotation model. |
| [Anki FSRS](https://docs.ankiweb.net/deck-options) and [statistics](https://docs.ankiweb.net/manual/stats) | Spaced-repetition scheduling, distinct recall ratings and review history/statistics. | A focused review runner with source links, workload preview and meaningful recall feedback. |
| [HomeBox](https://github.com/sysadminsmedia/homebox) | Inventory by location/category/tag, images, documents, warranties and maintenance. | An asset dossier and due-maintenance queue. Its hosted application architecture is not suitable for this project. |

### Synthesis and tradeoffs

1. **Workflow depth matters more than field count.** A relationship app becomes
   useful when notes, interactions and promises remain connected over time.
   A project becomes useful when the brief, next actions and progress are together.
2. **Different information needs different geometry.** Time belongs on a timeline;
   writing in a reading/editor surface; finance in a register; relationships in
   profiles and history. Cards everywhere would repeat today's problem.
3. **Simple entry, rich detail.** Capture should ask little. Details should reveal
   relevant optional controls, not a large compulsory form. Expert shortcuts
   supplement visible actions.
4. **Integration is the product advantage.** The same follow-up can appear in
   Tasks, Today, Planner and People with one identity and one completion state.
   Each appearance must explain its source.
5. **Beauty is functional.** Typography, rhythm, hierarchy, considered empty
   states and meaningful motion make the next action easier to understand.
   Decorative widgets cannot compensate for missing workflows.
6. **Feature expansion creates navigation and maintenance costs.** Ship complete
   paths in waves, let people hide unused modules, and retain all data in search.
   Do not copy sales pipelines, team assignments or automatic surveillance into
   a personal life manager.

### Usability and visual evidence

[NN/g's aesthetic-usability analysis](https://www.nngroup.com/articles/aesthetic-usability-effect/)
explains that attractive interfaces can improve perceived usability and can also
mask interaction problems in subjective feedback. Measure observed completion
and recovery alongside attractiveness/ease ratings; a prettier screenshot is
not evidence of a better workflow.

[NN/g's progressive-disclosure guidance](https://www.nngroup.com/articles/progressive-disclosure/)
supports showing primary options first and deferring advanced controls. Applied
here, the capture composer stays small while a person profile or task detail
reveals optional structure when needed. Essential recovery, status and primary
actions must remain visible.

[W3C's interaction-animation guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
supports disabling nonessential interaction motion. DESIGN §12 turns that into
specific completion, sheet, queue and calendar behaviors. Timing and visual
style remain product hypotheses to validate, not results established by these
sources.

## 3. Current product diagnosis

The owner reports that the app is basic, unattractive and hard to use, and that
its modules look alike. We directly viewed the current dark workspace at the
in-app browser's roughly 667px-wide viewport, including Inbox, Projects and
People. Their empty views repeat the same layout, generic subtitle, capture
row, Add button and empty message. This is a limited expert walkthrough, not
an all-device accessibility review or a participant study. No records were
created for this walkthrough.

Source evidence:

- `packages/ui/src/app/App.tsx` uses one `.list`/`.row` rendering path for most
  modules. It switches labels and some actions, rather than composing dedicated
  feature workspaces.
- `features/workspace/modules.ts` drives the shared editor from short field
  arrays. Projects exposes name/notes/status. People exposes name, relationship
  kind and notes. A single person notes field **does exist**; multiple linked
  notes, dated interactions and relationship context are not exposed as a CRM.
- Planner's module is an Event editor/list; a day/week calendar and time-block
  scheduling experience are absent from this rendering path.
- `theme/tokens.css` contains a reduced-motion-aware button background
  transition. There is no comparable motion system for details, completion,
  reordering, processing or navigation in these inspected paths.
- The sidebar has 15 peer destinations; phone CSS changes it to a horizontal
  strip. Most screens have no specialized context or useful first-use example.

**Conclusion:** this is a persistence-backed prototype. It needs both a design
system upgrade and domain-specific product experiences. Color, rounded corners
and animations alone would leave the underlying usability problem intact.

## 4. Module experience and feature contracts

Everything below is a **target requirement**, not implemented behavior. “Core”
means the first useful complete workflow for that module. “Depth” is subsequent
scope. Data additions explicitly identified in §7 need specification before code.
The interaction budgets are proposed usability targets, measured after setup,
not hard-coded UI restrictions.

### M01 — Today and daily planning

**Job:** choose a realistic day and know what to do next.
**Surface:** a composed daily agenda, chosen priorities and compact due actions;
not global record counts. Desktop can place context beside the agenda; phone
uses a single ordered stream.

- Core: upcoming event, overdue/due tasks, a user-selected priority list,
  scheduled blocks, due habits and a resumable focus entry point. Explain why
  each item appears. Work/personal/area filters preserve context.
- Depth: planning ritual, estimated load versus available working time,
  intentional carry-forward/reschedule, evening shutdown and weekly objectives.
- Example gate: choose three existing tasks, schedule one and finish another;
  all relevant views agree. Undated backlog stays optional. Unknown estimates
  are visible, not treated as zero work.

### M02 — Inbox and capture

**Job:** collect thoughts fast, then decide what each means.
**Surface:** a capture composer plus a processing queue and selected-item preview.

- Core: text capture, source context, multi-line paste preview, keyboard queue
  navigation, convert to task/note/event/interaction, link destination context,
  archive or defer with explicit meaning, and undo. Optional fields appear at
  processing time. Quick capture and processing are distinct actions.
- Depth: native share/voice capture, attachments, visible en/fa date parsing,
  multi-select processing and duplicate suggestions.
- Example gate: capture an idea without leaving People; later convert it into
  a project task. Failure/retry retains the source and creates one destination.
  Proposed target: text capture takes one primary submit action.

### M03 — Tasks

**Job:** choose, execute and track next actions.
**Surface:** dense but readable action rows, grouped views, inline creation and
an expandable detail panel with optional metadata.

- Core: Today/Upcoming/Anytime views; project/area/tag filters; title and notes;
  subtasks; priority; estimates; due dates separate from planned work; recurrence;
  completion history; bulk move/reschedule and reversible completion.
- Depth: visual saved filters, templates, waiting-for context and dependency
  warnings after status/cycle semantics are specified. Never infer blocked state
  from prose or silently reschedule a deadline.
- Example gate: create a task inside a project, add a subtask, schedule it and
  complete it from Today. Project progress and task detail update together.

### M04 — Projects and Areas

**Job:** move an outcome forward while maintaining ongoing responsibilities.
**Surface:** project portfolio grouped by area/status, with project workspaces
containing Overview, Tasks and Notes/Resources. Offer list and Kanban task views.

- Core: purpose/brief, area assignment, next actions, linked notes/resources,
  task-derived progress, active/on-hold/archive handling and review prompts.
  Areas aggregate responsibilities and active work without fake completion bars.
- Depth: reusable project templates, project-owned milestones/sections,
  explicit stalled/blocked indicators and target-date timelines.
- Example gate: create a trip project, attach a planning note and three tasks,
  move a task through a board and review remaining actions. Cancelled tasks do
  not inflate completion. A project with zero tasks shows “no tasks,” not 100%.

### M05 — Planner and calendar

**Job:** allocate time and understand commitments.
**Surface:** day/week timeline, month navigation and accessible agenda, with an
unscheduled-task tray and calendar/source controls.

- Core: local events, all-day events, recurrence, task time blocks, drag/resize
  plus keyboard scheduling, overlap warnings, timezone and calendar-aware entry.
- Depth: buffers, recurring occurrence editing with this/series choices,
  working-hours capacity, external read calendars, stale-cache status and
  explicit write-back confirmation as connectors ship.
- Example gate: schedule a 30-minute task by keyboard; resize it; see a conflict;
  undo. Its due date remains unchanged. DST and Jalali boundaries have domain
  tests; external calendar absence does not disable the local planner.

### M06 — People: complete personal CRM

**Job:** remember context, nurture relationships and keep promises.
**Surface:** searchable people directory with circles/tags/reconnect filters;
rich person profiles with Overview, Timeline, Notes and Follow-ups.

- Core: optional avatar and contact methods, aliases/company/role/how-we-met,
  meaningful personal context, multiple long-form linked notes, dated interaction
  logs, multi-person interactions, follow-up tasks and important dates.
  Quick “Add note” and “Log interaction” actions stay on the profile.
- Depth: relationships between people, gift ideas/history, per-person cadence,
  reconnect queue with snooze/dismiss, custom fields, vCard import and reversible
  duplicate-resolution preview. Search note and interaction content, not names
  alone. Group cadence is optional later scope.
- A stable profile note and a conversation log have different purposes. Use
  Person.notes for durable overview context; Note + Link for independent notes;
  Interaction.notes for a dated conversation. Saving a note does not imply
  that contact happened or reset cadence.
- Example gate: log a call with two people, write a separate note, create a
  follow-up and find the history from either profile. Complete the task in Today;
  both profiles show its state. Proposed target: reach the note composer within
  two activations from an open profile.
- “Complete CRM” here includes personal and professional relationships. A sales
  pipeline, shared team CRM and automatic email/LinkedIn ingestion are separate
  products and are outside this brief.

### M07 — Notes and knowledge

**Job:** think, write and retrieve connected information.
**Surface:** library/navigation, note list and a spacious editor/reader with
contextual backlinks; phone opens the editor as its own screen.

- Core: safe Markdown, tags/folders/pins, local full-text search, wikilinks,
  person mentions, backlinks, templates and links to project/resource/person.
- Depth: linked-note creation, confirmed unlinked mentions, attachments after
  encrypted storage support, revision/conflict review and reading outlines.
- Example gate: write a note about a person and project; navigate from either
  detail to that same note and back without losing scroll or a draft. Rename
  handling must preserve identity; two equal names cannot silently select a person.

### M08 — Journal

**Job:** reflect and revisit life over time.
**Surface:** calendar and chronological entries around a comfortable writing
canvas, with optional prompts and mood controls.

- Core: daily/weekly prompts, tags, calendar browsing, mood, search, safe
  Markdown reading and edits. Journaling never requires mood input.
- Depth: On This Day, themed reflection collections, media, private display
  mode and review links. Multiple entries per day/collections need a clarified
  model before presentation promises them.
- Example gate: write, leave, return and edit a dated entry; retrieve it by
  month and tag. Missing days are neutral; no punitive streak copy.

### M09 — Habits and routines

**Job:** repeat useful behaviors with flexible, correct tracking.
**Surface:** due-habit check-in cards, period progress/heatmap and habit detail;
routines have a sequential checklist runner.

- Core: boolean/count/duration habits, flexible schedules, goal-aware entry,
  history correction, optional notes, scheduled-day heatmaps and non-punitive
  skip handling. Show the unit and target at the point of logging.
- Depth: routine steps linked to habits, pause/resume, time estimates, optional
  reminders, schedule summaries and weekly reflection.
- Example gate: log and correct a three-times-per-week habit; summaries use
  the actual schedule. A routine can be resumed without duplicating habit logs.

### M10 — Focus and time

**Job:** work on one thing, then understand where time went.
**Surface:** distraction-light timer, selected task/context, compact persistent
session controls and a separate history/report surface.

- Core: task selection, Pomodoro/free timer, pause/breaks, interruption notes,
  finish/cancel distinction, manual time correction and durable session recovery.
- Depth: area/project/task totals, planned-versus-actual review and optional
  desktop mini-window/native controls.
- Example gate: start on a task, navigate, pause, reload and recover; finish once.
  Timer animation stops under reduced motion; elapsed time remains correct.

### M11 — Money

**Job:** know available money, obligations and spending decisions.
**Surface:** account summary and transaction register, with dedicated Budget,
Bills and Reports views. Use aligned amounts and clear inflow/outflow semantics.

- Core: exact currency-aware input, balances, categories, transfers, filters,
  budgets in the chosen calendar, bills/subscriptions and payment history.
- Depth: savings goals, manual FX, bank CSV mapping/duplicates preview,
  reconciliation, splits and rule-preview workflows after data design.
- Example gate: record a transfer, categorize an expense and mark a bill paid;
  totals remain exact, transfers are not expenses, retry does not double-pay.
  Never add different currencies without a visible conversion basis/date.

### M12 — Health and wellbeing

**Job:** record quickly and understand personal patterns.
**Surface:** metric-specific quick-entry controls and date-range trend views.

- Core: water increments, sleep interval, exercise duration, labelled mood/
  energy scales, weight units, custom metric definitions and history correction.
- Depth: annotations, missing-data visibility and explainable cross-module
  correlations with sample count, uncertainty and source drill-down.
- Example gate: enter sleep across midnight, correct water and compare a week.
  Unit conversion is explicit; missing observations are not zeros. No diagnostic
  or causal claims; integrations remain separately planned.

### M13 — Library, courses and flashcards

**Job:** turn material into retained knowledge.
**Surface:** resource shelf/list with progress, resource detail and a focused
flashcard review runner.

- Core: author/source URL, reading/learning status, progress in pages/lessons/
  percent, completion/rating, linked notes, decks and source-linked cards.
- Depth: excerpts/highlights with source locations, review collections and
  learning paths. AI-generated cards remain editable proposals.
- Example gate: update a book's progress, open its notes, make a card and review
  it with Again/Hard/Good/Easy. Card scheduling/history remains reproducible.

### M14 — Life admin, documents, assets and shopping

**Job:** find important things and stay ahead of renewal/maintenance.
**Surface:** due-action overview, document gallery/list with expiry state,
asset dossiers and fast shopping checklists.

- Core: asset notes, purchase/warranty links, encrypted document attachments,
  expiry reminders, maintenance plans that create tasks, reusable shopping lists.
- Depth: locations, asset photos/serials/custom fields, maintenance history,
  renewal checklist templates and camera capture. New asset fields need schema
  design; document OCR waits for an approved local/provider path.
- Example gate: attach a warranty, create maintenance, complete the linked task
  and find the history from the asset. Attachment IO failure retains the draft.

### M15 — Goals, review and insights

**Job:** connect daily work to meaningful longer-term outcomes.
**Surface:** goal portfolio/detail with purpose, milestone path, linked work and
transparent progress; guided weekly review and explainable reports.

- Core: goals by area, milestones, task/manual progress with visible basis,
  target dates, linked projects/tasks and a guided done/slipped/next review.
- Depth: weekly area/time trends, resource/habit contributions and optional
  life-wheel visualization. Additional progress formulas need explicit contracts.
- Example gate: completing linked work changes derived goal progress; manual
  mode stays manual. Review offers rescheduling choices before committing edits.
  Reports open underlying records and show incomplete-data limitations.

### M16 — Search, settings, onboarding and recovery

**Job:** find context, control the workspace and trust its storage.
**Surface:** local command/search palette; grouped settings for appearance,
calendar, modules, data, sync, providers and reminders.

- Core: global search with snippets and type/context, routable details,
  module favorites/visibility, local-only onboarding, honest persistence state,
  export/restore preview, recoverable Trash and durable editor drafts.
- Depth: configurable saved views and density, connected-sync setup, conflict/
  recovery center, shortcut discovery and optional provider proposal previews.
- Example gate: find a person note from global search, open its profile, return
  with search intact and export/restore a synthetic workspace with its links.
  Hidden modules stay searchable; secrets never enter search or export.

## 5. Cross-module journeys that define “integrated”

| Journey | Connected behavior | Release gate |
|---|---|---|
| Conversation → follow-through | People interaction → linked Task → Today → Planner → completed follow-up on profile | One task identity; retry and completion remain consistent. |
| Idea → outcome | Inbox → Project Task + linked Note → scheduled block → Focus → project review | Source recovery, context navigation and actual-time feedback. |
| Book → learning | Resource → linked Note → source-linked Card → review history | Original source remains reachable; no duplicate acceptance. |
| Warranty → maintenance | Asset → Document → MaintenancePlan → Task → history | Expiry/recurrence is calendar-correct; attachment preservation. |
| Reflection → adjustment | Health/Habits/Focus → WeeklyReview → proposed next-week changes | Missing data is explicit; changes require an intentional apply action. |
| Obligation → budget | Bill → linked payment Transaction → Budget/Account → Today reminder cleared | Exact money, stable payment identity and retry protection. |

## 6. Priority, dependencies and verification

Effort is relative: S = a contained workflow, M = several connected screens,
L = substantial domain/platform work. It is not a calendar estimate. Confidence
reflects problem evidence, not validated market demand. Native parity and sync
acceptance remain separate gates; local web releases do not complete them.

| Wave | Scope and why | Dependencies | Effort / confidence |
|---|---|---|---|
| W1 | Design prototypes, tokens, motion, grouped shell, contextual actions/search and draft recovery; removes repeated geometry and navigation friction. | Existing local web repository; draft persistence contract before writes. | L / high |
| W2 | Complete People profiles/notes/interactions/follow-ups as the first depth showcase; Inbox processing, connected Tasks/Projects and Today. | W1 usable shell, links/live queries, safe compound writes. | L / high |
| W3 | Local Planner/timeboxing, habit history/routine runner and focus recovery/reports; makes the daily loop complete. | Task context, recurrence/time contracts; lifecycle persistence. | L / high |
| W4 | Writing/knowledge/journal and resource/card learning loop. | Search/links, safe Markdown and review services; attachment support for media. | L / medium-high |
| W5 | Money, wellbeing, goals/review and life-admin depth in separate scoped releases. | Domain calculation tests; data-design gates for new fields; encrypted files for documents. | L / medium |
| W6 | Imports, external calendars, native entry points and optional AI proposals. | Recovery/export round trips, verified platform/connector/sync paths. | L / medium |

Every wave ships vertical workflows, not a new batch of partially working
screens. W5 modules can proceed independently when their prerequisites hold.
P0.2 forge/native spikes continue as an independent foundation track. External
credentials must not block designing and validating offline local workflows.

### Proposed usability and visual acceptance

- Test six representative flows: capture/process, plan a day, manage a project,
  record a conversation/follow-up, find a linked note, and record a bill/payment.
  Add the specialized workflow gate when each later module ships.
- Recruit 5–8 representative participants for formative rounds across planning,
  relationship and knowledge needs, including Persian RTL and phone use. These
  are proposed research sessions, not completed interviews or statistical proof.
- Initial targets: at least 80% unassisted task completion per flow, no lost
  input/data, clear recovery from failures, and median ease rating at least 5/7.
  Report counts and observed failure causes; small samples do not prove adoption.
- Capture should be possible within 10 seconds after opening the composer;
  add a person note within 20 seconds after opening the profile (typing excluded).
  Revise targets when real study evidence warrants it.
- Compare Inbox, Tasks, Projects, Planner, People, Notes and Money side by side
  with realistic synthetic data. Layout and primary actions must distinguish
  them without relying on title/color alone.
- Review populated, empty, loading, filtered, error and long-content states at
  320/390/768/1440px, en/fa, light/dark and reduced motion. Conduct keyboard and
  screen-reader review; screenshots do not verify interaction or conformance.
- Performance targets: interaction feedback starts within 100ms; capture/search
  stays responsive with a measured 10k-record fixture on a documented reference
  device. Record p50/p95 timings; do not claim a universal hardware guarantee.
- Use synthetic fixtures and local study notes. No analytics or remote telemetry
  is required to evaluate usability.

## 7. Data design gates and scope boundaries

Existing entities can support much more than the current UI exposes: multiple
person notes use Note + Link; conversation history uses Interaction; follow-ups
use Task; resource notes and project context use links. The first expansion
should expose these capabilities before introducing new record types.

The following are **planned contracts to resolve**, not schema changes in this
research session:

| Gate | Required decisions | Consumers |
|---|---|---|
| G01 Workspace preferences/drafts | Device-local vs synced fields, lifecycle, limits, schema, restore behavior and protection appropriate to stored content. | W1 favorites/views/density and durable draft/session recovery. |
| G02 Inbox processing | Deferred/archive state, multi-line split source provenance, atomic/recoverable conversion and undo/retry identity. | M02 and connected capture journeys. |
| G03 Project structure | Project-owned sections/milestones/target dates; do not reuse goal-owned Milestone by changing its meaning. | M04 portfolio/timeline/templates. |
| G04 Task waiting/dependencies | Waiting status/context, relation direction, cycle validation, concurrency and notification meaning. | M03 advanced workflow. |
| G05 CRM detail | Per-person note pinning/order if needed, partial important dates, duplicate merge/reference rewrite, cadence snooze/reset and group cadence. | M06 advanced CRM; basic linked notes require no new PersonNote entity. |
| G06 Finance depth | Split sums, cleared/reconciled state, audit corrections, rule approval, duplicate provenance and retry-safe bill payment. | M11 finance depth. |
| G07 Knowledge/media | Highlight source/locator/provenance, attachment lifecycle, journal entry cardinality/collections and template versioning. | M07/M08/M13. |
| G08 Assets/derived progress | Locations/custom asset fields, maintenance occurrence identity/history, habit/resource goal contributions. | M14/M15. |

For each gate specify validation, migration/upgraders, references/deletion,
unknown-field preservation, export/restore and deterministic merge behavior;
require convergence tests where synced structure changes. New long-text fields
must follow the existing provenance rules. Preserve current schemas until an
implementation change updates code and canonical specs together.

This brief adds no backend, new sync protocol, dependency, paid service or
weaker encryption. No automatic AI saving, background contact scraping, shared
sales CRM, bank aggregator or health diagnosis is part of the expansion.
Networked capabilities need their existing explicit configuration and privacy
controls. [DATA-MODEL.md](DATA-MODEL.md) remains the canonical current contract.
