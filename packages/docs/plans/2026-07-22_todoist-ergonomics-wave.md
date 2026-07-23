---
id: plan-2026-07-22-todoist-ergonomics-wave
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Todoist Ergonomics Wave — tasks-for-obsidian

## Context

The docs-grounded comparison (`packages/docs/guides/2026-07-22_todoist-feature-comparison.md`) found the app's core sync/data layer is first-class but its editing ergonomics lag Todoist: a 3-preset date picker (with wrong "next week" semantics), no way to edit `scheduled`/projects/tags/contexts after creation, a thin NLP grammar, no bulk edit, and no undo on the riskiest tap (recurring completion). Data-layer exploration confirmed **zero blockers**: `PUT /api/tasks/:id` already updates every needed field (`scheduled`, `due`, `projects`, `tags`, `contexts`, `priority`) with `null`-as-clear for dates and `[]`-as-clear for arrays (`src/domain/base-schemas.ts:115`, `wire.ts:120`, server `task-repository.ts:414`).

Scope: 5 stacked PRs (one worktree, git-spice). Items deliberately in backlog at the end. Ops canary is a standalone piece.

## Feel & quality standards (every PR)

The app already has a coherent feel language — use it everywhere, extend it nowhere-new:

- **Haptics/sound**: every interaction maps to the existing vocabulary in `src/lib/feedback.ts` (`feedbackSelection` for picks/toggles, `feedbackButtonPress`, `feedbackError`, `feedbackTaskComplete/Uncomplete`). No new haptic types without adding them there.
- **Motion**: reanimated springs matching `TaskCheckbox.tsx:44-55` (damping 12–15, stiffness 400–600); respect reduce-motion via reanimated's `useReducedMotion()`.
- **Theme + type**: all colors via `useSettings().colors`, text via `styles/typography.ts`. No hardcoded hex outside the palette.
- **Accessibility**: `accessibilityRole`/`Label`/`State` on every new interactive element (pattern: `TaskCheckbox.tsx:74-76`), plus testIDs for Maestro.
- **Code quality ratchet**: each PR leaves touched files better — no new `as` casts, extract don't duplicate, unit tests for all new pure logic (calendar math, NLP, selection reducer).

## PR1 — Reschedule core (the "3 hardcoded options" fix)

| What                                                                                                                                                                                                                                      | Where                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| New `ScheduleSheet` modal: hand-rolled month calendar grid (no new dep; local-date math per `lib/dates.ts` `parseLocalDate` pattern), presets **Today / Tomorrow / This weekend (next Sat) / Next week (next Mon)** / Clear, month paging | new `src/components/input/ScheduleSheet.tsx`, modeled on `FilterModal.tsx` (RN `Modal`, `visible`/`onClose` props) |
| Field toggle: sheet edits **Scheduled** or **Due** (segmented control, defaults to the field being edited)                                                                                                                                | same component                                                                                                     |
| TaskDetail: replace inline `DatePicker` with sheet trigger rows for BOTH `due` and `scheduled` (scheduled is currently uneditable anywhere)                                                                                               | `src/screens/TaskDetailScreen.tsx:139`                                                                             |
| Context-menu "Schedule" item on task rows → opens sheet for that task                                                                                                                                                                     | `src/components/task/TaskRow.tsx` (zeego menu, after "Edit")                                                       |
| Date helpers: `nextSaturday()`, `nextMonday()` + tests                                                                                                                                                                                    | `src/lib/dates.ts`                                                                                                 |
| Clear = dispatch `updateTask(id, {due: null})` / `{scheduled: null}` (wire passes null through; server drops the key)                                                                                                                     | `src/state/TaskContext.tsx:140` `updateTask` — no data changes needed                                              |

**Feel**: presets show resolved dates ("This weekend · Sat 26"); calendar marks today with a ring and **shows per-day task-count dots from local data** (a paid Todoist feature we get free — counts from `use-tasks.ts` lists); `feedbackSelection` on date pick; spring sheet presentation; month swipe-paging.

**Quality ratchet (rides along, touches the same files)**: consolidate `use-tasks.ts:13-40`'s duplicated `isToday/isOverdue/isUpcoming` onto `lib/dates.ts`; fix the optimistic-null shape hole — `applyCommand` (`commands.ts:208-219`) assigns `null` into `Task` fields typed `string | undefined`; strip nulls to key-deletion during rebase. Delete `DatePicker.tsx` (single usage replaced). testIDs on grid/presets for Maestro.

