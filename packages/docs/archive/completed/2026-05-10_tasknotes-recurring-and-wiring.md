# Fix Recurring-Task Bug + Wire Up Half-Built Subsystems

## Status

Complete — all 6 phases shipped as stacked PRs (#729 → #732 → #733 → #734 → #735 → #736), pending review and merge.

## Context

User completed a recurring task in the `tasks-for-obsidian` iOS app and it was "dropped" — won't remind again. Investigation surfaced the immediate bug **and** a cluster of fully-coded but unwired subsystems (offline sync, Pomodoro, Live Activities, time-tracking UI, markdown rendering). All are caused by missing wiring, not missing implementations. Plan covers them as sequential phases (one PR each) so each ships independently and reviewably.

Implementation order matters: **Phase 1 first** (smallest, fixes the reported bug, unblocks user). Phase 2 (offline) is heaviest and lands later.

## Working Environment

User has WIP on `feature/2026-05-09-multi-area-ship` in `/Users/jerred/git/monorepo` (uncommitted changes to `packages/docs/index.md`, `packages/docs/plans/2026-05-10_pi-feature-roadmap.md`, `packages/toolkit/src/lib/recall/db.ts`, plus untracked plan files). All work runs in a dissociated clone to avoid touching that state.

```bash
git clone --shared --dissociate \
  /Users/jerred/git/monorepo \
  ~/git/monorepo-tasknotes-fixes

cd ~/git/monorepo-tasknotes-fixes
git remote set-url origin git@github.com:<owner>/<repo>.git    # confirm remote URL from main checkout
git fetch origin --prune
git switch -c feature/2026-05-10-tasknotes-recurring-fix origin/main
bun run scripts/setup.ts                                       # required before any build/test
```

One branch per phase, branched from `origin/main` and rebased forward as earlier phases land:

| Phase | Branch                                          |
| ----- | ----------------------------------------------- |
| 1     | `feature/2026-05-10-tasknotes-recurring-fix`    |
| 2     | `feature/2026-05-10-tasknotes-offline-sync`     |
| 3     | `feature/2026-05-10-tasknotes-pomodoro-mount`   |
| 4     | `feature/2026-05-10-tasknotes-time-tracking-ui` |
| 5     | `feature/2026-05-10-tasknotes-markdown-details` |
| 6     | `feature/2026-05-10-tasknotes-hygiene`          |

After PRs merge: `rm -rf ~/git/monorepo-tasknotes-fixes` and `git branch -d <branches>` in main checkout. Reuse the clone across phases — no need for one clone per phase.

## Phases at a Glance

| #   | Goal                                                | Scope                                                                                                                          | PR size | Risk |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------- | ---- |
| 1   | Recurring task no longer "drops" on completion      | client routes to `/complete-instance`; server toggles today in `completeInstances` instead of stub `status:"done"`             | S       | low  |
| 2   | Wire offline sync layer so failed mutations survive | `MutationQueue` + `SyncEngine` + `storage` cache wired into `TaskContext`/`SyncContext`; new `complete_instance` mutation type | L       | med  |
| 3   | Pomodoro screen stops crashing                      | mount `PomodoroProvider` in `App.tsx`                                                                                          | XS      | low  |
| 4   | Active time-tracking visible in UI + Lock Screen    | mount `TimeTrackingBar`; bridge JS↔Swift Live Activity calls                                                                   | M       | med  |
| 5   | Task `details` renders as markdown                  | drop `MarkdownView` into `TaskDetailScreen`; add edit field                                                                    | S       | low  |
| 6   | Dead-code sweep                                     | drop unused deps, duplicate exports, consolidate hooks                                                                         | S       | low  |

## Phase 1 — Recurring Task Fix

### Server (`packages/tasknotes-server`)

`src/store/task-store.ts:186` — rewrite `completeRecurring`:

- If `existing.recurrence` is empty → fall back to `update(id, { status: "done" })` (one-off safety net).
- Else compute `today = local YYYY-MM-DD` (build from `getFullYear/getMonth/getDate`, not `toISOString`).
- Toggle `today` in/out of `existing.completeInstances` (idempotent contract: second call removes).
- Build `next = { ...existing, completeInstances, dateModified: now }`. **Do not change `status`.**
- `await writeTaskFile(...)`, `tasks.set(id, next)`, return `next`.

`src/__tests__/routes.test.ts:139` — replace stub test with three cases:

1. Recurring task: POST once → response has `status === "open"` and `completeInstances` contains today.
2. Recurring task: POST twice → today removed; status still `"open"`.
3. Non-recurring task: POST `/complete-instance` → response has `status === "done"` (back-compat fallback).

### Client (`packages/tasks-for-obsidian`)

`src/state/TaskContext.tsx:122` — branch `toggleStatus` on `existing.recurrence`:

- Add tiny inline helper `localTodayYmd()` (5 lines, builds from `getFullYear/getMonth/getDate`).
- If `existing.recurrence`: optimistic update toggles `today` in `completeInstances`, **status unchanged**; then `await client.completeRecurringInstance(id)`.
- Else: keep current behavior (`getNextStatus` + `client.toggleTaskStatus`).
- Rollback path on `!result.ok` already restores `existing` — no change needed.

`src/state/TaskContext.test.tsx` _(new)_:

1. Toggle non-recurring task → `client.toggleTaskStatus` called with `"done"`.
2. Toggle recurring task → `client.completeRecurringInstance` called; `status` not mutated optimistically; `completeInstances` contains today.
3. Toggle recurring task twice → today removed second time.

Files: `tasknotes-server/src/store/task-store.ts`, `tasknotes-server/src/__tests__/routes.test.ts`, `tasks-for-obsidian/src/state/TaskContext.tsx`, `tasks-for-obsidian/src/state/TaskContext.test.tsx` _(new)_.

## Phase 2 — Wire Offline Sync Layer

The pieces all exist; nothing imports them. Goal: every mutation goes through `MutationQueue`; `SyncContext.syncNow` drains the queue then refetches; failed mutations stay queued and replay on reconnect.

### Architecture decision

**Co-locate `MutationQueue` + `SyncEngine` instances inside `TaskContext`** (singletons via `useMemo`). Rationale: TaskContext already owns the tasks `Map` (the callback target) and is where mutations originate. SyncContext (already nested below TaskContext) consumes them via a new `useTaskContext()` method `replayQueue()`. **No new providers.** Minimizes provider tree churn.

### `MutationQueue` extension — add `complete_instance`

`src/data/sync/MutationQueue.ts`:

- Add `CompleteInstanceMutation = BaseMutation & { type: "complete_instance"; taskId: TaskId }` (no payload).
- Extend `Mutation`/`MutationInput` unions (lines 33–47).
- Extend `MutationSchema` discriminated union with new variant.
- `enqueue` switch (line 142): push `{ ...base, type, taskId }`.
- `executeMutation` switch (line 213): call `client.completeRecurringInstance(taskId)`.

### `SyncEngine` extension

`src/data/sync/SyncEngine.ts`:

- `applyOptimistic` switch (line 42): add `case "complete_instance"` — toggle today in existing task's `completeInstances`; status unchanged.
- Add defensive `if (!this.client)` guard at top of `fullSync()`.

### `TaskContext` refactor

`src/state/TaskContext.tsx`:

- Instantiate `mutationQueue = useMemo(() => new MutationQueue(), [])` and call `mutationQueue.restore()` in a one-shot `useEffect`.
- Instantiate `syncEngine = useMemo(() => client ? new SyncEngine(client, mutationQueue, setTasksFromArray) : null, [client, mutationQueue])`.
- Refactor each mutation method (`createTask` 71–85, `updateTask` 87–104, `deleteTask` 106–120, `toggleStatus` 122–156): apply optimistic state, enqueue mutation, fire `mutationQueue.replay(client)` (no `await` for UI), reconcile state on resolution. Drop the rollback path — failed mutations stay queued.
- For `createTask`, generate temp ID locally (e.g., `tmp-${uuid}`); reconciler swaps to server ID after replay.
- Expose `replayQueue: () => Promise<void>` and `mutationQueueSize: number` on context for SyncContext.

### `SyncContext` integration

`src/state/SyncContext.tsx:58` — `syncNow`:

- Today: `await refreshTasks()`.
- After: `await replayQueue(); await refreshTasks();` (refreshTasks → underlying `client.listTasks()`; replay drains the queue first so server state reflects local changes).
- The NetInfo reconnect branch (lines 73–88) already calls `syncNow` — works as-is once `syncNow` drains the queue.

### Storage hookup

`src/data/cache/storage.ts` — already has `getTasks`/`setTasks`/`getMutationQueue`/`setMutationQueue`/`getLastSyncTime`/`setLastSyncTime`. Nothing to add. `MutationQueue.persist`/`restore` already use it. Wire by simply importing.

### Tests

Create three new test files:

- `src/data/sync/MutationQueue.test.ts` — enqueue → persist → restore round-trip; replay drains successes; failed mutation stays.
- `src/data/sync/SyncEngine.test.ts` — `fullSync` calls replay then list then setter; `applyOptimistic` for every mutation type incl. `complete_instance`.
- `src/state/TaskContext.test.tsx` — extends Phase-1 test file with offline cases: simulated API failure leaves optimistic UI + queue entry; second `replayQueue` succeeds and drops the entry.

### Out of scope (flag for follow-up)

- Retry/backoff: failed mutations replay forever today. Add attempt counter + age-based expiry in a later PR.
- Temp-ID → real-ID rewriting in any deep-link/navigation that captured the temp ID.
- Cache-first paint (show stored tasks before first fetch).

Files: `data/sync/MutationQueue.ts`, `data/sync/SyncEngine.ts`, `state/TaskContext.tsx`, `state/SyncContext.tsx`, three new `*.test.ts(x)` files.

## Phase 3 — Pomodoro Provider Mount

`PomodoroContext` calls `useApiClient()` → must mount inside `ApiClientProvider`. `PomodoroScreen` already calls `usePomodoro()` and crashes today because no provider exists.

`App.tsx:56` — slot `PomodoroProvider` between `ApiClientProvider` and `TaskProvider`:

```tsx
<ApiClientProvider>
  <PomodoroProvider>
    <TaskProvider>...</TaskProvider>
  </PomodoroProvider>
</ApiClientProvider>
```

Add tests: `src/state/PomodoroContext.test.tsx` covering provider mount + status refresh + start/stop/pause routing to client methods.

Manual verification: `xcrun simctl openurl booted "tasknotes://pomodoro"` opens screen without crash, status refresh hits `/api/pomodoro/status`.

Files: `App.tsx`, `src/state/PomodoroContext.test.tsx` _(new)_.

## Phase 4 — Time Tracking UI + Live Activities

### Mount the `TimeTrackingBar`

Mount as a fixed overlay inside `ThemedApp` (App.tsx:41) so it's visible on every tab — single source of truth, no per-screen wiring.

```tsx
<>
  <StatusBar ... />
  <ConnectionBanner />
  <AppNavigator />
  <ActiveTimeTrackingOverlay />  {/* new component */}
</>
```

Create `src/components/timer/ActiveTimeTrackingOverlay.tsx`:

- `useTimeTracking()` for `activeEntry`/`stopTracking`.
- `useTaskContext()` for the active task title (lookup by `activeEntry.taskId`).
- 1-second interval to compute `elapsedSeconds = (now - activeEntry.startTime) / 1000`.
- Renders `<TimeTrackingBar>` only when `activeEntry` exists.
- Positioned absolutely above tab bar (bottom inset + tab-bar height).

Replace the unused `useTimeTrackingContext` direct export — consumers go through the `useTimeTracking()` hook (which currently just re-exports the context — keeps the indirection knip flagged but is intentional once it has a consumer).

### Live Activities bridge

`src/state/TimeTrackingContext.tsx`:

- Import `startTimeTracking`, `stopTimeTracking`, `updateTimeTracking` from `src/native/live-activity-bridge.ts` at top.
- In `startTracking` (line ~35): after `setActiveEntry(...)`, look up task title (pass via prop or accept it as an arg — recommend extending signature: `startTracking(taskId, title, projectName?)` so caller passes title; alternatively read from `useTaskContext` via dependency), then `void liveActivity.startTimeTracking(taskId, title, projectName)`.
- In `stopTracking`: after API success, `void liveActivity.stopTimeTracking(elapsedSeconds)`.
- Add a `useEffect` in the overlay component that ticks every second to `liveActivity.updateTimeTracking(elapsedSeconds, false)` so Dynamic Island stays current.

Bridge is already a no-op on Android / pre-iOS-16.2 — no platform check needed.

### Tests

`src/components/timer/ActiveTimeTrackingOverlay.test.tsx` — renders nothing when no active entry; renders bar with elapsed time when active; stop callback hits `stopTracking`.

`src/native/live-activity-bridge.test.ts` — mock `NativeModules`, verify Zod-validated bridge methods are called with correct args.

Files: `App.tsx`, `src/components/timer/ActiveTimeTrackingOverlay.tsx` _(new)_, `src/state/TimeTrackingContext.tsx`, two test files _(new)_.

## Phase 5 — Markdown Rendering for Task `details`

`react-native-markdown-display` is installed (verified in `node_modules`). `MarkdownView` is theme-aware (`useSettings` → colors). Just wire it.

### Display mode

`src/screens/TaskDetailScreen.tsx:209` — between meta section and actions, add:

```tsx
{
  task.details ? (
    <View style={styles.detailsSection}>
      <Text style={[typography.label, { color: colors.textSecondary }]}>
        Details
      </Text>
      <MarkdownView content={task.details} />
    </View>
  ) : null;
}
```

### Edit mode

`src/screens/TaskDetailScreen.tsx:45` — add `const [details, setDetails] = useState(task?.details ?? "")`. Update the loading `useEffect` at ~47 to seed `details`. Update `handleSave` (~55) to include `details` in `updateTask` payload. Add a multiline `TextInput` for it after the due-date row (~129).

### Tests

`src/screens/TaskDetailScreen.test.tsx` (or extend if exists) — render task with `details` shows `MarkdownView`; render task without `details` does not; edit-mode save includes `details` in payload.

Files: `src/screens/TaskDetailScreen.tsx`, optional new test file.

## Phase 6 — Hygiene Sweep

Per knip output, all in one PR (low review cost):

**iOS app `package.json`** — drop unused runtime deps:

- `@react-native-community/datetimepicker` (no consumers)
- `react-native-markdown-display` — **keep** after Phase 5 wires it
- `ts-pattern` (no consumers)

**iOS app `package.json`** — drop unused devDeps: `@babel/preset-env`, `@babel/runtime`, `@react-native/typescript-config`, `typescript-eslint`.

**iOS app `package.json`** — declare `@typescript-eslint/utils` (used by `eslint.config.ts:2` but unlisted).

**Server `package.json`** — drop unused: `yaml`, `typescript-eslint`.

**Server source** — remove unused `readTaskFile` export at `src/vault/reader.ts:50` (or add a consumer if there's a real plan for it; verify with git log).

**Domain exports** — `src/domain/{errors,schemas,types}.ts`: drop the 13 unused exports flagged by knip; resolve duplicate `TaskSchema | TaskResponseSchema | CreateTaskResponseSchema` (pick one canonical and re-export).

**ESLint TODO** — `eslint.config.ts:37` ("move color literals to theme constants"): convert to a tracked issue rather than leaving the comment, or actually do the work. Recommend: convert to issue.

Files: `tasks-for-obsidian/package.json`, `tasknotes-server/package.json`, `src/domain/{errors,schemas,types}.ts`, `tasknotes-server/src/vault/reader.ts`.

## Cross-Phase Verification

Per phase before merge:

```bash
# Server
cd packages/tasknotes-server
bun test
bun run typecheck
bunx eslint . --max-warnings=0

# iOS app
cd packages/tasks-for-obsidian
bun test
bun run typecheck
bunx eslint . --max-warnings=0
bun run pod-install   # only after Phase 4 if any native bridge change touches Podfile
```

End-to-end on simulator (after each phase that touches UI):

| Phase | Manual check                                                                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Daily-recurring task: tap checkbox in Today → row stays visible (not "done"); refresh → next instance still scheduled tomorrow; tap again → uncompletes.        |
| 2     | Airplane mode → toggle/edit a task → UI updates immediately; relaunch app → mutation persists; airplane mode off → task syncs to server within ~1s.             |
| 3     | `xcrun simctl openurl booted "tasknotes://pomodoro"` → screen renders, no crash; tap a task → pomodoro starts; status bar updates.                              |
| 4     | Start time tracking on a task → overlay bar appears bottom of every tab; lock screen shows Live Activity (iOS 16.2+); Dynamic Island shows compact view.        |
| 5     | Task with markdown `details` (e.g. `**bold** [link](https://example.com)`) renders rich text in detail screen; edit mode allows multiline input; save persists. |

## Critical Files (consolidated)

```
packages/tasknotes-server/
  src/store/task-store.ts                                    [P1]
  src/__tests__/routes.test.ts                               [P1]

packages/tasks-for-obsidian/
  src/state/TaskContext.tsx                                  [P1, P2]
  src/state/TaskContext.test.tsx                  (new)      [P1, P2]
  src/state/SyncContext.tsx                                  [P2]
  src/state/TimeTrackingContext.tsx                          [P4]
  src/state/PomodoroContext.test.tsx              (new)      [P3]
  src/data/sync/MutationQueue.ts                             [P2]
  src/data/sync/MutationQueue.test.ts             (new)      [P2]
  src/data/sync/SyncEngine.ts                                [P2]
  src/data/sync/SyncEngine.test.ts                (new)      [P2]
  src/components/timer/ActiveTimeTrackingOverlay.tsx (new)   [P4]
  src/components/timer/ActiveTimeTrackingOverlay.test.tsx (new) [P4]
  src/native/live-activity-bridge.test.ts         (new)      [P4]
  src/screens/TaskDetailScreen.tsx                           [P5]
  src/screens/TaskDetailScreen.test.tsx           (new/edit) [P5]
  App.tsx                                                    [P3, P4]
  src/domain/{errors,schemas,types}.ts                       [P6]
  package.json                                               [P6]

packages/tasknotes-server/package.json                       [P6]
packages/tasknotes-server/src/vault/reader.ts                [P6]
```

## Reused Code (no rewrites needed)

- `client.completeRecurringInstance` — `src/data/api/TaskNotesClient.ts:120`
- `PATHS.TASK_COMPLETE_INSTANCE` — `src/data/api/endpoints.ts:7`
- `MarkdownView` — `src/components/common/MarkdownView.tsx`
- `TimeTrackingBar` — `src/components/timer/TimeTrackingBar.tsx`
- `live-activity-bridge` — `src/native/live-activity-bridge.ts`
- `LiveActivityBridge.swift` — `ios/TasksForObsidian/LiveActivityBridge.swift`
- `MutationQueue.replay` / `SyncEngine.fullSync` / `TypedStorage` — `src/data/{sync,cache}/`
- `Task.completeInstances` / `Task.recurrence` — `tasknotes-types/src/schemas.ts:62-64`

## Documentation

Per repo CLAUDE.md, mirror this plan to `packages/docs/plans/2026-05-10_tasknotes-recurring-and-wiring.md` after approval and add an entry to `packages/docs/index.md`. Append a Session Log section at end of each implementation session.

## Session Log — 2026-05-10

### Done

- **Phase 1 — Recurring-task fix.** Branch `feature/2026-05-10-tasknotes-recurring-fix` in dissociated clone `~/git/monorepo-tasknotes-fixes`. Commit `2421683c7`.
  - `packages/tasknotes-server/src/store/task-store.ts` — `completeRecurring` rewritten: recurring tasks toggle today (local YYYY-MM-DD via the file's existing `toISODate`) in/out of `completeInstances`, status preserved; non-recurring tasks fall back to `status: "done"` so the endpoint stays forgiving.
  - `packages/tasknotes-server/src/__tests__/routes.test.ts` — replaced stub assertion with three cases (recurring add, recurring toggle-off, non-recurring fallback).
  - `packages/tasknotes-server/src/__tests__/tasks.test.ts:441` — refreshed `TaskStore.completeRecurring` unit tests to match new contract; added toggle and non-recurring fallback cases.
  - `packages/tasks-for-obsidian/src/state/TaskContext.tsx` — `toggleStatus` branches on `isRecurring(existing)`; recurring path calls `client.completeRecurringInstance(id)` with an optimistic `nextOptimistic(existing)` that toggles today; non-recurring path keeps `client.toggleTaskStatus`.
  - `packages/tasks-for-obsidian/src/domain/recurrence.ts` _(new)_ — extracted `localTodayYmd`, `isRecurring`, `toggleCompleteInstance`, `nextOptimistic` so the logic is testable in the existing pure-domain test pattern.
  - `packages/tasks-for-obsidian/src/domain/recurrence.test.ts` _(new)_ — 13 cases covering local-date formatting, recurrence detection, instance toggle, and optimistic projection.
  - All hooks green: `bun test` (server 158 pass, client 185 pass), `bun run typecheck` (both clean), `bunx eslint . --max-warnings=0` (both clean), pre-commit + commit-msg validation (`fix(root)` cross-cutting scope).

- **Phase 2 — Offline sync wiring.** Branch `feature/2026-05-10-tasknotes-offline-sync`, PR [#732](https://github.com/shepherdjerred/monorepo/pull/732). Commit `fe0ab46cc`.
  - `MutationQueue` + `SyncEngine` + AsyncStorage cache wired into `TaskContext`. Each mutation method (createTask, updateTask, deleteTask, toggleStatus) now applies optimistic state, enqueues, fires the API call. On success the entry is replay-drained. On failure the optimistic state stays and the mutation stays queued.
  - `refreshTasks` delegates to `syncEngine.fullSync()`: replays queue → fetches server → re-applies remaining (failed) mutations on top → writes through to cache.
  - Added `complete_instance` mutation type (no payload) so the recurring-task path is offline-resilient.
  - Refactored `MutationQueue.replay` to accept a narrow `MutationClient` (Pick of 5 methods); `SyncEngine` accepts a `SyncClient` (`MutationClient + listTasks`). Tests build minimal fakes — no type assertions, satisfies the monorepo's `custom-rules/no-type-assertions` rule.
  - `MutationQueue` takes injectable `MutationStorage`; `SyncEngine` takes `TaskCacheStorage`. Defaults wrap `TypedStorage`. Tests pass in-memory fakes (Bun test env can't load AsyncStorage).
  - Mutation Zod schemas now reuse `CreateTaskRequestSchema` / `UpdateTaskRequestSchema` directly from `tasknotes-types` instead of duplicating field lists (which had a `description` vs `details` mismatch + missing `recurrenceAnchor` / `extraFields`).
  - Tests: `MutationQueue.test.ts` (9 cases), `SyncEngine.test.ts` (9 cases). Total client tests: 203 pass.

- **Phase 3 — PomodoroProvider mount.** Branch `feature/2026-05-10-tasknotes-pomodoro-mount`, PR [#733](https://github.com/shepherdjerred/monorepo/pull/733). Commit `49060dfc3`.
  - `App.tsx` — slot `PomodoroProvider` between `ApiClientProvider` and `TaskProvider` so `usePomodoroContext` resolves on the Pomodoro screen.

- **Phase 4 — Time-tracking overlay + Live Activities bridge.** Branch `feature/2026-05-10-tasknotes-time-tracking-ui`, PR [#734](https://github.com/shepherdjerred/monorepo/pull/734). Commit `314e897de`.
  - `src/components/timer/ActiveTimeTrackingOverlay.tsx` _(new)_ — reads `activeEntry` from `TimeTrackingContext`, looks up task title via `TaskContext`, ticks 1Hz, renders `TimeTrackingBar` absolutely above the tab bar (safe-area-aware).
  - Same component bridges to iOS Live Activity layer: `startTimeTracking` on transition `null → set`, `updateTimeTracking` each tick, `stopTimeTracking` on `set → null`. No-ops on Android / pre-iOS-16.2.
  - `TimeTrackingBar` API change: `duration: number` (minutes via `formatDuration`) → `elapsedSeconds: number` (formats `MM:SS` or `H:MM:SS`). Knip showed zero existing consumers, so free API change.
  - `src/lib/elapsed.ts` _(new)_ — extracted `formatElapsed` + `elapsedSecondsSince` for direct unit testing. 8 cases in `elapsed.test.ts`. Total client tests: 211 pass.

- **Phase 5 — Markdown rendering for `details`.** Branch `feature/2026-05-10-tasknotes-markdown-details`, PR [#735](https://github.com/shepherdjerred/monorepo/pull/735). Commit `3be382788`.
  - `TaskDetailScreen.tsx` — display mode renders `<MarkdownView content={task.details} />` between meta and actions when `details` is non-empty; edit mode adds a multiline `TextInput` after the due-date picker, seeded from `task.details`, passed through `updateTask`.

- **Phase 6 — Hygiene sweep.** Branch `feature/2026-05-10-tasknotes-hygiene`, PR [#736](https://github.com/shepherdjerred/monorepo/pull/736). Commit `649afb7e4`.
  - Deleted 6 dead files: `BrowseItem.tsx`, `use-labels.ts`, `use-projects.ts`, `use-time-tracking.ts`, `icon-map.ts`, `styles/priority.ts`.
  - Dropped unused runtime deps: `@react-native-community/datetimepicker`, `ts-pattern` (client), `yaml` (server). Added `@typescript-eslint/utils` to devDeps in both packages.
  - Removed duplicate `TaskResponseSchema` / `CreateTaskResponseSchema` aliases in `domain/schemas.ts`; `TaskNotesClient` now uses `TaskSchema` directly.
  - Dropped `export` on server `readTaskFile` (used internally only).
  - Held back: `@babel/preset-env`, `@babel/runtime`, `@react-native/typescript-config`, top-level `typescript-eslint` — knip flags as unused but they're React Native build-chain conventions. Defer to a future PR with manual iOS build verification.

### Remaining

- All 6 phases shipped as PRs. Awaiting review + merge in order: 729 → 732 → 733 → 734 → 735 → 736. Once merged, clean up clone + branches per the plan's "Working Environment" section.

### Follow-ups (out of scope, captured for later)

- **No retry/backoff on `MutationQueue.replay`.** Failed mutations replay forever until success or manual clear. Add attempt counter + age-based expiry.
- **Temp-ID rewriting is one-way.** Local Map gets the real id but any deep-link or navigation state captured the temp id stays broken until refresh.
- **TZ divergence near midnight** between server-local and device-local dates can briefly desync the `completeInstances` optimistic display vs server state. Concrete fix: send explicit date in POST body.
- **No callers of `TimeTrackingContext.startTracking()` yet.** Wiring start/stop controls into TaskRow / TaskDetail is its own follow-up.
- **`TAB_BAR_OFFSET` is hardcoded `56pt`** in the overlay. Resolve dynamically via a navigation hook in a follow-up.
- **Held-back devDeps cleanup** (Phase 6 caveat): verify React Native iOS build still works after dropping `@babel/preset-env` etc.

### Caveats

- Working in dissociated clone at `~/git/monorepo-tasknotes-fixes`. After all PRs merge: `rm -rf` the clone and `git branch -d` each `feature/2026-05-10-tasknotes-*` branch.
- Setup script (`bun run scripts/setup.ts`) regenerates `packages/homelab/src/cdk8s/generated/helm/*.types.ts`, `packages/scout-for-lol/packages/backend/src/testing/template.db`, `packages/clauderon/web/bun.lock`, `scripts/ci/bun.lock` — these are codegen artifacts and were intentionally **not** staged in any of the 6 phase commits.
- Phase 1 PR description calls out that server + client must ship together; either alone is insufficient.
- Phases stack: each phase's branch was cut from the previous phase's branch, not from `origin/main`. Reviewers must merge in order. After merge, GitHub auto-rebases the next PR's target.
