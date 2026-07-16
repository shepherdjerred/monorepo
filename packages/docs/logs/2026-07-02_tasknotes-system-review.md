# TaskNotes System Review — server, types, app, and Obsidian integration surface

## Status

Complete

## Scope

Full review of `packages/tasknotes-server`, `packages/tasknotes-types`, and
`packages/tasks-for-obsidian`, scoped to the basic Todoist feature set:
creating tasks, recurring tasks, descriptions, and organization
(projects/tags/contexts/priority/status/filtering). Includes both Obsidian
integration surfaces:

- **File surface**: server-written frontmatter vs. what the real TaskNotes
  plugin (callumalpass/tasknotes) reads/writes in a shared vault.
- **API surface**: whether the app works against the real plugin's HTTP API,
  and whether the server faithfully mirrors that API.

Five parallel review agents covered: (1) CRUD + `details` through the vault
layer, (2) recurrence system-wide, (3) organization/query/filtering,
(4) app data layer (client/cache/sync/queue), (5) upstream plugin
compatibility (verified against upstream `main`, `@tasknotes/model@0.2.1`,
and `docs/HTTP_API.md`). Load-bearing claims were verified empirically by
executing the actual package code (Zod schemas, gray-matter, date logic).

## Verdict

The system works only in the narrow lane it was tested in: tasks created by
this server, read by this app, one at a time, online, in UTC. Step outside
that lane — a task created in Obsidian, a recurring task, an offline edit, a
US timezone — and it silently loses or corrupts data. Two root-cause design
decisions produce most of the findings:

1. **Fail-silent parsing over an open format.** `frontmatterToTask` returns
   `undefined` on any Zod failure and `scanVault` skips the file with no log
   (`task-mapper.ts:116-117`, `reader.ts:42-44`). Combined with strict/closed
   schemas over user-configurable, loosely-typed frontmatter, whole classes of
   valid plugin-written files silently vanish from the API.
2. **Every mutation has two execution paths.** The app enqueues into the
   MutationQueue _and_ calls the API directly _and_ replays the queue on
   success, with no dequeue-on-success, no single-flight lock, and no temp-ID
   reconciliation (`TaskContext.tsx`). Every online mutation executes twice.

---

## Critical

### 1. Every online mutation executes twice — duplicate notes, lost recurring completions, poison deletes

`tasks-for-obsidian/src/state/TaskContext.tsx:177-188` (create), `:221-231`
(update), `:249-254` (delete), `:277-298` (toggle);
`src/data/sync/MutationQueue.ts:173-189`.

Each mutation is enqueued, then the client is called directly, then on
success `mutationQueue.replay(client)` runs — and nothing removes the
just-enqueued entry (replay only removes what _it_ executed). Consequences,
verified against server code:

- **create** → two `POST /api/tasks` → a duplicate vault note on every
  successful online create.
- **complete_instance** → the server endpoint is a _toggle_
  (`task-store.ts:202-206`), so the replay un-completes what the direct call
  completed. Every online completion of a recurring task is silently lost;
  UI shows it done until the next sync reverts it.
- **delete** → replayed DELETE 404s → `NotFoundError` → mutation kept and
  retried forever; `pendingMutationCount` permanently ≥ 1.
- **update/toggle_status** → idempotent by luck (absolute payloads).