## PR2 — Post-creation editing + capture

| What                                                                                                                                                                                                                                              | Where                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TaskDetail editors for **projects / tags / contexts**: new reusable `MultiSelectSection` chip editor (existing values + free-text add; none exists outside FilterModal today), saved via `updateTask(id, {projects/tags/contexts})` (`[]` clears) | new `src/components/input/MultiSelectSection.tsx` (extracted from `FilterModal.tsx`'s section pattern); wire into `TaskDetailScreen.tsx` edit branch (lines 94-201, editors currently only title/priority/due/details); values from `use-tasks.ts:100-132` |
| NLP grammar: `jan 27` / `27 jan`, `in N days/weeks`, `this weekend`, `next month`, `end of month` (pure additions to the word-scanner; reuse PR1 helpers)                                                                                         | `src/lib/nlp.ts` + existing test suite                                                                                                                                                                                                                     |
| Quick Add autocomplete: suggestion list under the input for the current `p:`/`@`/`#` token prefix, from existing names                                                                                                                            | `src/components/input/NaturalLanguageInput.tsx` (badges already render at `:23-33`; add suggestions FlatList)                                                                                                                                              |

**Feel**: suggestion rows and org chips animate in/out (reanimated Layout transitions); parse badges gain type icons (calendar/flag/briefcase/@/# via `AppIcon`); `feedbackSelection` on chip add/remove.
**Quality ratchet**: make `details` clearable end-to-end — app `UpdateTaskRequestSchema` types it non-nullable (`base-schemas.ts:115`) though wire+server already support `null`-clears; align the schema.

## PR3 — Recurring-completion undo

| What                                                                                                                                                                                                                                                                                                                                                                                                      | Where                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `UndoToast` component (reanimated slide-up, ~5s, one action)                                                                                                                                                                                                                                                                                                                                              | new `src/components/common/UndoToast.tsx`, animation per `ConnectionBanner.tsx`                                                       |
| On recurring completion, capture the **target date** the completion used (`completionTargetDate`, NOT tap day — recomputing after midnight would miss) and show toast; Undo dispatches `set_instance_complete{date, completed:false}` — idempotent both sides (`commands.ts:232`, server set-semantics). Hook at the `toggleTask` level (`use-tasks.ts:134`), where recurrence is known via `isRecurring` | `src/state/TaskContext.tsx:170-203` `toggleStatus` recurring path (have it return the dispatched date); `src/domain/recurrence.ts:68` |

**Feel**: toast copy shows the payoff, not just the action — "Completed · Next: Aug 1" (next occurrence via `nextOptimistic`, `recurrence.ts`) with an Undo button and a subtle shrinking time bar for the ~5s window; `feedbackTaskUncomplete` haptic on undo; reduce-motion swaps slide for fade.

## PR4 — Multi-select bulk edit

| What                                                                                                                                                                                                                                                                                             | Where                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection mode: entered via a header "Select" button on list screens (Apple Reminders pattern — long-press is owned by zeego's native menu, unusable for selection); in selection mode suppress swipe + context menu, rows show selection marks, selection state = `Set<TaskId>` at screen level | `src/components/task/TaskList.tsx` (SectionList at `:157`, `ReanimatedSwipeable` wrapper at `:95`), `TaskRow.tsx:56` (conditionally bypass `ContextMenu.Root`), `src/hooks/use-task-list-screen.ts` |
| Bottom toolbar: **Schedule** (PR1 sheet) / **Complete** / **Delete** / **Priority** applied to selection                                                                                                                                                                                         | new `src/components/task/BulkActionBar.tsx`                                                                                                                                                         |
| Apply = N sequential dispatches — confirmed fine: single-flight `SyncEngine` coalesces into one drain (`SyncEngine.ts:156`), FIFO PUTs with idempotency keys; no batch endpoint needed                                                                                                           | no data-layer changes                                                                                                                                                                               |

**Feel**: `feedbackSelection` tick per row selected; toolbar slides up with a spring and an animated count ("3 selected"); bulk-complete fires one `feedbackTaskComplete`, not N.

## PR5 — Delight & polish pass

| What                                                                                                                                                                                                                                            | Where                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Today zero-state celebration**: when Today empties _by completion_ (not filtering), a distinct "All clear" state with a one-shot spring animation + `feedbackTaskComplete`; `EmptyState` gains an optional `icon` prop (it's text-only today) | `src/components/common/EmptyState.tsx`, `src/screens/TodayScreen.tsx`                        |
| **Today header**: "Tuesday, July 22 · 4 tasks" summary line                                                                                                                                                                                     | `TodayScreen.tsx`; date fns from `lib/dates.ts`                                              |
| **Full-swipe-to-commit**: swiping past threshold completes/deletes directly (Mail/Todoist pattern) with a haptic detent at the threshold, instead of only revealing buttons                                                                     | `src/components/task/TaskList.tsx:95` (`ReanimatedSwipeable` thresholds), `SwipeActions.tsx` |
| **Per-row pending-sync dot**: tiny dot on rows with unsynced pending commands (the store knows: pending queue by taskId) — quiet trust signal replacing banner-only feedback                                                                    | `TaskRow.tsx`, pending ids exposed from `TaskStore.ts`                                       |
| **Overdue urgency color**: overdue relative dates render in `colors.error` (audit `formatRelativeDate` call sites)                                                                                                                              | `TaskRow.tsx`, `lib/dates.ts`                                                                |
| **Home Screen quick actions**: long-press app icon → Quick Add / Today (UIApplicationShortcutItems → existing deep links `tasknotes://quick-add`, `tasknotes://today`)                                                                          | `ios/TasksForObsidian/AppDelegate` + `Info.plist` (small native change)                      |
| **ConnectionBanner collapse animation**: revisit the abandoned reanimated collapse (comment at `ConnectionBanner.tsx:14-16`) with Layout transitions                                                                                            | `src/components/common/ConnectionBanner.tsx`                                                 |

## Ops canary (standalone, not a PR to the app)

Temporal report-only cron task: fetch `https://<tailnet-tasknotes>/api/engine-status`, email if `skippedFiles.length > 0` or fetch fails. Would have caught the 2026-07-12 pay-rent corruption same-day (found on day 10 instead). `temporal-agent-task` block in a new `packages/docs/guides/` runbook doc + operator schedules via `packages/temporal/scripts/schedule-agent-task.ts`. Server URL/token sourcing confirmed at schedule time (operator step).

## Verification

- Per PR: `bunx turbo run typecheck test lint --filter=tasks-for-obsidian`; `bun run scripts/check-release-bundle.ts` (Archive-bundle guard); `bun run verify -- --affected` before push.
- Maestro (`bun run e2e`, local pre-merge gate per AGENTS.md): extend flows — reschedule via sheet (assert vault frontmatter `scheduled`/`due` bytes), bulk reschedule of 3 seeded tasks, recurring complete → undo → assert `complete_instances` unchanged.
- PR media (per repo rules — animations need motion): simulator **videos/GIFs** for the sheet spring + calendar, undo toast lifecycle, full-swipe commit, zero-state celebration, selection flow; **screenshots** for TaskDetail editors, autocomplete, pending dots, both themes (`xcrun simctl io booted recordVideo` / `screenshot`, upload via `toolkit pr asset`).
- Accessibility spot-check per PR: VoiceOver labels on new elements, reduce-motion path exercised (toggle in simulator Settings).
- Contract suite (`bun run test:contract`) — unchanged fields already covered; add `scheduled: null` clear case.

## Worktree / process

One worktree `.claude/worktrees/todoist-ergonomics` (`mise install && bun install --frozen-lockfile && bunx turbo run generate`, `bun run pod-install` for e2e). git-spice stack: PR1 → PR2 → PR3 → PR4 → PR5, `git-spice stack submit`. Mirror this plan to `packages/docs/plans/2026-07-22_todoist-ergonomics-wave.md` before implementation.

## Backlog (deliberately out)

User-defined saved views + board layout (would retire hardcoded `JobSearchKanbanScreen`), completed-history view, Upcoming day-grouping, tap-to-unparse, configurable swipe actions, zeego replacement (existing todo `tasks-for-obsidian-context-menu-rn85`), server watcher batch-refresh fix. Reminders/due-times & subtasks/sections stay deferred per the first-in-class plan.

## Remaining

- [ ] PR1 — reschedule sheet + scheduled/due editing + quality ratchet
- [ ] PR2 — org editing in TaskDetail + NLP expansion + autocomplete
- [ ] PR3 — recurring-completion undo toast
- [ ] PR4 — multi-select bulk edit
- [ ] PR5 — delight & polish pass
- [ ] Ops canary on engine-status skippedFiles (Temporal report-only cron)
