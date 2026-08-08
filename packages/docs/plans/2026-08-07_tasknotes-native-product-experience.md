---
id: plan-2026-08-07-tasknotes-native-product-experience
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# TaskNotes Native Product Experience

## Outcome

Make Tasks for Obsidian feel like a first-class iPhone task manager: as fast and
legible as Todoist for capture, review, and daily planning, while keeping
TaskNotes Markdown in Obsidian as the task source of truth and retaining the
app's stronger offline behavior, recurrence handling, time tracking, and data
ownership.

This is an iOS-first product pass, not a pixel-for-pixel Todoist clone. Android
must remain functional, but iPhone is the visual and interaction acceptance
target for this wave.

## Baseline

The 2026-08-07 Todoist reference walkthrough exposed six connected gaps:

| Area              | Current app                                                                                            | Target experience                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Native polish     | One global header, JavaScript tabs without real icons, custom modal surfaces, manually themed controls | Per-tab native navigation, SF Symbols, system materials and colors, native sheets and menus, Dynamic Type            |
| Task presentation | Title plus sparse badges; scheduled and deadline meaning is not consistently visible                   | Scannable rows with stable date semantics, project/context cues, priority, recurrence, blocked state, and sync state |
| Quick capture     | Full-screen form with parser tokens and a final create button                                          | Keyboard-first bottom composer with editable metadata chips, contextual defaults, and one-tap creation               |
| Views             | Hard-coded saved views and a one-off Job Search board                                                  | User-defined saved views with shared list, board, and calendar presentations                                         |
| Organization      | Browse is a segmented flat list                                                                        | A browse hub for favorites, views, projects, contexts, tags, completed work, reports, and settings                   |
| Daily planning    | Today is due-date based; Upcoming is a plain grouped list                                              | Scheduled-vs-deadline-aware Today sections, overdue planning, and an interactive upcoming calendar                   |

The reliability and ergonomics work already completed in
`../archive/completed/2026-07-03_tasknotes-first-in-class.md` and
`../archive/completed/2026-07-22_todoist-ergonomics-wave.md` remains the
foundation. This plan supersedes only the future-gap list in
`../guides/2026-07-22_todoist-feature-comparison.md`; it must not reimplement
schedule editing, recurring undo, bulk actions, autocomplete, or offline sync.

## Product decisions

### Native without ornamental imitation

- Use system navigation, presentation, color, typography, haptics, and
  accessibility behavior wherever React Native exposes them.
- Let iOS provide Liquid Glass on supported releases. Do not draw fake glass
  backgrounds or put glass behind task content; use materials only for
  navigation and floating controls.
- Keep hierarchy shallow: each tab owns a native stack and large title; editors
  and pickers are native stack sheet routes above those stacks.
- Use one visual vocabulary for buttons, task metadata, empty states, banners,
  and destructive actions. Remove generic pill controls when a toolbar item,
  menu, segmented control, or sheet is the native equivalent.

### Preserve TaskNotes meaning

- `scheduled` means the day the user intends to work on a task.
- `due` means a hard deadline. The UI labels it as a deadline whenever both
  fields could otherwise be confused.
- Task fields continue to round-trip through the existing TaskNotes server and
  Markdown contract. Presentation preferences must not invent new task
  frontmatter.
- Saved views, layout choices, favorite order, and swipe configuration are
  app preferences. Persist them locally as versioned, Zod-validated JSON. A
  future cross-device preference contract is separate work; do not silently
  write this state into arbitrary notes or TaskNotes plugin settings.
- Migrate the two current built-in saved views into editable persisted views on
  first load, then remove their hard-coded behavior so no personal project is a
  permanent product concept.

### AI is not on the critical path

No model integration is required for this plan. Navigation, row presentation,
deterministic natural-language parsing, filtering, and planning can all be
excellent without network latency, cost, or privacy tradeoffs.