Also no single-flight lock anywhere: mount effects, pull-to-refresh
(bypasses `syncNow`'s guard via `use-tasks.ts:109`), reconnect sync, and
post-mutation replay can all run `replay` concurrently over the same queue
snapshot, double-executing offline-queued mutations exactly at reconnect.
`restore()` (`MutationQueue.ts:195-218`) can also clobber an entry enqueued
before the async restore resolves.

**Fix direction**: make the queue the only execution path (dequeue on
success, single-flight replay). This one design change resolves most of the
sync-layer findings.

### 2. Plugin/Obsidian-written tasks silently vanish from the server (and app)

`tasknotes-server/src/vault/task-mapper.ts:84-117`, `reader.ts:34-62`,
`frontmatter.ts:12`. Four independent, empirically-confirmed triggers, each
of which drops the _entire task_ with no log:

- **Unquoted YAML dates** (`due: 2026-03-01`) — gray-matter/js-yaml parses
  them as JS `Date` objects; `z.string()` fails. Obsidian's properties UI and
  the plugin's `processFrontMatter` write dates unquoted. Recurring tasks are
  the worst case: `complete_instances` accumulates unquoted dates on every
  Obsidian-side completion.
- **Missing `title`** — upstream default is `storeTitleInFilename: true`, so
  the plugin writes _no title key_ by default; the schema requires it.
- **`status: none`** — in the plugin's _default_ status cycle; the server's
  closed enum (`task-mapper.ts:5-20`) rejects it, along with every
  user-configured status/priority.
- **Lenient-typed fields** — scalar `tags: task` / `contexts: home`,
  string-form `blockedBy: ["[[Other]]"]` all fail the strict array/object
  schemas.

Net: with an out-of-the-box TaskNotes install, essentially every
desktop-created task is invisible to the server and therefore to the mobile
app. Because the watcher rescan _replaces_ the map (`task-store.ts:47-53`),
a task the app is displaying disappears mid-session the moment Obsidian
rewrites its frontmatter.

### 3. Server-created tasks are invisible to the plugin in Obsidian

- **No `task` tag**: the plugin identifies task notes by
  `tags` containing `settings.taskTag` (default `"task"`); the server never
  injects it (`task-store.ts:80`, `task-mapper.ts:192`). Mobile-created tasks
  don't exist in any TaskNotes view on desktop.
- **Archive semantics fork**: server reads/writes a _boolean_ `archived`
  field (`task-mapper.ts:103,204`); the plugin archives by adding an
  `archived` _tag_ to `tags`. The two archive states never converge.

### 4. Recurrence is a stored string, not a feature

No `rrule` dependency (or hand-rolled parser) exists in any of the three
packages. Storage fidelity with upstream is good (`recurrence`,
`recurrence_anchor`, `complete_instances` round-trip), but:

- **Occurrences are never computed.** App Today/Upcoming filter only on
  `due` (`use-tasks.ts:50-67`); `scheduled` is read by _nothing_ in screens/
  hooks/components; server calendar emits one event per task with no
  expansion (`routes/calendar.ts:13-18`). An upstream-style recurring task
  (rrule anchored on `scheduled`, no `due`) never appears anywhere in the
  app; one with a `due` shows as overdue every day forever.
- **No creation/edit surface.** QuickAdd never sends recurrence; neither NLP
  parser has recurrence grammar — "water plants every monday" becomes a
  one-off task titled "water plants every" due next Monday. TaskDetail shows
  the raw RRULE string read-only.
- **No completion feedback.** No UI reads `completeInstances`
  (zero hits in screens/components); the checkbox never checks for recurring
  tasks, inviting the double-tap that (per the toggle endpoint) un-completes
  it. Double-tap before re-render also queues two toggles that cancel out
  (`TaskContext.tsx:262-303`).
- **Timezone skew**: server records "server-local today"
  (`task-store.ts:202`, UTC in K8s) while the app optimistically records
  device-local today (`domain/recurrence.ts:15-23`) — they differ from ~5pm
  PT to midnight, and the endpoint accepts no explicit date to reconcile
  (`routes/tasks.ts:111-118`).

---

## High

### 5. Date-only strings parsed as UTC midnight, compared with local getters

`tasks-for-obsidian/src/hooks/use-tasks.ts:7-34`, `src/lib/dates.ts:5-7`.
Verified under `TZ=America/Los_Angeles`: a task due _today_ classifies as
`isToday=false, isOverdue=true`; a task due _tomorrow_ classifies as today.
Every day-bucketed view (Today, Upcoming, overdue styling, widget stats) is
shifted by one day for any negative-UTC-offset user. The correct pattern
already exists at `domain/recurrence.ts:4-9` (`localTodayYmd`).

### 6. Stale write-after-read clobbers concurrent Obsidian edits

`tasknotes-server/src/store/task-store.ts:113-162` (also `archive`,
`completeRecurring`). Updates serialize the whole file from the in-memory
snapshot — no re-read, no mtime/hash check, no merge. In-memory state can be
stale by ≥ the watcher debounce (or forever, see #12). Edit a note body in
Obsidian, then toggle priority in the app → the Obsidian edit is permanently
lost. If the file was moved, the write resurrects it at the old path
(duplicate files, same `id`).

### 7. Body (`details`) whitespace destructively normalized on every write

`tasknotes-server/src/vault/frontmatter.ts:16,24-26`. `.trim()` strips
leading indentation of the first body line (breaks indented code blocks) and
trailing blank lines/hard-breaks; because #6 rewrites the body on any
field change, updating priority from the app is enough to corrupt a body.
Round-trip also mangles YAML types in `extraFields`: an unquoted custom date
`applied_on: 2026-03-01` re-serializes as `2026-03-01T00:00:00.000Z`
(verified), and every server write injects a foreign `id:` key into
plugin-managed files (`task-mapper.ts:181-183`).

### 8. Offline-created tasks vanish; edits to them are permanently doomed

- `SyncEngine.applyOptimistic` for `create` is an explicit no-op
  (`SyncEngine.ts:52-64`) and `fullSync` replaces map+cache wholesale — if a
  queued create fails replay while `listTasks` succeeds, the user's task
  disappears from UI and cache with no error (behavior pinned in
  `SyncEngine.test.ts:270-280`).
- No temp-ID reconciliation: offline edits/toggles/deletes of a just-created
  task are queued against `tmp-…` IDs that 404 forever after the create
  replays (`TaskContext.tsx:137-177`).
- No retry cap / permanent-error classification (`MutationQueue.ts:177-189`):
  400/401/404 mutations retry forever. Renaming a note in Obsidian while an
  edit is queued orphans that edit permanently (IDs derive from file path,
  `task-mapper.ts:42-49`).
- Every mutation path returns `ok(...)` on _any_ failure
  (`TaskContext.tsx:192,234,257,301`) — the UI can never distinguish "saved"
  from "failed"; no rollback exists.

### 9. Hardcoded status/priority enums bake the closed-world assumption into everything

`task-mapper.ts:5-20`, `tasknotes-types/src/schemas.ts:5-25`,
`domain/status.ts`, `domain/priority.ts`. Upstream statuses/priorities are
arbitrary user-configured strings with per-status `isCompleted` flags. The
enums cause #2 (dropped tasks), wrong stats buckets
(`task-store.ts:28-34,293-307` — archived done tasks count as both
`completed` and `archived`), `/api/filter-options` returning the enum rather
than vault values (`task-store.ts:319-337`), and `getNextStatus` cycling a
workflow the user may not have. Also: one task with `status: none` or an
`icsEventId` array **fails the whole `TaskListResponseSchema`**, bricking the
entire task list in the app against the real plugin.

### 10. Projects exist in two disjoint spellings that never match

The plugin stores `projects: ["[[Foo]]"]`; the server NLP and app QuickAdd
store bare `Foo` (`nlp/parser.ts:73-75`, `lib/nlp.ts:97-99`,
`TaskContext.tsx:151-154`). All matching is exact string equality
(`task-store.ts:232-237`, `filters.ts:53-55`, `ProjectDetailScreen.tsx:33`).
No wikilink parsing exists anywhere: filter by `Foo` never matches `[[Foo]]`;
Browse lists both as separate projects; aliases (`[[Foo|alias]]`) and paths
(`[[Projects/Foo]]`) are further unmatched spellings. The hardcoded
`[[2026 Job Search]]` saved view only works for tasks created with the
bracketed form; quick-added tasks can never enter it. Raw `[[…]]` strings
render verbatim in the UI, and path wikilinks break the
`project/:projectName` deep-link route.

### 11. App is validation-dead against the real plugin beyond basic CRUD

(Upstream verified; app schema failures reproduced with the real Zod
schemas.)

- **Wrong paths**: time tracking is `/api/tasks/:id/time/start|stop`
  upstream, not `/api/time/:id/start|stop`; calendar is
  `/api/calendars/events` (plural), not `/api/calendar/events` → 404s.
- **Wrong shapes**: DELETE data is `{message}` not `{success}`; archive
  returns the task, app parses `DeleteResponseSchema`; filter-options
  statuses/priorities are config _objects_ upstream, app expects strings;
  pomodoro state shape differs (`active` vs `isRunning`); time summary is a
  `TimeSummaryResult` not `{totalTime, entries}`; NLP returns
  `{parsed, taskData}` / `{task, parsed}`, app expects flat shapes → all fail
  Zod and error out.
- **Casing**: upstream API JSON uses `complete_instances` /
  `recurrence_anchor` (snake_case); `tasknotes-types` uses camelCase with
  `.default([])` — recurring completion state silently reads as empty against
  the plugin.
- **Query**: upstream `POST /api/tasks/query` takes a `FilterQuery` tree; app
  sends the flat filter (and the server ignores the tree — see #13). Upstream
  caps `limit` at 200; the app requests 1000 and never paginates.
- **toggle-status**: upstream reads no body and cycles the user's workflow;
  the app's computed status is ignored → optimistic UI diverges.

### 12. Fail-silent vault reader + fragile watcher

- All read errors swallowed (`reader.ts:34-38,60-62`): a transient `readdir`
  failure mid-rescan returns an _empty map_ which `init()` installs — API
  reports zero tasks with no log.
- Watcher (`watcher.ts:14-18`): trailing-edge debounce with reset — a
  sustained sync event stream postpones rescan indefinitely; `null` filenames
  dropped; no `error` listener on the `FSWatcher` (unhandled error event =
  process crash) and no re-arm if the watched dir is replaced.

---

## Medium

13. **`POST /api/tasks/query` strips unknown keys** — an upstream FilterQuery
    tree body parses to `{}` and returns the whole vault, archived included
    (`routes/tasks.ts:36-44`, `task-store.ts:219-220`; `FilterQuerySchema` in
    tasknotes-types has zero call sites). `GET /api/tasks` likewise ignores
    all filter params silently (`routes/tasks.ts:13-26`). `.strict()` the
    schemas; filter archived in `query()`.
14. **Any note with `title:` becomes a task** — no task-tag check on read
    (`task-mapper.ts:82-109`); with the default `TASKS_DIR=""` the whole
    vault is scanned and ordinary notes flood the inbox as open/normal tasks.
15. **`toggle-status` route doesn't toggle** — verbatim copy of the PUT
    handler (`routes/tasks.ts:88-100`); empty-body POST is a 200 no-op. Any
    non-app client (Siri intent, curl) following upstream semantics silently
    does nothing — or worse, `toggle-status` on a recurring task can set
    permanent `status: done`, killing the cadence (only the app's client-side
    guard prevents this today).
16. **`/api/time/summary` unreachable** — `GET /api/time/:id` registered
    first (`routes/time.ts:20-30`), so `summary` resolves as `:id="summary"`
    → always `{totalTime: 0, entries: []}`. Also time entries live in
    `_tasknotes/time-tracking.json`, not task frontmatter where the plugin
    keeps them (`time-store.ts:21` vs upstream `TimeTrackingController`) —
    time tracked on either side is invisible to the other.
17. **1000-task truncation** — `listTasks` hardcodes `?limit=1000`, discards
    `hasMore` (`TaskNotesClient.ts:59-67`); server default limit 1000
    unclamped, unvalidated (`?limit=abc` → NaN → empty page), unstable
    ordering across rescans (no sort) breaks paging clients.
18. **Round-trip strips upstream-required fields** — `reminders[].id`
    (required upstream for UI keying), `reminders[].description`,
    `timeEntries[].description` are dropped by the mapper schemas
    (`task-mapper.ts:29-40`) and rewritten away on the next server edit.
19. **`completedDate` never set** anywhere (`task-store.ts:120-157,190-199`)
    — completion timestamps, a Todoist basic, are lost. `details` can't be
    cleared via `null` (schema only allows string), and `""` desyncs memory
    from disk. Archive is one-way via API (no unarchive; `PUT` can't set
    `archived`).
20. **NLP is single-token and duplicated** — `p:My Project` yields project
    "My"; no quoting; no `!normal`; trailing punctuation glues onto
    values (`@home.`); bare weekday words are always consumed as dates. The
    parser is byte-for-byte duplicated between `server/src/nlp/parser.ts` and
    `app/src/lib/nlp.ts` instead of shared via tasknotes-types — guaranteed
    drift. The server's grammar (`p:`, `!high`) also differs from upstream's
    (`+project`, chrono) so the same input yields different tasks per backend.
21. **ID scheme is fragile** — 8-hex-char (32-bit) IDs with no collision
    check (`writer.ts:21-23`, `task-store.ts:69`); Obsidian-duplicated notes
    share an `id` and shadow each other nondeterministically;
    path-derived IDs (`task-mapper.ts:42-49`) change on rename/move (404s for
    clients, orphaned queue mutations) and collide after case/punctuation
    squashing; upstream uses file path as ID, so the same task has different
    IDs per backend, breaking the app cache when switching.
22. **Sync-state lies** — `lastSyncTime` advances on failed syncs
    (`SyncContext.tsx:63-65`); `fullSync` ignores replay results; queue
    restore/cache load race the first sync (`TaskContext.tsx:86-118`) so
    stale cache can clobber fresh server data; error envelopes without `data`
    fail the envelope parse in Zod 4 so the server's error message is
    replaced by a misleading `ValidationError` (`TaskNotesClient.ts:286-295`,
    verified).
23. **Detail screens show completed tasks** with no default active filter
    (`ProjectDetailScreen.tsx:32-35` etc.) while Browse card counts use
    `isActiveStatus` — count and list disagree. `dueBefore` is inclusive and
    excludes same-day timed dues (`task-store.ts:251-261`).

## Low

- Hardcoded personal saved views (`[[2026 Job Search]]`, `school`) ship as
  `DEFAULT_SAVED_VIEWS` with no user-defined mechanism
  (`saved-views.ts:12-27`); personal tailnet URL is the default server URL
  (`SettingsContext.tsx:41`).
- `NSAllowsArbitraryLoads: true` + any-URL settings lets the keychain token
  travel over plain http.
- One invalid cached task discards the entire offline cache
  (`storage.ts:27-36`).
- Non-Latin titles slug to empty filenames; title renames never rename the
  file; fixed `.tmp` name races concurrent writes to one task.
- Malformed JSON bodies → 500 (no `onError`); `/api/health` exempt from auth
  (upstream authenticates it).
- Timestamp style drift (UTC+ms vs plugin's local+offset) — cosmetic.
- `recurrenceAnchor` round-trips but nothing reads it; dead client methods
  (`queryTasks`, `getFilterOptions`, `getStats`, NLP methods) and dead
  settings (`syncIntervalMs`, `offlineModeEnabled`); no periodic task sync —
  remote Obsidian edits appear only on foreground/reconnect/pull-to-refresh.

## Done well

- Atomic temp-file → rename writes; safe alongside Obsidian's watcher.
- `extraFields` passthrough preserves unknown frontmatter keys — the right
  architecture for a shared vault (the remaining problem is YAML _types_,
  not keys).
- Frontmatter key names match the plugin's `DEFAULT_FIELD_MAPPING` exactly
  where implemented (including the deliberate snake/camel mix); recurrence
  stored as rrule string + `complete_instances` dates matches upstream;
  envelope, Bearer auth, and core CRUD paths match upstream; `TaskStats`
  matches field-for-field.
- Zod at every boundary with zero `as` casts; consistent `Result<T, AppError>`
  taxonomy; token in Keychain with AsyncStorage migration; proper
  AbortController timeouts.
- Priority sort is numeric; due-date sort places missing dates last, both
  directions tested; `applyFilter` AND/OR semantics clean and tested.
- `localTodayYmd` (`domain/recurrence.ts:4-9`) is the correct local-date
  pattern — the fix for the UTC bug is copy-paste distance away.

## Recommended fix order

1. **Make the MutationQueue the sole execution path** (dequeue-on-success,
   single-flight replay, temp-ID rewrite, permanent-error dead-letter) —
   fixes #1 and most of #8 in one design change. Data loss happening today.
2. **Make the vault reader tolerant + loud**: coerce YAML `Date` → string,
   accept scalar-or-array fields, string-form `blockedBy`, missing `title`
   (derive from filename), open string status/priority; log every skipped
   file. Fixes #2 and defuses #9's worst effects.
3. **Write the `task` tag on create; adopt tag-based archive.** Fixes #3.
4. **Parse date-only strings as local dates** in `use-tasks.ts`/`dates.ts`
   (pattern exists in `domain/recurrence.ts`). Fixes #5.
5. **Adopt `rrule` in `tasknotes-types`** as the single shared occurrence
   engine; expand occurrences in Today/Upcoming/calendar; render/author
   recurrence in UI; add a date param to complete-instance. Fixes #4.
6. **Read-modify-write from disk (or mtime guard) in `update()`; stop
   trimming the body.** Fixes #6/#7.
7. **One wikilink normalize/compare helper** in tasknotes-types, applied at
   every create/filter/display site. Fixes #10.
8. **Decide the compat target for the API surface** (#11): either the server
   and app both adopt the upstream contract (paths, shapes, snake_case,
   FilterQuery tree, path-as-id) so the app works against the real plugin,
   or explicitly drop the "works against the plugin API" goal and document
   the server as the only supported backend. The current halfway state is
   the worst of both.

## Follow-up experiment — "Option B: run the real plugin" (same session)

After the review, the user asked to try **option B** (replace the hand-rolled
server with the real TaskNotes plugin running headless). Findings:

### B as stated — official headless CLI running the plugin: NOT POSSIBLE

The `ob` binary in the `obsidian-headless` image comes from the official
`obsidian-headless` npm package (obsidianmd/obsidian-headless; homelab pins
0.0.8, latest 0.0.12). Verified by installing 0.0.12: it is **sync/publish
only** — `login`, `sync-*`, `publish-*`. No plugin runtime, no way to run the
TaskNotes plugin or its HTTP API.

### B′ — full Obsidian desktop (Electron) in a container: possible, not recommended

Images like `sytone/obsidian-remote` run real Obsidian under Xvfb/KasmVNC.
Would give the true plugin API, but: Electron+X in K8s is heavy, first-run
vault trust / restricted-mode needs GUI interaction, the plugin API binds
localhost inside the container, and every Obsidian/plugin upgrade is a
GUI-app upgrade in a pod. Not tested further; dominated by B″.

### B″ — `@tasknotes/model`: VALIDATED, recommended

Upstream publishes the plugin's engine as a pure library:
`@tasknotes/model@0.2.1` ("model, mapping, validation, recurrence, and
operation-planning **reference implementation**"; deps only `rrule`, `yaml`,
`zod`; no Obsidian imports). The plugin v4.11.1 itself depends on exactly
this package, so using it makes file-format drift structurally impossible
for everything it covers.

PoC (scratchpad `ob-test/poc.mjs`, `poc2.mjs`) ran all six review
kill-cases through it — **all pass**:

1. Default plugin-written file (no `title` under `storeTitleInFilename`,
   unquoted YAML dates, `status: none`, scalar `contexts`, string-form
   `blockedBy`) → parses to a correct TaskInfo; dates normalized to strings;
   body preserved byte-for-byte including leading indentation.
2. `detectTaskFile` implements tag-based task identification (title-only
   notes are correctly not tasks).
3. `serializeTaskDocument` writes the `task` tag and honors
   `storeTitleInFilename`.
4. `generateRecurringInstances` expands rrules for real
   (weekly-Monday anchored on `scheduled`, no `due` → correct July dates);
   `shouldShowRecurringTaskOnDate` + `getEffectiveTaskStatus` compute
   per-date display/completion from `complete_instances`.
5. `completeRecurringTask` takes an **explicit `completionDate`** (kills the
   server-local vs device-local TZ skew) and returns updated
   `complete_instances`, next scheduled occurrence, and DTSTART-annotated
   rrule.
6. `taskInfoUpdatesToFrontmatterPatch` + `applyFrontmatterPatch` give
   surgical field-level updates — unknown/custom fields and the body
   survive untouched (the whole-file-rewrite clobbering class disappears).

Bonus coverage found: time-tracking plans (`buildStart/StopTimeTrackingPlan`)
write `timeEntries` into frontmatter the way the plugin does — fixing the
"time tracked in `_tasknotes/time-tracking.json` is invisible to Obsidian"
finding. Also `validateTask`, status/priority config resolution
(`resolveModelConfig`), field-mapping support, and a conformance suite
(`executeConformanceOperation`, `TASKNOTES_SPEC_VERSION`).

### Resulting recommendation (refines review item 8)

Adopt B″ = architecture A implemented with upstream's own code:

- **tasknotes-server**: replace `vault/task-mapper.ts`, `vault/frontmatter.ts`,
  and the parse/serialize/recurrence logic in `task-store.ts` with
  `@tasknotes/model` (`parseTaskDocument`/`detectTaskFile` on read;
  read-modify-write + `applyFrontmatterPatch` on update;
  `serializeTaskDocument` on create; `completeRecurringTask` with explicit
  date for complete-instance; `generateRecurringInstances` for
  calendar/today). Move time tracking into frontmatter via the model's plans.
- **tasknotes-types**: re-export the model's `TaskInfo`/schemas instead of a
  parallel camelCase copy (aligns the app with upstream field names).
- **app**: use the model for recurrence display/effective status; fix the
  mutation-queue double-execution independently (unrelated to B).
- Custom-by-design remains: HTTP layer, watcher, NLP, pomodoro.

Caveats: the package is a month old (2 releases); pin it and let Renovate
track it. The model's `TaskInfo` uses snake_case (`complete_instances`) —
adopting it is a breaking change to the app's schemas, which is the point.

## Session Log — 2026-07-02

### Done

- Full multi-agent review of tasknotes-server, tasknotes-types,
  tasks-for-obsidian, and both Obsidian compat surfaces (file format + HTTP
  API vs upstream callumalpass/tasknotes). Findings consolidated in this log.
- Cross-checked against prior work: the 2026-05-10 recurring/wiring plan
  (PRs #729–736) and `todos/tasks-for-obsidian-e2e.md`. Three findings were
  already flagged as follow-ups there (no retry/backoff, temp-ID one-way,
  midnight TZ divergence) — now confirmed live, with the double-execution
  bug (#1) being new and worse than what was tracked.

- Ran the "option B" feasibility experiment (see section above): official
  headless CLI cannot run plugins; full-Obsidian-in-container is possible but
  dominated; `@tasknotes/model` (upstream's own engine as a library) passes
  all six review kill-cases — validated as the recommended path.

### Remaining

- No production code changes made (review + PoC session). Fixes per
  "Recommended fix order" above; #1 (mutation double-execution) and #2
  (silent vault drops) are active data-loss bugs and should go first.
- Next session: rebuild `tasknotes-server`'s vault/domain layer on
  `@tasknotes/model` per the B″ recommendation, and migrate
  `tasknotes-types` to re-export the model's types.

### Caveats

- Findings marked "verified empirically" were confirmed by executing package
  code; other findings were verified by reading code but not executed.
- Upstream compat was checked against tasknotes `main` and
  `@tasknotes/model@0.2.1` on 2026-07-02; upstream moves fast.
