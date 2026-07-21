---
id: reference-completed-2026-06-06-dpp-xstate-streaming
type: reference
status: complete
board: false
---

# Refactor discord-plays-pokemon streaming to XState

## Context

The Discord-Plays-Pokemon bot streams a headless WASM GBA emulator into a Discord
voice channel as a Go-Live broadcast. The stream lifecycle (`game-streamer.ts`)
had been the source of repeated concurrency bugs:

- `2db78f489` — concurrent `VoiceStateUpdate` callbacks both calling `start()`
  raced at the first `await joinVoice`, leaking a `PassThrough`/ffmpeg process.
  Fixed by "claim `active=true` before first await".
- `1a906385d` — that fix opened a new race: a `stop()` landing mid-`start()`
  flipped `active=false`, leaving a live, frameless, unstoppable stream. Fixed by
  hand-rolling a promise-chain mutex (`opChain` / `runExclusive` / `settle`).

The code juggled four pieces of implicit state — `active`, `rgba`, `playing`,
`opChain` — to express a small lifecycle, and each fix opened the next race.
The orchestration driving it (`channel-handler.ts` → `start()`/`stop()`) was
fire-and-forget across module boundaries with no error visibility and no handling
of occupancy "flapping" during a transition.

**Goal:** replace the hand-rolled mutex/flags with an XState v5 machine where
illegal transitions are impossible by construction; add a reconciler so occupancy
changes during a transition resolve correctly; and add retry/reconnect. This
eliminates the start/stop race class, the half-wired-state class, and the
lost-error class — and makes them testable.

**Decisions (with user):** scope = streamer lifecycle + occupancy orchestration
only (emulator frame loop & command parser left as-is — single-threaded, not
racy); behavior = add retry/reconnect; flapping = reconciler machine.

## What shipped

All under `packages/discord-plays-pokemon/packages/backend/`:

### `src/stream/stream-machine.ts` — lifecycle machine

`createStreamMachine(deps)` →
`idle → starting (joinVoice) → preparing (build encoder) → streaming (runStream)
→ stopping (end sink + leaveVoice) → idle`, plus a `failed` state with bounded
retry (`maxRetries`, `retryDelay`).

- Side effects (`joinVoice`, `prepareEncoder`, `runStream`, `leaveVoice`) are
  injected `deps` wrapped as `fromPromise` actors → fully mockable.
- `frameSink` lives in context, set on entry to `streaming` and cleared on entry
  to `stopping`, both synchronously — a frame write never sees a half-wired
  stream. This is the invariant the old `active`/`rgba`/`playing` trio
  approximated by hand.
- START is only handled in `idle`/`failed`; STOP from any active state routes
  through `stopping` (which aborts the in-flight join via the actor's
  `AbortSignal`). The actor's serialized event queue replaces the `opChain` mutex.
- An unexpected `runStream` resolve is treated as an error → `failed` → reconnect.

### `src/stream/orchestrator-machine.ts` — occupancy reconciler

`createOrchestratorMachine(deps)` invokes the stream machine as a child and
watches it with **`invoke.onSnapshot`** (not child→parent events, which keeps the
child pure and standalone-testable):

- `SET_DESIRED` forwards START/STOP to the child immediately (redundant ones are
  no-ops via the child's guards).
- `onSnapshot` reconciles: child idle + desired → (re)START; child streaming +
  !desired → STOP; and mirrors the child's `frameSink` into orchestrator context
  for the hot path. This converges after any flap (START mid-`stopping`, STOP
  mid-`starting`).

### `src/stream/game-streamer.ts` — thin facade (unchanged public API)

Owns the discord `Streamer` + the real side effects, runs the orchestrator actor,
and exposes the same surface `index.ts` uses: `login()`, `pushFrame()` (reads a
subscription-cached `frameSink`), `start()`/`stop()` (set desired, return
`Promise<void>`, safe fire-and-forget), `isStreaming`, `destroy()`. Deleted
`opChain`/`runExclusive`/`settle`/`active`. **`index.ts` and `channel-handler.ts`
needed no change** — the reconciler is internal to the facade, so static mode now
also gets auto-reconnect for free.

### Tests (new — the streamer had none)

- `src/stream/stream-machine.test.ts` — happy path; `frameSink` non-null only in
  `streaming`; STOP-during-join aborts and never streams; join-failure → retry →
  recover; bounded-retry → give-up to idle; unexpected stream-end → reconnect;
  STOP cancels a pending retry.
- `src/stream/orchestrator-machine.test.ts` — desired up/down; flapping
  true→false→true while joining converges; START during teardown converges back;
  settle while undesired stays down.

Typing follows the no-`as` XState pattern (annotated `setup({types})` holder var);
test deferreds resolve a sentinel `true` because the repo's
`no-invalid-void-type` rule rejects `void` as a generic type argument.

## Verification (all green in the worktree)

- `bunx tsc --noEmit` — clean
- `bun test` — 22 pass / 0 fail (the config-validation "error" line is an
  existing test asserting the example config is rejected)
- `bunx eslint .` — clean

Not yet done: live behavior check against a real Discord guild (join/leave →
Go-Live up/down; rapid flap → exactly one healthy stream, no orphaned ffmpeg;
force a join failure → observe retry). This requires deploy/runtime access.

## Session Log — 2026-06-06

### Done

- Added `xstate@^5.32.0` to backend `package.json`.
- New: `src/stream/stream-machine.ts`, `src/stream/orchestrator-machine.ts`,
  `src/stream/stream-machine.test.ts`, `src/stream/orchestrator-machine.test.ts`.
- Rewrote `src/stream/game-streamer.ts` as a facade over the orchestrator actor
  (deleted the `opChain` mutex + `active`/`rgba`/`playing` juggling).
- Updated `eslint.config.ts` `allowDefaultProject` for the two new test files.
- tsc / bun test (22) / eslint all green.

### Remaining

- Live runtime verification in a test guild (see Verification).
- Open a PR (not yet created).

### Caveats

- Early in the session I accidentally wrote files to the **main checkout** (followed
  stale absolute paths from exploration) and a relative-path `rm` briefly deleted
  the worktree machine files. All recovered: main checkout restored to clean,
  worktree holds the canonical work. Stay strictly on worktree paths.
- `frameSink`/`encoder` in machine context are intentionally non-serializable; the
  machine is never persisted.
- Don't disturb the committed bun patch that lazy-loads sharp in
  discord-video-stream (reference_bun_sharp_dvs_patch).
