# TaskNotes System — First-in-Class Reliability Plan

## Status

In Progress — P1 merged (#1379); P0 in review; P2 next.

### Progress log

- **P1 — MERGED** (#1379): `X-Mutation-Id` idempotency middleware + persisted
  store; `complete-instance` accepts `{date, completed}` set-semantics.
- **P0 — in PR** (branch `feature/tasknotes-p0`): app↔server contract suite
  (18 tests, wired into Dagger/Buildkite); deterministic sync-sim harness
  (FakeServer + injected clock + snapshot storage); Maestro e2e harness
  (orchestrator, chaos proxy, seed vault, 7 flows, testIDs, dev config deep
  link). The harness runs end-to-end; core flows (00–04) pass, offline flows
  (05/06) are P2 acceptance criteria. **Also fixed a chain of fresh-checkout
  iOS build breakages** (all would have hit Xcode Cloud/TestFlight too):
  Sentry pod pin, sub-15 pod deployment targets, react-native-ios-utilities
  RN-0.85 patch, RN-CLI Simulator.app path, Watchman worktree root, zod-v4
  babel transform, react 19.2.6→19.2.3 peer mismatch, and the **iOS-27
  UIScene lifecycle crash**. Filed todos: `mac-mini-buildkite-agent`,
  `scout-data-missing-llm-models-dep`, `tasks-for-obsidian-context-menu-rn85`.

## Context

The 2026-07-02 review (`packages/docs/logs/2026-07-02_tasknotes-system-review.md`, ~40 findings) found the system (iOS app → tasknotes-server → vault PVC ← `ob sync` sidecar ↔ Obsidian Sync ↔ TaskNotes plugin) trustworthy only online, in UTC, for non-recurring server-created tasks. Root causes: (1) every app mutation executes twice (enqueue + direct call + replay, no dequeue); (2) fail-silent strict parsing drops plugin-written files; (3) the server is a drifting hand-rolled clone of the plugin's semantics.

**Goal (user-confirmed):** the app = Todoist ergonomics (instant capture, trustworthy today view, full offline); Obsidian = power interface. "First-in-class" = zero silent data loss, offline-first like Todoist, recurring tasks that work, structural (not best-effort) plugin compatibility.

**Load-bearing prior result (B″, validated by PoC):** `@tasknotes/model@0.2.1` is upstream's engine as a pure library (the plugin itself depends on it). All six review kill-cases pass: tolerant parse, tag-based task detection, correct serialization, rrule expansion, explicit-date recurring completion, surgical frontmatter patches.

## Scope decisions (user-confirmed 2026-07-03)

- **Reliability only.** Recurrence display/expansion/completion IN; recurrence authoring UI, NLP grammar work, reminders/notifications DEFERRED (Obsidian authors recurrence).
- **Full test ladder** incl. Maestro e2e (resolves `packages/docs/todos/tasks-for-obsidian-e2e.md`).
- **Adopt the upstream plugin HTTP API contract** (snake_case, path-as-ID, upstream paths/shapes). Breaking app-schema change accepted (sole user).
- Sequenced PRs, one worktree per phase (`git worktree add .claude/worktrees/tasknotes-p<N> -b feature/tasknotes-p<N> origin/main` + `bun run scripts/setup.ts`). tasknotes-server/-types are NOT workspace members — `cd` into them.

## Target architecture (end state)

- **App**: local store is the single source of truth. UI reads `view = rebase(baseSnapshot, pendingCommands)` — computed, never persisted. Every mutation = an absolute-state command (never a toggle) in a persisted FIFO queue; a single-flight SyncEngine drains it with idempotency keys, temp-ID remap, retry classification, and a dead-letter review UI. Widgets/Siri inherit correctness (they read the same store via JS).
- **Server**: thin Hono layer over `@tasknotes/model`. Read = `detectTaskFile` + `parseTaskDocument` (tolerant, every skip logged loudly). Write = read-modify-write from disk + `applyFrontmatterPatch` (no whole-file rewrites, no body trim, no injected `id:`). Recurrence via `completeRecurringTask`/`generateRecurringInstances`. Time tracking in frontmatter (plugin-visible). IDs = vault-relative paths (upstream). `X-Mutation-Id` dedup persisted under `<vault>/.tasknotes-server/`.
- **Types**: `tasknotes-types` gains `v2` exports re-exporting the model's schemas/types + upstream request/response schemas; legacy camelCase exports deleted at the end.

## Phase sequence

| Phase | PR  | Content                                                                                                                                                                       | Ends the risk of                            |
| ----- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| P0    | 1   | Test foundations: contract test (app client vs spawned real server), sync-sim harness, Maestro harness + testID pass, chaos proxy                                             | flying blind                                |
| P1    | 2   | Server micro-patch (old contract): `X-Mutation-Id` idempotency middleware (reusable) + complete-instance accepts `{date, completed}` set-semantics                            | blocked app rework                          |
| P2    | 3   | **App offline-first sync rework** (against current camelCase API) + local-date fix; TestFlight                                                                                | active data loss                            |
| P3    | 4   | tasknotes-types v2 (additive) + **server rebuild on `@tasknotes/model`** behind upstream contract, with legacy adapter for old paths; migration script (dry-run); vault-audit | format drift, silent drops, clobbered edits |
| P4    | —   | Operational: backup gates → migrate vault `--apply` → post-audit (no PR)                                                                                                      | legacy vault data invisible                 |
| P5    | 5   | App migrates to v2 contract + recurrence display/completion feedback + wikilink projects + archived filtering; Maestro full pass; TestFlight                                  | recurring-task blindness, project duality   |
| P6    | 6   | Cleanup: delete legacy adapter + legacy types exports + old NLP duplication notes; docs; archive plan                                                                         | carrying dead code                          |

Rationale for app-before-server: the double-execution bug is losing data now; the app sync machinery is contract-agnostic (commands store schema-validated payloads — only payload schemas + client change at P5, handled by a storage-version bump).

---

## P0 — Test foundations (`packages/tasks-for-obsidian`, `scripts/ci`, `.dagger`)

- **Contract test** `contract-tests/contract.test.ts` (own `test:contract` script; kept out of the default `bun test src scripts` glob because the regular per-package CI container doesn't mount the server): `Bun.spawn` the real server (`cwd ../tasknotes-server`, temp vault, per-pid port), poll `/api/health`, run the real `TaskNotesClient` method matrix + error paths (404→NotFoundError, bad token→ApiError). Pins the _current_ contract; later keeps the P3 legacy adapter honest. CI: Dagger fn `tasknotes-contract-test` in `.dagger/src/misc.ts` + Buildkite step in `scripts/ci/src/steps/per-package.ts` (emitted for either package changing).
- **Sync-sim harness** `src/data/sync/__tests__/harness.ts`: `FakeServer` (in-memory, path-IDs, `goOffline/goOnline`, `failNext(matcher, error)`, `injectServerEdit`, call log keyed by idempotency key), `MemoryMutationStorage` with `snapshot()/fromSnapshot()` (crash simulation), `MemoryCache`, `makeHarness()`. Prereq: inject a `Clock` into queue/engine (`Date.now()` inlined at `MutationQueue.ts:139` blocks determinism).
- **Maestro harness** `e2e/`: `run.ts` orchestrator (temp vault ← `fixtures/seed-vault/` → spawn server + `chaos-proxy.ts` → `xcrun simctl` boot + build → `maestro test` → **assert final vault markdown bytes** → teardown). Flows: setup, create, complete, recurring-complete, edit, offline-queue, offline-crash-replay. Offline = chaos proxy kill-switch (iOS sim has no airplane mode; Maestro `setAirplaneMode` is Android-only). App gets a `__DEV__`-guarded config deep link (`tasknotes://settings?apiUrl=…&token=…`) in `navigation/linking.ts` + `SettingsContext`. **testID pass** over settings inputs, FAB, task rows/checkboxes, tabs, banners (zero exist today).
- **CI verdict**: Maestro is a local/manual gate (`bun run e2e`) — Buildkite has no macOS agents. Documented as required pre-merge for app PRs.

## P1 — Server micro-patch (`packages/tasknotes-server`, old contract)

- `src/middleware/idempotency.ts` + `src/idempotency/store.ts`: POST/PUT/DELETE under `/api/`; optional `X-Mutation-Id` header; persisted JSON map `mutationId → {status, body, ts}` at `<vault>/.tasknotes-server/idempotency.json` (dot-dir: unscanned, survives restarts — that's the crash-between-ack-and-dequeue protection). On hit: replay stored response + `X-Idempotent-Replay: true`. TTL 7d, cap 500, lazy prune. **Survives the P3 rebuild unchanged.**
- `complete-instance` route/store accept `{date?: string, completed?: boolean}`: `completed` present → set-not-toggle at `date` (device-local, from the app); absent → current toggle (upstream parity). ~30 lines on the old store, superseded at P3 by the model — accepted throwaway.
- Tests for both; deploy via normal image-bump flow.

## P2 — App offline-first sync rework (`packages/tasks-for-obsidian`)

Design (full detail in design notes; files in build order):

1. `src/data/sync/commands.ts` (new): command union — `create{tempId, payload}`, `update{taskId, payload}`, `delete{taskId}`, `set_status{taskId, status}`, `set_instance_complete{taskId, date, completed}` — **absolute target state, never toggles**; command `id` = idempotency key (`Date.now()-counter-randsuffix`); Zod schemas; pure `applyCommand` rebase fn (create **materializes** the optimistic task — fixes the vanish bug; set_status sets, never recomputes; instance-complete is set-union/remove); `materializeCreate`, `remapTaskId`, `isTempId`, `classify(error) → transient|permanent|not_found|auth`.
2. `src/data/cache/migrations.ts` (new) + `storage.ts`: keys `mutation_queue_v2`, `dead_letter`, `id_aliases`, `storage_schema_version`; v1→v2 queue migration (`toggle_status`→`set_status` from payload; `complete_instance`→`set_instance_complete{date: ymdOf(timestamp), completed: true}`); per-element cache salvage (one bad task no longer discards the whole cache).
3. `src/data/sync/MutationQueue.ts` → `CommandQueue`: persistence + FIFO only (no `replay` — execution moves out); `head/ack/deadLetter/retryDeadLetter/discardDeadLetter/remapTaskId`; squash create+delete of same temp ID.
4. `src/data/store/TaskStore.ts` (new): `base` (server snapshot, patched on acks, replaced on pulls), `aliases` (tempId→realId, persisted), memoized `view = rebase(base, pending)`, `subscribe/getSnapshot` for `useSyncExternalStore`, `dispatch(cmd)` = validate → enqueue (only durable write) → notify → `requestSync()` fire-and-forget → return optimistic immediately. **Never calls the network.**
5. `src/data/sync/SyncEngine.ts` rework: `requestSync()` single-flight with coalescing; `syncOnce` = FIFO drain (per command: send with `X-Mutation-Id` → on ack merge into base, persist, `ack()`, remap temp IDs; transient/5xx → stop drain + exponential backoff 1s→60s ±20% jitter; 400/422 → dead-letter, continue; 404 → delete=success, others dead-letter "renamed/deleted in Obsidian"; 401 → stop, banner) → pull `listTasks` → replace base → prune aliases → `lastSyncTime` only on success.
6. `src/state/TaskContext.tsx` rewrite: `useSyncExternalStore` over TaskStore; mutations = `dispatch` one-liners (direct client calls + post-success replay **deleted** — the root fix); expose `failedCommands`; keep `syncWidgetData` effect.
7. `src/state/SyncContext.tsx`: all triggers (mount/reconnect/foreground/pull-to-refresh/post-dispatch) route to `engine.requestSync()`.
8. `src/data/api/TaskNotesClient.ts` + `endpoints.ts`: `mutationId` param → header; `completeRecurringInstance(id, {date, completed})`.
9. UI: pending-changes indicator + dead-letter review (Discard/Retry) in `ConnectionBanner`/`SettingsScreen`.
10. **Local-date fix (review #5)**: `use-tasks.ts`/`lib/dates.ts` parse date-only strings as local dates (pattern at `domain/recurrence.ts:4-9`) — Today/Overdue correct in US timezones.

Tests: `offline-scenarios.test.ts` on the P0 harness — subway (dispatch offline → rebuild store from storage → identical view), reconnect exactly-once (call log by mutation id), crash-between-ack-and-dequeue (same `X-Mutation-Id` resent, dedup fake), temp-ID chain, conflict rebase, retry classification, single-flight, recurring date-capture (23:59 tap replayed next day), migration, cache salvage.

Resolved 50/50s: dead-letter with review UI (not silent drop); `dispatch` returns optimistic immediately (Todoist behavior); dead-letter retry re-enqueues at tail.

## P3 — Server rebuild + types v2 (`packages/tasknotes-server`, `packages/tasknotes-types`)

**tasknotes-types**: pin `@tasknotes/model@0.2.1` (exact); new `src/v2.ts` exported alongside legacy: model re-exports (`taskInfoSchema`/`TaskInfo`, `StatusConfig`, `PriorityConfig`, …), request schemas (`TaskCreationDataSchema`, `TaskUpdateInputSchema`, `CompleteInstanceRequestSchema{date?, completed?}`), upstream response schemas (list/query/delete/filter-options/time/nlp/calendars/health), `MUTATION_ID_HEADER`. Verify Metro bundles rrule/yaml early.

**Server** (target structure per design; key modules):

- `src/model-config.ts`: load `<vault>/.obsidian/plugins/tasknotes/data.json` (synced into the vault) → `resolveModelConfig`; missing file → defaults + loud warning (smoke test boots empty).
- `src/engine/task-repository.ts` (replaces `store/task-store.ts`): path-keyed cache `{task, frontmatter, body, mtimeMs}`. Read: `detectTaskFile` + `parseTaskDocument`; startup scan failure **throws**; rescan failure keeps previous map; every task-like parse failure logged + `tasknotes_skipped_files` metric + surfaced in `/api/health`. Write: re-read from disk → `buildTaskUpdatePlan`/`applyFrontmatterPatch` → `serializeMarkdownDocument` → atomic write; body preserved byte-for-byte; title rename honors `storeTitleInFilename` (new path = new ID in response). `completeInstance` via `buildRecurringTaskCompletePlan` (explicit date; set-semantics extension when `completed` present; 400 on non-recurring). Time via `buildStart/StopTimeTrackingPlan` → frontmatter. Archive = archive-tag toggle (~30-line mirror of upstream plan).
- `src/engine/`: `vault-files.ts` (walk/atomic write; throws on root ENOENT), `watcher.ts` (error listener + re-arm w/ backoff, 200ms debounce + **1s max-wait**, targeted `refreshFile`, 10-min safety rescan), `query.ts` (FilterQuery tree evaluator; unknown property/operator → 400), `stats.ts` (config-driven; filter-options = config objects + vault values), `time-reports.ts`, `filename.ts`.
- Routes rewritten to the upstream table (envelope middleware stays — it matches upstream exactly): `/api/tasks/:id/time/start|stop`, `/api/time/active|summary`, `/api/calendars/events` (task-derived events + `generateRecurringingInstances` expansion, `sources:{tasks:n}`), NLP responses `{parsed, taskData}`/`{task, parsed}` (grammar untouched), limit default 50/cap 200 with real pagination, toggle-status = configured workflow cycle, DELETE → `{message}`. Hono `:id` param spike test first (URL-encoded path IDs).
- **Legacy adapter** `src/routes/legacy.ts`: old camelCase paths/shapes translated onto the new repository so the P2 app keeps working until P5. Decision gate: if it exceeds ~300 lines, downgrade to a coordinated big-bang window instead (single user) — decide during implementation.
- `scripts/migrate-vault.ts` (dry-run default, `--apply`, idempotent): add `task` tag to legacy server files; boolean `archived` → archive tag; fold `_tasknotes/time-tracking.json` into frontmatter `timeEntries` (then rename `.migrated`); drop injected `id:` keys.
- `scripts/vault-audit.ts`: parse every file with the new engine + no-op round-trip byte-diff; must be 100% clean on a copy of the real vault before deploy.
- Tests: golden corpus `__tests__/fixtures/vault-corpus/` (unquoted-date, missing-title, status-none, scalar-fields, wikilink-project, custom-fields, recurring, body-with-fake-frontmatter; manifest of expected parses; meta-test greps fixture bytes so formatters can't defuse them), `round-trip.test.ts` (byte-identical bodies; no-op write byte-identical files), `conformance.test.ts` (`executeConformanceOperation` vs HTTP, pin `TASKNOTES_SPEC_VERSION`), `idempotency.test.ts`, `concurrency.test.ts` (fs edit between read and PUT → concurrent body edit survives), migration tests. Contract test extended to cover both new + legacy surfaces.
- Deploy unchanged (Dagger `buildImageHelper`, smoke test, version-bump PR). Resolved decisions: skip materialize-occurrence; GET /api/tasks includes archived (upstream parity — app filters client-side); pomodoro sessions/stats 404; drop `id:` keys.

## P4 — Operational rollout (no PR)

1. **Dress rehearsal**: copy the desktop Mac's synced vault → run new server locally against the copy → `vault-audit.ts` = 0 findings → migration `--dry-run` diff reviewed → optionally point simulator app at it.
2. **Backup gate**: `velero backup create tasknotes-pre-rework --include-namespaces tasknotes --wait` (6-hourly schedule is the floor) + `kubectl exec … -- tar czf - /vault > vault-pre-rework.tgz` + Obsidian Sync version history as third path.
3. Deploy P3 image → `kubectl exec` → dry-run → `--apply` → post-audit tarball clean → desktop Obsidian plugin reads/edits everything correctly (the ultimate oracle).

## P5 — App on v2 contract + recurrence UX (`packages/tasks-for-obsidian`)

- Schema migration: `domain/types.ts`/`schemas.ts` onto tasknotes-types v2 (snake_case: `complete_instances`, `recurrence_anchor`, …) rippling through `sync-widget.ts`, `use-tasks.ts`, `domain/recurrence.ts`, `filters.ts`, TaskDetail; storage schema version 3 (queue payload field mapping in `migrations.ts`); client onto new paths/shapes; path-as-ID (cache/deep-links keep working via store aliases).
- Recurrence, via `@tasknotes/model` in the app: `getEffectiveTaskStatus` for per-day checkbox state (completion feedback — checkbox actually checks), occurrence expansion in Today/Upcoming via `generateRecurringInstances`/`shouldShowRecurringTaskOnDate` (tasks with `scheduled`-anchored rules finally appear; no more perpetual-overdue).
- Wikilink projects: one normalize/compare/display helper in tasknotes-types v2 (`[[Projects/Foo|alias]]` ↔ `Foo`), applied at create/filter/display/deep-link sites (`filters.ts`, `ProjectDetailScreen`, Browse, QuickAdd).
- Archived filtering client-side (list endpoint now includes archived, upstream parity).
- Full Maestro pass + contract test on v2 → TestFlight.

## P6 — Cleanup

Delete server legacy adapter + tasknotes-types legacy exports; retire old TestFlight build; update `packages/tasknotes-server/CLAUDE.md` + `packages/tasks-for-obsidian/CLAUDE.md` (endpoint table, ID semantics, STATE_DIR, e2e runbook); resolve `packages/docs/todos/tasks-for-obsidian-e2e.md`; `git mv` this plan to `packages/docs/archive/completed/`.

## System-level e2e (Mac Mini test lab — parallel track, no CI hookup)

User has a spare Mac Mini; decision: use it as a **test lab host**, explicitly deferring Buildkite macOS-agent wiring (file a todo; Maestro remains a local gate).

**Lab setup (one-time, parallel to P0–P2; blocks nothing):**

- Mini joins the tailnet (Tailscale); Xcode + simulators + Maestro CLI; auto-login; real Obsidian + TaskNotes plugin in login items, signed into Obsidian Sync on a **dedicated test vault** with the plugin HTTP API enabled.
- Prereq to confirm before setup: a spare Obsidian Sync vault slot (Standard=1, Plus=10). If none, the transport + full-loop tests below are blocked — surface to user, don't work around.
- Config-as-code where practical (chezmoi for Mini dotfiles; document setup in a runbook doc).

**Ring 2b — differential test vs the real plugin** (`packages/tasknotes-server/scripts/differential-test.ts`): seed two identical vault copies; run the same operation sequence against (a) the real plugin's HTTP API (Mini over Tailscale, or local desktop Obsidian) and (b) our server; byte-diff resulting files. Gate for P3/P6 merges and after TaskNotes plugin upgrades.

**Ring 3 — ob-sync transport test** (`packages/tasknotes-server/scripts/sync-transport-test.ts`): two `ob sync` replicas on two local dirs against the test vault. Asserts: file written on A materializes on B; concurrent divergent edits (one side offline) → pin down and DOCUMENT actual Obsidian Sync conflict behavior on task frontmatter (currently an assumed LWW — this converts the load-bearing assumption into a tested fact). Run **before P3 implementation** so conflict findings can inform the server's concurrency handling. Needs only `ob` CLI + test-vault creds, not the Mini.

**Ring 4 — full-loop e2e + prod canary:**

- Full loop (on-demand, post-P3): staging server + `ob sync` sidecar on the test vault → task created via API → Obsidian Sync cloud → Mini's real Obsidian → assert via the real plugin API. Every production hop, genuine plugin as oracle. Scheduled/post-deploy, never per-PR (third-party cloud flakiness).
- Prod canary (post-P4): Temporal report-only agent task — create marker-tagged canary via prod API, assert list/read, complete + delete, check ob-sync sidecar liveness; desktop-side assertion via the Mini's plugin API once the lab is up. Emails red/green.

**Explicitly deferred:** Buildkite macOS agent on the Mini (would promote Maestro + differential to CI merge gates) — `packages/docs/todos/mac-mini-buildkite-agent.md` filed at P0, status `deferred`.

## Verification (every phase)

```bash
cd packages/tasknotes-types    && bun install && bun run typecheck && bunx eslint . --max-warnings=0
cd packages/tasknotes-server   && bun run typecheck && bun test && bunx eslint . --max-warnings=0
cd packages/tasks-for-obsidian && bun run typecheck && bun test && bunx eslint . --max-warnings=0
```

Phase-specific: app phases — `bun run ios` builds + `bun run e2e` (Maestro, local gate). Server phases — `dagger call smoke-test-tasknotes-server`; post-deploy `toolkit deployed <sha>`, `/api/health`, Grafana tasknotes metrics (error rate/latency), `toolkit bugsink issues` over 24h, old app still syncs (until P5). P4 has its own gate list above.

## Risks / caveats

- `@tasknotes/model` is ~1 month old (2 releases): pin exact, Renovate tracks; conformance test pins `TASKNOTES_SPEC_VERSION` so a semantic bump fails loudly.
- Path-as-ID means Obsidian renames orphan queued mutations → by design they dead-letter with an honest message (future: rename tombstones).
- Maestro is a local gate only (no macOS CI); documented as required for app PRs.
- P4 briefly leaves legacy tasks invisible to the new server until `--apply` runs (single user, quiet window, Recreate strategy).

## Docs discipline

Mirror this plan to `packages/docs/plans/2026-07-03_tasknotes-first-in-class.md` before implementation; session summaries appended per phase; per-phase PRs reference the plan.

## Session Log — 2026-07-03 (P2: offline-first sync rework)

### Done

All ten P2 build steps, on `feature/tasknotes-p2` (stacked on `feature/tasknotes-p0`), in `packages/tasks-for-obsidian`:

- **Local-date fix (review #5)** — `lib/dates.ts` gains `parseLocalDate`; `use-tasks.ts` de-duplicated onto it; TZ tests (767cd6f31).
- **Command model** — `src/data/sync/commands.ts`: absolute-state Command union, `applyCommand` pure rebase (create materializes), `remapTaskId`, `classify`, id/temp-id factories (b2e48c7c3).
- **Persistence + migration** — `CommandQueue` (FIFO + dead-letter + create/delete squash), storage keys v2, `runMigrations` v0→v2 converting the legacy toggle queue (0786bea48).
- **TaskStore** — `src/data/store/TaskStore.ts`: `view = rebase(base, pending)`, persisted temp→real aliases, `dispatch` never touches the network; `subscribe`/`getSnapshot` for `useSyncExternalStore` (41ecc6971).
- **SyncEngine rework** — single-flight `requestSync()` with pass coalescing, FIFO drain with `X-Mutation-Id`, exponential backoff (1s→60s ±20% jitter, injectable scheduler/random), per-error classification: transient stops the drain, permanent dead-letters and continues, 404-on-delete = success, 401 → `auth_error` with no retry timer (41ecc6971).
- **Client** — `TaskNotesClient` mutating methods take `{mutationId}` → `X-Mutation-Id`; `completeRecurringInstance(id, {date, completed})` set-semantics; `request()` params folded into an init object (41ecc6971).
- **React cutover** — `TaskContext` rewritten onto the store (mutations are one-line dispatches; the enqueue + direct call + replay double-execution is deleted); `SyncContext` gains the foreground trigger via previously-unused `useAppState` (f58a2d6ae); `SyncEngine.dispose()` so a client swap can't leave a stale retry timer draining the queue (ea186254d).
- **UI** — ConnectionBanner shows queued-change count offline and failed-change count; SettingsScreen gains a Sync section + Failed Changes review with Retry/Discard (41ecc6971).
- **Tests** — harness reworked around the new stack (FakeServer dedups replayed mutation ids like the real P1 middleware; manual retry scheduler); `offline-scenarios.test.ts` covers subway crash/relaunch, exactly-once reconnect pile-up, crash-between-ack-and-dequeue replay, temp-ID chains, conflict rebase, retry classification, backoff schedule, 23:59 recurring tap, dead-letter review, engine disposal; `parseTaskCache` extracted + salvage tests (ba8ab8376). Old `MutationQueue`/`SyncEngine` and their tests deleted.
- Verification: `tsc --noEmit` clean, 261 unit tests pass, `bun run test:contract` 18/18 vs the real spawned server, eslint + prettier clean.

### Remaining

- Maestro e2e (`bun run e2e`) as the local pre-merge gate — running at session end (first attempt failed only because the worktree lacked `pod install`; pods now installed).
- Open the P2 PR once e2e is green; then TestFlight build (user-side).

### Caveats

- `bun test` (bare) also picks up `contract-tests/` and fails without `../tasknotes-server` deps — use `bun run test` / `bun run test:contract`. In a fresh worktree the server needs its own `bun install` (not a workspace member) and the app needs `bun run pod-install` before e2e.
- v1→v2 queue migration maps `complete_instance` to `set_instance_complete{date: local day of enqueue timestamp, completed: true}` — best available record of the tapped day.
- Aliases are pruned when the real id disappears from a server pull; UI surfaces holding a pruned temp id fall back to the id itself (task shows as gone — correct).