After the deterministic quick-capture work is accepted, pause for an explicit
product decision with the user. Candidate model-backed features are limited to
high-value capture boundaries such as rambling voice-to-structured-task or
photo-to-task extraction. If one is chosen, write a separate decision and
evaluation plan before implementation. It must include structured preview and
explicit confirmation, never silently create or mutate tasks, preserve a fully
functional offline path, disclose what leaves the device, and measure quality,
latency, and cost against a pinned corpus before choosing a provider or model.

## Experience architecture

### Navigation and presentation

- Replace the single root `Tasks` header with a native stack inside Inbox,
  Today, Upcoming, and Browse. Preserve the existing route names and deep links.
- Spike the React Navigation 7 native bottom-tab API already available through
  the installed dependency. Wrap its experimental import in one local adapter
  so the rest of the app depends on a stable internal interface.
- Accept native tabs only if tab restoration, deep links, VoiceOver labels,
  keyboard/sheet interaction, and the iOS 15.1 deployment target all work. If
  the spike fails, keep the stable JavaScript navigator for this wave but give
  it native SF Symbol icons and system styling; do not ship two runtime tab
  implementations.
- Use the existing native SF Symbol bridge for content controls and the native
  tab API's symbol support for tabs. Remove placeholder tab glyphs.
- Present Quick Add, task detail, scheduling, and display/filter configuration
  as native stack sheets with appropriate detents and grabbers. Route params
  remain serializable: sheets receive task/view IDs or initial values and
  commit through domain hooks rather than callback params.
- Convert project/task overflow actions to the maintained native menu path and
  resolve `../todos/tasks-for-obsidian-context-menu-rn85.md`; remove Zeego and
  its compatibility patches once no call sites remain.

### System design layer

- Replace hard-coded iOS surface colors with semantic `PlatformColor` values;
  retain explicit Android tokens. Change appearance to System, Light, or Dark,
  with System as the default.
- Map text roles to Dynamic Type ramps and verify layouts at accessibility
  sizes. Do not disable font scaling or truncate essential metadata.
- Centralize spacing, corner radii, minimum hit targets, separator behavior,
  motion, and haptic intent. Honor Reduce Motion, Reduce Transparency, Bold
  Text, increased contrast, and sound/haptic preferences.
- Keep content backgrounds quiet and opaque. Reserve the accent color for
  selection, capture, and high-value state rather than coloring every control.

### Shared task-collection model

Inbox, Today, Upcoming, projects, contexts, tags, completed history, and saved
views should render through one collection pipeline:

1. Select candidate tasks from the local offline store.
2. Apply a pure, tested filter predicate.
3. Derive each task's presentation date and state.
4. Sort and group through a single configuration.
5. Render the same result as list, board, or calendar.

Define a versioned `SavedViewSchema` around:

- identity: ID, name, SF Symbol, tint, favorite, and order;
- query: projects, contexts, tags, statuses, priorities, text, completed state,
  missing-field predicates, and relative scheduled/deadline ranges;
- presentation: layout, sort, group, density, and completed visibility.

Keep this schema app-local while the preference is app-local. Reuse the server's
TaskNotes query vocabulary where it matches, but do not force view-only layout
fields into `tasknotes-types`.

## Target flows

### Task rows and detail

- Give every row a clear completion target, a one- or two-line title, and a
  consistent secondary line. The secondary line prioritizes planned date,
  deadline, project, then one useful context/tag; recurrence, blocked state,
  estimate/tracked time, and queued sync use compact accessible indicators.
- Derive row copy and color in a pure `TaskPresentation` function so list,
  board, widget, VoiceOver, and tests agree. Never let individual screens infer
  date meaning independently.
- Color the completion control by priority without making color the only signal.
  Use concise relative dates for near-term work and an unambiguous absolute date
  outside that window.
- Make section headers useful: count, collapse state, and contextual actions such
  as Reschedule overdue. Preserve stable scroll position while rows complete,
  move, or sync.
- Open task detail as a native form sheet. Title and Markdown details use local
  drafts committed on Done, blur, or dismissal; metadata changes use the
  existing optimistic command queue. Present project, planned date, deadline,
  priority, recurrence, contexts, tags, estimate, time tracking, and blocking
  state as direct rows or chips instead of a read/edit mode switch.
