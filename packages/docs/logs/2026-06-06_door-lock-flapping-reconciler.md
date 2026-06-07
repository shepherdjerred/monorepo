# Door lock flapping → debounced reconciler

## Status

Complete

## Problem

The front-door lock was cycling lock/unlock while nobody was moving — reported in
both states: both people home, and both people away.

## Root cause

The lock was edge-triggered by two independent Temporal workflows:

- `welcomeHome` unlocked on every `not_home → home` edge (`welcome-home.ts`)
- `leavingHome` locked on every last `home → not_home` edge (`leaving-home.ts`)

Three compounding defects:

1. **Tumbling-window trigger dedupe** (`cooldownBucket = floor(now/90s)`,
   `presence.ts`) only dedupes edges that land in the _same_ fixed 90 s slot. Two
   flap edges seconds apart but straddling a bucket boundary get different
   workflow ids → both start. The existing test (`presence.test.ts`) even encodes
   this as "rolls to the next bucket at the window boundary".
2. **Single-sample recheck** — each workflow slept 90 s then sampled occupancy
   _once_. If presence was still bouncing at that instant, it was a coin flip.
3. **No idempotency** — both workflows always issued `lock.lock` / `lock.unlock`,
   never checking the current bolt state. Any surviving workflow physically
   actuated the lock.

Symptom mechanics:

- **Both away cycling:** a false `home` blip → `welcomeHome` → +90 s `anyoneHome()`
  still true → **unlocks an empty house**; blip clears → `leavingHome` → re-locks.
- **Both home cycling:** _correlated_ false `not_home` blips (both phones drop
  together) pass `othersAllAway` at trigger and `everyoneAway()` at recheck →
  **locks while home**; a real reading → `welcomeHome` → unlocks.

Underlying all three: an unlock workflow and a lock workflow on independent timers
that never cancel each other, with a debounce that samples one instant instead of
requiring the state to settle.

## Fix — singleton debounced reconciler

Chosen approach (user picked "Reconciler"): the lock's desired state is a pure
function of occupancy, so stop edge-triggering it and reconcile instead.

- **New** `src/workflows/ha/reconcile-lock.ts` — `reconcileLock` workflow + the
  `presenceChanged` signal. Fixed workflow id `reconcile-lock` (singleton). Debounce
  via a monotonic `edges` counter + `condition(() => edges !== seen, 90s)`; each
  signal restarts the wait. On settle: read live person + lock state, compute
  `shouldLock(states)`, actuate only when current ≠ desired. A late edge during the
  read re-arms the loop. Logs `phase=actuated` / `phase=noop` under
  `component=ha-presence`.
- **`src/shared/presence.ts`** — added pure `shouldLock(personStates)` (lock iff
  nobody is in the `home` zone; named zones / `unknown` count as away), with tests
  in `presence.test.ts`.
- **`src/event-bridge/triggers.ts`** — `bumpLockReconciler()` calls
  `client.workflow.signalWithStart("reconcileLock", …, signal: "presenceChanged")`
  on every real presence transition (both directions). Attribute-only updates
  (`oldState === newState`) are now ignored so GPS coordinate churn doesn't bump.
- **`welcome-home.ts` / `leaving-home.ts`** — removed the `lock.unlock` /
  `lock.lock` calls (and the `FRONT_DOOR_LOCK` consts). These still own the
  notification / scene / lights / vacuums, edge-triggered as before.
- **`src/workflows/index.ts`** — registered `reconcileLock`.
- Updated `packages/temporal/AGENTS.md` HA-presence section.

## Verification

- `bun run typecheck` — clean
- `bunx eslint` on all changed files — clean (no `as`, no disables)
- `bun test src/shared/presence.test.ts src/workflows/bundle.test.ts` — 8 pass;
  the workflow-bundle webpack smoke test confirms `reconcile-lock.ts` bundles
  (no activity-import leak; `condition`/`defineSignal`/`setHandler` are
  workflow-safe).

## Session Log — 2026-06-06

### Done

- Diagnosed the lock flapping: tumbling-window dedupe leak, single-sample recheck,
  non-idempotent actuation, and two uncancelled timers.
- Added `reconcileLock` singleton debounced reconciler + `shouldLock` helper/tests.
- Wired `signalWithStart` from the presence trigger; ignored attribute-only updates.
- Removed lock actuation from `welcomeHome` / `leavingHome`; registered the new
  workflow; updated `packages/temporal/AGENTS.md`.
- typecheck / eslint / tests + bundle smoke test all green.

### Remaining

- Not yet committed/pushed or deployed — needs to ship via the normal Dagger/ArgoCD
  flow and be observed in production (watch `component=ha-presence` logs for
  `phase=actuated` vs `phase=noop`).
- Optional follow-up: the lights/vacuum/notification edge workflows still use the
  leaky `cooldownBucket()` tumbling window. Lower stakes, left as-is; could move to
  the same signal-debounce model later if they prove annoying.

### Caveats

- `reconcileLock` has a 30-min `workflowExecutionTimeout`; continuous flapping
  beyond that would time out mid-debounce (the next edge starts a fresh run). Fine
  in practice — flapping settles long before 30 min.
- CI typechecks against the permissive HA schema stub; `getEntityStateUnchecked`
  is used for the person/lock reads so entity-id drift won't break the build.
- `CLAUDE.md` in `packages/temporal` is a symlink to `AGENTS.md` — edit the real
  target.

## Follow-up — Greptile review (stacked PR)

Two P2 comments on PR #1053, both addressed in a stacked follow-up PR
(`claude/lock-reconciler-greptile`, based on `claude/zealous-fermat-fc618d`):

- **AGENTS.md dropped `* 1000`** — the prose snippet showed
  `condition(() => edges !== seen, PRESENCE_COOLDOWN_SECONDS)`; the real code uses
  `* 1000` (Temporal SDK timeouts are milliseconds). Fixed the doc so a literal
  copy doesn't yield a 90 ms window.
- **`bumpLockReconciler` swallowed `signalWithStart` errors** — now re-throws after
  logging. Safe because the HA event client wraps handlers in
  `Promise.resolve(handler()).catch(emitError)` (`packages/home-assistant/src/ws/client.ts`),
  so it surfaces as a logged subscription error, not a worker crash. Aligns with
  the repo's fail-fast / no-silent-fallback principle.
