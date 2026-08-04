---
id: 2026-08-03-dpp-save-goals-at-end
type: log
status: complete
board: false
---

# discord-plays-pokemon — save the game when a goal ends

## Background (Q&A that led here)

How saves work in dpp: the emulator persists the 128 KiB GBA flash image
(battery/SRAM) to `saves/<guildId>/pokeemerald.flash` (a ZFS/NVMe PVC). The
frame loop flushes flash to disk every ~1s (change-detected) and force-flushes
on stop — but that only **mirrors** flash. Emerald only writes progress _into_
flash on an in-game Save, so normal Discord play requires a player to Save or
progress is lost on restart.

`emulator.checkpointSave()` (`emulator/emulator.ts:295`) runs Emerald's real
save engine (`WasmCheckpointSave` → `TrySavingData`) to commit live state into
flash, then force-flushes. It was previously wired **only** into the goal
benchmark worker, never into live gameplay.

The user asked to make goals save at the end. Chosen scope (via question):
**Both** — save after each goal finishes AND on session end.

## Change

`WasmCheckpointSave` returns `SAVE_STATUS_ERROR` (→ `checkpointSave()` throws)
unless the game is in the overworld or a battle, so every call site tolerates a
throw (log + continue).

- **Per-goal end** — `GoalManager` gains an optional `checkpointGame` callback
  (driver wires it to `emulator.checkpointSave()`). A new pure helper
  `saveOnGoalEnd(checkpointGame, status)` (`goal/goal-checkpoint.ts`) is called
  after `persistState` in `observeProcess` (completed/failed), `timeoutGoal`
  (timeout), and `stopActive` **only for `"replaced"`**. It fires while the goal
  still holds the input lease, so no queued Discord/web input can move the game
  before the save. `"shutdown"` is intentionally NOT saved here — the driver
  covers it once at session end, avoiding a double save.
- **Session end** — `PokemonGameDriver.onSessionStop` calls
  `emulator.checkpointSave()` before `emulator.stop()`, gated on
  `runtime.goalManager !== undefined` (goal mode only, per the request).

### Files

- `packages/backend/src/goal/goal-checkpoint.ts` (new) — `saveOnGoalEnd` helper.
- `packages/backend/src/goal/goal-lease-helpers.ts` (new) — `oneShot` +
  `noOpAcquireInputLease`, extracted from `goal-manager.ts` to stay under the
  500-line `max-lines` cap (the file was already at the edge). No behavior change.
- `packages/backend/src/goal/goal-manager.ts` — `checkpointGame` option/field,
  three call sites, helper extraction.
- `packages/backend/src/lifecycle/pokemon-driver.ts` — pass `checkpointGame`;
  session-end checkpoint in `onSessionStop`.
- `packages/backend/src/goal/goal-manager.test.ts` — two tests: checkpoint fires
  on completion; a throwing checkpoint doesn't break goal teardown.

## Verification

- `bunx turbo run typecheck --filter=@discord-plays-pokemon/backend` — clean.
- `eslint` on all changed/new files — clean (max-lines resolved via extraction,
  not suppression).
- `bun test` (full backend) — 427 pass, 3 pre-existing skips, 0 fail.

## Session Log — 2026-08-03

### Done

- Wired `emulator.checkpointSave()` into both goal-end paths (per-goal + session
  end) with graceful handling of non-saveable game states. Files above.
- Added focused tests; full backend suite green; typecheck + lint clean.

### Remaining

- Open draft PR from this worktree; require current-head Buildkite green before
  marking ready.
- Not runtime-exercised on a live bot (no local wasm/Discord session this
  session) — the engine save path is covered by the existing benchmark
  integration test and the new unit tests.

### Caveats

- Session-end checkpoint is **goal-mode-gated** by design; human-only sessions
  keep the old behavior (progress persists only via in-game Save). Revisit if we
  want auto-save for human play too.
- A checkpoint at goal end can be a no-op if the game isn't in the
  overworld/battle at that instant (e.g. a goal that ends mid-menu); this is
  logged, not fatal.