- Keep context menu, overflow menu, and swipe actions consistent. Add explicit
  left/right swipe preferences for Complete, Schedule, Priority, and Delete;
  destructive full swipes still require the existing safe confirmation/undo
  behavior.

### Quick capture

- Open a compact native sheet focused directly in the title field, above the
  keyboard. Expand it only when the user asks for details or more metadata.
- Keep the deterministic parser and autocomplete, but render parsed date,
  recurrence, project, context, tag, and priority as editable chips. Tapping a
  parsed chip returns its source text to the title so parsing is reversible.
- Put planned date, deadline, project, and priority in the primary action row;
  contexts, tags, recurrence, estimate, and Markdown details live in a More
  menu or expanded detent. Do not show unsupported Todoist affordances such as
  attachments, location, comments, or assignees.
- Seed capture from its source: a project adds that project, Today schedules
  today, a selected Upcoming day schedules that day, and Inbox adds no project.
  The user can clear every seed before creating.
- Keep creation optimistic and offline-first. Successful creation dismisses
  immediately with haptic feedback; queue failure remains visible through the
  existing sync/dead-letter UX. Support Create and Create Another without
  waiting for a network round trip.
- Preserve Home Screen, deep-link, Siri/Shortcuts, widget, and in-app entry
  points. All entry points construct the same serializable capture seed and use
  the same domain command.

### Views and organization

- Rebuild Browse as a vertically scannable hub: Search, Favorites, Saved Views,
  Projects, Contexts, Tags, Completed, Reports, and Settings. Show useful active
  counts and make section ordering persistent.
- Add create/edit/duplicate/delete/reorder flows for saved views. Editing uses
  the same display sheet as built-in collections rather than a parallel filter
  UI.
- Replace `JobSearchKanbanScreen` with a generic board renderer. Status,
  priority, and planned-date lanes may update their single underlying field;
  project/context/tag lanes use explicit Move/Add/Remove actions so dragging
  never has ambiguous array semantics.
- Add a generic calendar renderer for views whose meaningful axis is planned
  date or deadline. Use different accessible markers for each field and never
  merge them into one unlabeled date.
- Add completed history with search/filter and uncomplete. Completed tasks stay
  hidden by default in active collections unless a view opts in.

### Daily planning

- Replace the current due-only Today selector with a pure, recurrence-aware
  agenda derivation. Each task appears once using this precedence:
  Overdue, Scheduled Today, Due Today, then an optional view-specific group.
  A future-scheduled task whose deadline is today belongs in Due Today; a task
  scheduled today and due today stays in Scheduled Today and shows its deadline
  on the row.
- Add a prominent Reschedule action to Overdue. It opens the existing bulk
  scheduling calendar with Tomorrow, Later This Week, Next Week, and custom date
  options; nothing moves until the user confirms.
- Add a Plan My Day sheet that shows overdue tasks and deterministic candidates
  from Inbox/no-date work. The user selects tasks and assigns a planned day;
  there is no opaque automatic prioritization.
- Give Upcoming a collapsible week strip and expandable month calendar with
  per-day counts, a Today shortcut, date selection, and list scroll
  synchronization. Group future tasks by their next relevant planned date or
  deadline and label which one is being shown.
- Reuse the calendar and agenda derivation in Schedule, Today, Upcoming, saved
  views, and widgets so counts and inclusion rules cannot drift.

## Delivery strategy

Ship this as a git-spice stack of reviewable changes, with each slice remaining
usable on its own:

1. Native foundation and the shared design layer.
2. Navigation shell, native sheets/menus, and context-menu dependency cleanup.
3. Task presentation and task-detail sheet.
4. Quick-capture composer and reversible parser chips.
5. Date semantics, Today planning, and Upcoming calendar.
6. Persisted saved views, Browse information architecture, board/calendar
   layouts, and completed history.
7. Accessibility, performance, E2E expansion, and visual acceptance.

