# State-machine transition logging (streambot + game bots)

## Status

In Progress (implemented on `feature/xstate-transition-logging`; pending PR/merge — will move to `Complete` and archive once merged to `main`)

## Context

Debugging the XState machines behind the Discord streaming bots was hard: you could see the
_current_ state (streambot exports a `streambot_playback_state{state}` gauge) but **not the
transitions** — what state it came from, what it moved to, or _what event caused the move_.

Richer deliveries (render the machine to SVG/PNG and post to Discord on every transition; an
HTTP debug endpoint; Discord DMs) were considered and rejected: the diagram path pulls in
graphics deps, costs a render per transition, and floods the channel. The actual need is
**observability**, and the cheapest, most durable sink is structured logging — which streambot
already ships to Loki (one JSON object per line via `src/util/logger.ts`).

**Goal:** on every real state change, emit one structured log line with previous state, new
state, and the transition reason (the causing event), plus a little safe context. No new
dependencies, no Discord traffic, works in prod, queryable in Grafana/Loki.

## Approach (as built)

The officially documented observability path (https://stately.ai/docs/inspection) is the
`inspect` option on `createActor(...)` — an observer receiving inspection events for the whole
actor tree, which also captures invoked child machines.

**Uses the `@xstate.microstep` inspection event, not `@xstate.snapshot`.** States entered _and
left_ via an `always` transition in the same step never appear in `subscribe()`/`@xstate.snapshot`
(verified in `xstate/dist/.../inspection.d.ts` and the `xstate-helper` skill). Streambot's
`advance`/`skipped`/`failed` and the raw-go-live child's intermediate states are exactly those,
so microstep is required. `InspectedMicrostepEvent` carries `actorRef` (attribution), `event`
(cause), and `snapshot` (state + context) — a strict superset of the snapshot event.

A single machine-agnostic inspector lives in the shared package and is consumed by all three bots.

### Files

- **`packages/discord-stream-lifecycle/src/debug/transition-logger.ts`** (new) —
  `createTransitionLogInspector({ log, label, projectContext? })` returns an `inspect` observer.
  Reads snapshot fields via `typeof`/`in` narrowing (no `as`; `zod` is not a declared dep here).
  - Seeds the initial state from the first `@xstate.snapshot` (XState emits no microstep for the
    initial state), so the first transition reports the real `from` instead of `null`.
  - Logs `{ label, machine, from, to, event, ...projectedContext }` on each `@xstate.microstep`.
  - **Skips no-op self-transitions (`from === to`)** — keeps it a _state_-transition log and
    elides the stateless `desiredStream` reconciler (value always `{}`), whose transitions are
    forwarded to the `rawGoLive` child the same inspector already logs.
  - `fromPromise` actors have no state `value` and are skipped automatically.
  - Per-`createActor` instance; dedup state GC'd with the actor (no cross-session leak).
- **`packages/discord-stream-lifecycle/test/transition-logger.test.ts`** (new) — 5 tests: transient
  `always` state IS logged; from/to/event incl. child-completion; self-transitions suppressed;
  no lines for `fromPromise` children; label + projected scalar context present.
- **`packages/streambot/src/session/playback-log.ts`** (new) — `createPlaybackInspector(label)`
  wraps the shared inspector with streambot's logger (`logger.child("machine")`) and a scalar-only
  `projectPlaybackContext` (loop/volume/queueLength/lastErrorKind). Extracted into its own module
  to keep `session-manager.ts` under the 500-line `max-lines` cap.
- **`packages/streambot/src/session/session-manager.ts`** — `createActor(createPlaybackMachine(...))`
  gains `inspect: createPlaybackInspector(keyOf(guildId, voiceChannelId))`.
- **`packages/discord-plays-pokemon/.../stream/game-streamer.ts`** and
  **`packages/discord-plays-mario-kart/.../stream/game-streamer.ts`** —
  `createActor(createDesiredStreamMachine(...))` gains `inspect` labelled by guild id, logging via
  a small winston adapter. Captures the `rawGoLive` child transitions.

## Verification (done)

- Shared unit tests: 5/5 pass. Full shared suite: 56/56.
- Empirical PoC driving `createDesiredStreamMachine` with stub deps confirmed the `rawGoLive`
  child logs `idle→joining→preparing→streaming→stopping→failed` with `machine:"rawGoLive"`, and
  **zero** `desiredStream` noise after the self-transition guard.
- `typecheck` PASS for all four packages; `eslint` clean for every changed file.
- Game-bot stream/machine tests: pokemon 12/12, mariokart 30/30.
- Streambot: 286 pass / 5 fail — the 5 failures are `real ffmpeg`/`real libass` subtitle/HDR/VAAPI
  integration tests needing media hardware absent in this sandbox; untouched by this change.

## Out of scope (possible follow-ups)

- Prometheus `playback_transitions_total{from,to,event}` counter.
- On-demand SVG/JSON debug HTTP route on the existing `/metrics` server.
- Failure-only Discord DM/notification on entering `failed`/error states.

## Session Log — 2026-07-03

### Done

- Added `createTransitionLogInspector` (shared, `@xstate.microstep`-based) + 5 unit tests.
- Wired `inspect` into streambot (`playback-log.ts` + `session-manager.ts`) and both game bots'
  `game-streamer.ts`.
- Discovered during impl (via PoC) that the stateless `desiredStream` reconciler spams `{}→{}`;
  resolved by suppressing `from === to`, which also matches "prev/new _state_" intent.
- Verified: typecheck (4 pkgs) + lint clean; shared/game-bot tests green.

### Remaining

- Open a PR (branch `feature/xstate-transition-logging`) — not yet committed/pushed.
- Optional live validation: run streambot against a test guild and eyeball the JSON trail in
  stdout/Loki (the machine logic is covered by unit tests + the PoC).

### Caveats

- Local only: consumers use `file:` deps (bun **copies**, not symlinks). After editing the shared
  source, `bun install` may report "no changes" and not re-copy; the copies were refreshed manually
  via `rsync` in this worktree. CI does a clean install, so this is a local-only artifact.
- An unrelated stale `file:` copy of `@shepherdjerred/llm-models` in the pokemon backend was also
  refreshed via rsync to get a clean typecheck; not part of this change.
- The 5 streambot integration-test failures are pre-existing/environmental (real ffmpeg/libass).
