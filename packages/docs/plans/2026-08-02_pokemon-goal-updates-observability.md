---
id: plan-pokemon-goal-updates-observability-2026-08-02
type: plan
status: in-progress
board: false
---

# Pokemon goal-agent: rough-edge fixes, deterministic Discord updates, observability

> Implementation note (2026-08-02): all four phases are implemented on
> `feature/pokemon-goal-updates` (PR #1953). One design change from the plan:
> milestone forwarding subscribes inside `spawnGoalCodex` **before** the stdout
> pump starts (with GoalManager buffering until the goal is active) — the
> post-spawn subscription in the original plan provably loses early
> agent_messages when stdout drains fast.

## Context

The 2026-08-02 live goal session (runtime 7703, goal `be47ea13`) exposed three problem areas:

1. **Rough edges**: the known unguarded selfbot `destroy()` crash on every session stop
   (`streamer destroy failed: null is not an object (evaluating 'this.connection.readyState')`),
   plus `error: undefined` log noise on every 400 goal-tool response and non-chord chat message.
2. **No Discord updates during a 14-minute goal run** — codex `agent_message` milestones are
   only logged, never posted; the only mid-run posting path is the agent explicitly calling
   `POST /progress`, which it never did. The operator wants a deterministic, harness-enforced
   update every 1–2 minutes.
3. **Observability gaps**: no spans on the goal HTTP tool server, no token/cost metrics
   (cost only goes to Discord), no goal dashboard panels, zero pokemon alert rules.

**User decisions:** text-only interval updates (no screenshot); forward codex `agent_message`
milestones too (the timer is a floor, not a replacement); normalize + clamp tool inputs
instead of strict 400s.

**Shape:** one PR from worktree `feature/pokemon-goal-updates`. Packages: `discord-plays-core`,
`discord-plays-pokemon/packages/backend`, `discord-plays-mario-kart/packages/backend`
(override deletion), `homelab` (dashboard + alerts).

| #   | Workstream                    | Key files                                                                                                                           |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Destroy guard + logging fixes | `discord-plays-core/src/stream/game-streamer-base.ts`, backend `discord/message-handler.ts`, `goal/control-server.ts`               |
| 2   | Normalize + clamp tool inputs | backend `goal/schema-helpers.ts` (new), `goal/semantic-control-routes.ts`, `goal/control-routes.ts`, `goal/game-battle-control*.ts` |
| 3   | Deterministic Discord updates | backend `goal/goal-manager.ts`, `goal/goal-activity.ts` (new), `config/schema.ts`, `goal/control-server.ts`                         |
| 4   | Observability                 | backend `observability/metrics.ts`, `goal/goal-metrics.ts`, core `observability/tracing.ts`, homelab dashboard + rules              |

## Phase 1 — Rough-edge bug fixes

**1a. Destroy guard → base class.** `game-streamer-base.ts:147-149` `destroyClient()`: wrap
`this.streamer.client.destroy()` in try/catch → `this.logger.warn("selfbot client destroy
failed (ignored)", {error})`; move mario-kart's explanatory comment into the base. Delete the
now-redundant override in `discord-plays-mario-kart/packages/backend/src/stream/game-streamer.ts:151-166`.
Pokemon inherits the fix. Test in `discord-plays-core/test/game-streamer-base.test.ts` with a
throwing client stub + warn-recording logger.

**1b. `error: undefined` fixes** (winston `format.simple()` renders non-string first args as
`undefined`):

- `message-handler.ts:97` `logger.error(chord)` → debug line with content snippet — non-chord
  chat is normal, not an error.
- `message-handler.ts:40` `logger.info(error)` → warn with `error.message` interpolated.
- `control-server.ts:94-108` catch: ZodError → `logger.warn` with `z.prettifyError(error)`
  (routine agent misfire); other errors → `logger.error` with method/path/goalId context. The
  400 body carries the prettified message so every `.parse()` route becomes
  self-correction-friendly.

## Phase 2 — Normalize + clamp tool inputs

Discovery: `/press`/`/tap`/`/chord` command strings are **already case-insensitive**
(`game/command/command-input.ts:49-52`). Only `DirectionSchema` needs it.

- **New `goal/schema-helpers.ts`**: `clampedInt(min, max)` = `z.number().int().transform(clamp)`
  (wrong types still hard-fail; only range is forgiven) and `caseInsensitiveEnum(values)` =
  trim/lowercase `.pipe(z.enum(...))`.
- **`semantic-control-routes.ts`**: `DirectionSchema` → `caseInsensitiveEnum([...])` (output
  type unchanged); clamp swaps keeping defaults — `repeat` 1-20, `tiles` 1-20, `maxFrames`
  1-1800, `maxSteps` 1-200, `searchRadius` 1-20 (both navigate union branches). Battle schemas
  keep hard 400s (slot/moveId/partySlot are identifiers — clamping would act on the wrong
  Pokémon).
- **`control-routes.ts`**: press quantity — clamp to `max_quantity_per_action` instead of 400;
  enumerate valid buttons in the invalid-command/chord error text with configured limits.
- **`game-battle-control*.ts`**: append cheap context to domain rejections from the
  already-materialized observation (current menu, usable move slots, decision-pending).
- Convention comment: JSON-body routes use `.parse()` + centralized prettified 400;
  query-param routes keep bespoke `safeParse` messages.
- Tests: new `schema-helpers.test.ts`, `semantic-control-routes.test.ts`; register both in
  `eslint.config.ts` `allowDefaultProject`.

## Phase 3 — Deterministic Discord updates + milestone forwarding

- **Config** (`config/schema.ts` GoalConfigSchema): `update_interval_seconds:
z.number().int().min(30).max(600).default(90)`. Update `config.example.toml` + typed fixtures.
- **New `goal/goal-activity.ts`** — `GoalActivityLog`: clock-free ring buffer (~100) of
  `{method, path, status, at}` + `noteAgentMessage`/`lastAgentMessage`; `summarizeSince(since)`
  → `"14 actions (8 /move, 3 /observe, 2 /battle/move, 1 err)"`.
- **`goal-manager.ts`**:
  - `ActiveGoal` += `activity`, `updateTimer`, `unsubscribeJsonl`, `lastIntervalCheckAt`.
  - After `this.active = {...}`: subscribe `spawned.jsonl.subscribe` — on `agent_message`,
    note in activity + `void this.publishProgress(text, "milestone")` (existing throttle paces
    it); start `setInterval(→ publishIntervalUpdate(id), update_interval_seconds * 1000)`.
  - `publishProgress(message, source)`: add dedup (`trimmed === active.state.lastProgress` →
    false) + `goalProgressUpdatesTotal.inc({source})`.
  - New `publishIntervalUpdate(id)`: if nothing posted within the interval (shared
    `lastProgressSentAt` clock, bypasses agent throttle so the floor always holds), compose +
    send status; sets `lastProgressSentAt`; does NOT touch `state.lastProgress`/persistence;
    posts a truthful "no new actions" line when idle — that silence IS the stuck signal.
  - `composeStatusUpdate`: ≤3 lines — location via
    `formatLocationLine(spatialSnapshotProvider())` (export from `game-state-summary.ts:106`),
    action summary via `activity.summarizeSince`, latest milestone (~300 chars).
  - Teardown in `claimActive` (single choke point for all 4 terminal paths):
    `clearInterval(active.updateTimer); active.unsubscribeJsonl();`.
  - New `recordToolCall(goalId, {method, path, status})` — guarded by active id, stamps `at`.
- **`control-server.ts`**: call `goalManager.recordToolCall(...)` next to both `logGoalTool`
  calls.
- Tests: `goal-activity.test.ts`; `goal-manager.test.ts` with `update_interval_seconds: 1` +
  `Bun.sleep`; e2e integration asserts first canned `agent_message` forwarded, second throttled.

## Phase 4 — Observability

- **Spans**: extend core `withSpan` to `(name, fn: (span?: Span) => Promise<T>)`
  (backwards-compatible); wrap `routeRequest` as `pokemon.goal.http_tool` with
  method/path/goalId/status/duration attrs.
- **Metrics** (backend `observability/metrics.ts`): `pokemon_goal_tool_calls_total{path,status}`
  (incremented in `goal-tool-log.ts`; unknown paths → `"other"`), `pokemon_goal_tokens_total{kind}`,
  `pokemon_goal_cost_usd_total`, `pokemon_goal_progress_updates_total{source}`. New
  `recordGoalUsage(usage, cost)` in `goal-metrics.ts`, called from all three terminal paths.
- **Grafana** (`packages/homelab/src/cdk8s/grafana/discord-plays-dashboard.ts`): new "Goal
  agent" row, 5 panels — goal active, runs by status, duration p50/p95, tool-call rate by path
  - error rate, tokens by kind + cost.
- **Alerts** (new `.../monitoring/rules/discord-plays-goal.ts`, streambot pattern):
  `PokemonGoalStuck` (`pokemon_goal_active > 0` for 40m) and `PokemonGoalStreamDownMidGoal`
  (`goal active and stream_active == 0` for 3m).

## Verification

```bash
bunx turbo run typecheck test lint \
  --filter=@shepherdjerred/discord-plays-core \
  --filter=@discord-plays-pokemon/backend \
  --filter=@discord-plays-mario-kart/backend \
  --filter=homelab
```

Live e2e after deploy: (1) `/goal` with `update_interval_seconds: 60` — milestones post; when
the agent is silent a status line lands every interval; nothing posts after
finish/replace/shutdown. (2) control server: `{"direction":"North","tiles":999}` → clamped
move; bad direction → prettified 400. (3) session stop — no `null is not an object`. (4)
`/metrics` shows the four new series; dashboard row renders.

## Risks

- Base-class change touches mario-kart → override deleted same commit, mario-kart in verify set.
- Timer/throttle share one `lastProgressSentAt` clock → bounded outbound rate; an interval post
  can delay the agent's next `/progress` by up to the throttle window (accepted).
- Earliest jsonl `agent_message` lines may precede subscription (same as existing trace
  subscriber) — acceptable.
- `repeat: 0`/`quantity: 0` now clamps to 1 instead of erroring — documented in schema comment.