Do not combine the full redesign into one feature branch. Each slice gets a
simulator screenshot or short interaction recording when visual behavior
changes, focused tests, and a draft PR before the next dependent slice begins.

## Verification

### Deterministic gates

- Unit-test `TaskPresentation`, date precedence, recurring occurrences, relative
  date copy, filter/group/sort behavior, saved-view parsing/migration, capture
  seeds, and tap-to-unparse round trips.
- Extend the sync harness for offline quick creation, detail edits, bulk
  rescheduling, uncomplete, and board moves; assert the resulting Markdown/API
  commands, not only rendered state.
- Extend Maestro with create-from-each-context, Today planning, Upcoming date
  selection, saved-view lifecycle, board move, completed/uncomplete, deep-link
  routing, and an offline capture/relaunch scenario.
- For every slice run focused `typecheck`, `test`, and `lint` through Turbo. Run
  `test:contract`, `check:release-bundle`, `check:ios-native-deps`, an iOS
  simulator build, and the full Maestro suite before the final slice is marked
  ready. Buildkite remains the exhaustive repository gate; Xcode Cloud remains
  the Archive/TestFlight gate.
- Assert no duplicate task IDs in any grouped result and no TaskNotes fields are
  lost after edit/create/complete/uncomplete round trips.

### Human acceptance matrix

Before completion, capture the same seeded vault on a current iPhone simulator
in light and dark appearance and review:

- system and accessibility Dynamic Type, Bold Text, Reduce Motion, Reduce
  Transparency, and increased contrast;
- VoiceOver order, labels, values, hints, adjustable controls, and menu actions;
- long titles, long project/context names, empty sections, hundreds of tasks,
  offline/pending/error states, recurring tasks, and tasks with both dates;
- native navigation and sheet behavior on the newest iOS runtime plus one older
  installed runtime compatible with the 15.1 deployment target;
- capture-to-visible-row latency, list scroll smoothness, and no keyboard or tab
  bar collisions.

The final acceptance scenarios are: capture an Inbox task without leaving the
keyboard; plan it for today; distinguish its planned date from its deadline;
reschedule overdue work; build and use a saved board view; find and uncomplete a
completed task; kill/relaunch offline and observe the same state; reconnect and
verify the corresponding Markdown in the vault.

## Non-goals

- Team collaboration, assignees, comments, Karma, templates, and Todoist account
  compatibility.
- New TaskNotes file fields solely to imitate Todoist.
- Subtasks, sections, attachments, location, or reminder UX until their upstream
  TaskNotes format and round-trip behavior are explicitly designed.
- A React Navigation 8 alpha upgrade as a prerequisite for visual quality.
- An AI assistant, automatic prioritizer, or model-dependent core capture flow.
- Pixel parity across Android in this wave; shared logic and functional fallback
  remain required.

## Completed

- Spike native bottom tabs and reject the experimental host after reproducible
  iOS 27 runtime crashes.
- Define and test task presentation, agenda/date precedence, capture seed,
  display configuration, and saved-view schemas.
- Ship the stable tab shell, native sheets, shared task rows, direct task-detail
  editing, keyboard-first capture, reversible parser chips, and shared capture
  routing.
- Replace Zeego's remaining call sites and add semantic System/Light/Dark
  appearance colors.
- Correct Today/Upcoming grouping, add overdue rescheduling, the week strip,
  and recurrence-aware day-load indicators.
- Persist editable saved views, rebuild Browse, bind the Job Search board to its
  saved-view query, and add saved-view/completed-search flows.

## Remaining

### Phase 0 — Native feasibility and contracts

- [ ] Record seeded before-state screenshots and performance/accessibility
      baselines for Inbox, Today, Upcoming, Browse, Quick Add, and task detail.
- [ ] Validate native stack form sheets against restoration, accessibility,
      keyboard behavior, and an older runtime compatible with the deployment
      target.
- [ ] Define the semantic color, Dynamic Type, spacing, motion, and haptic tokens.

### Phase 1 — Native shell

- [ ] Introduce per-tab native stacks and finish large-title behavior without
      creating a second runtime navigation implementation.
- [ ] Convert display/sort/filter and overflow actions to native sheets/menus.

### Phase 2 — Tasks and details

- [ ] Add configurable swipe actions and keep menu, swipe, and bulk semantics in
      sync.

### Phase 3 — Capture

- [ ] Add structured planned-date, deadline, and priority controls to the
      capture action row; keep the deterministic text path available.
- [ ] Hold the explicit AI product checkpoint; proceed without AI unless the
      user chooses a separately evaluated capture use case.

### Phase 4 — Daily planning

- [ ] Add the deterministic Plan My Day sheet.
- [ ] Make the week strip collapsible, then add the expandable month calendar
      and list-scroll synchronization.

### Phase 5 — Views and organization

- [ ] Add the remaining per-view layout, grouping, density, visibility, and
      date-range choices.
- [ ] Persist user-defined Browse section ordering.
- [ ] Replace the hard-coded Job Search board with generic list, board, and
      calendar collection renderers.
- [ ] Add distinct completed-history filter controls.

### Phase 6 — Acceptance and closeout

- [ ] Complete the deterministic verification and human acceptance matrix,
      including a real offline-to-Markdown round trip.
- [ ] Attach the lightest visual evidence to each UI PR and a short end-to-end
      recording for each final acceptance scenario.
- [ ] Update the feature comparison guide to the shipped state, move this plan
      to `../archive/completed/`, and leave any deliberately deferred product
      decision as a focused TODO rather than an open-ended backlog.

## Comment Log

- 2026-08-07: Plan derived from the current simulator build and the Todoist iOS
  reference walkthrough. Core UX is deterministic and local-first; AI is an
  explicit post-capture decision rather than a prerequisite.
- 2026-08-07: Implementation started with one integration owner and three
  file-disjoint lanes: native navigation feasibility, task-presentation
  contracts, and saved-view persistence. Date/agenda contracts, baseline
  evidence, and integration remain with the root lane.
- 2026-08-07: Reject the experimental React Navigation native bottom-tab host
  for this wave after reproducing iOS 27 AnimationKit/UISheet crashes during
  ordinary task mutations. The production path now uses one stable tab
  navigator on every OS, retains native SF Symbols on iOS, and keeps the
  contextual floating capture action. Native stack sheets remain in the root
  stack; older-runtime acceptance is still open because this machine currently
  has only the iOS 27 runtime.
- 2026-08-07: The shared agenda, task-presentation, and saved-view
  schema/migration contracts are integrated with 37 focused tests. Today now
  uses Overdue, Today, and Due Today precedence; Upcoming groups each task once
  by its next planned date, deadline, or recurring occurrence.
- 2026-08-07: A second three-lane wave started for keyboard-first capture,
  direct task-detail editing, and persisted Browse/saved-view UI while the root
  lane integrates and verifies the shared collection surfaces.
- 2026-08-07: The first integrated product wave now includes a single polished
  iOS tab shell, semantic appearance, shared task rows, direct task detail,
  contextual quick capture, recurrence-aware Today/Upcoming, persisted saved
  views, the Browse hub, and searchable completed history. Generic board/month
  calendar, configurable swipes, Plan My Day, richer view presentation,
  older-runtime acceptance, and the explicit AI checkpoint remain open and are
  not implied by the completed items above.
- 2026-08-07: Recurring completion Undo now captures and restores scheduled,
  deadline, recurrence, completion, and skipped-instance state through one
  idempotent server mutation. The app, shared contract, and server suites cover
  offline replay and date-only behavior in positive and negative UTC offsets.
  Completed history currently represents completed task parents; a distinct
  per-occurrence recurring-history product remains deferred.
- 2026-08-07: The ordered 11-flow Maestro run and its five selected Markdown
  assertions pass on Xcode 27, iOS 27, and Maestro 2.8.0. Integration review
  additionally closed deterministic recurrence advancement across time zones,
  the acknowledged-command crash window, exact same-basename project identity,
  recurrence-aware calendar counts, and Job Search move consistency.
