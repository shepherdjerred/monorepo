---
id: log-2026-06-13-mk64-leaderboards-greptile-p2-fixes
type: log
status: complete
board: false
title: MK64 Leaderboards — Greptile P2 comment fixes (PR
date: 2026-06-13
---

# Mk64 Leaderboards Greptile P2 Fixes

## Context

Two P2 Greptile review comments on PR #1143 (`feature/mk64-leaderboards`) were blocking the `mag-greptile-review` CI gate.

## Fixes Applied

### P2 — race-watcher.ts: time-trials recorded in DB but never used

Thread `PRRT_kwDOHf4r4c6JS21k` at `packages/discord-plays-mario-kart/packages/backend/src/leaderboard/race-watcher.ts:120`.

The `isRecordable` predicate excluded `battle` mode and the award ceremony course, but not `time-trials`. Solo TT runs were persisted via `store.recordRace` and then silently excluded by `RANKED_MODES = ["gp", "versus"]` in `store.ts`, causing DB rows that accumulate with no purpose.

Fix: added `snap.gameMode !== "time-trials"` to `isRecordable`.

Test changes:

- Added new dedicated test "time-trials are never recorded (excluded by isRecordable)" asserting 0 emissions.
- Renamed the old "TT ghosts" test to "non-human ghost karts in slots 1+ are excluded from the versus roster" and switched it to use the default `versus` game mode, so it actually tests the ghost-exclusion path (not time-trials).
- Split the single `describe("RaceWatcher", ...)` block into two (`RaceWatcher — race recording` and `RaceWatcher — isRecordable filtering`) to satisfy the `max-lines-per-function` ESLint rule (which was exceeded by 17 lines after adding the new test).

### P2 — blit.ts: alpha composite divides by 256 instead of 255

Thread `PRRT_kwDOHf4r4c6JS218` at `packages/discord-plays-mario-kart/packages/backend/src/overlay/blit.ts:55`.

`(data[fi] * inv) >> 8` is integer divide-by-256 — a common but incorrect approximation of `(data[fi] * inv) / 255`. At `inv = 127`, `dst = 255` the correct contribution is 127 but the code produced 126.

Fix: replaced `>> 8` with `Math.round(... / 255)` for the three colour channels, matching the docstring formula `out = label_premultiplied + dst * (1 - alpha)`. Updated the blit test expected pixel value from 227 to 228 (the mathematically correct result: `128 + round(200*127/255) = 128 + 100 = 228`).

## Verification

- `bun run --filter='@discord-plays-mario-kart/backend' typecheck` — exit 0
- `bun run --filter='@discord-plays-mario-kart/backend' test` — 84 pass, 0 fail
- `bunx eslint ... --fix` — clean (no lint issues)
- `bunx prettier --write` — required for `blit.ts` line wrapping (lines exceeded 80 chars)
- All pre-commit hooks (lefthook tier-1 + tier-2) passed

## Session Log — 2026-06-13

### Done

- Read both Greptile P2 comments via `gh api`
- Found uncommitted changes in the existing worktree (a prior session had applied the fixes but not committed)
- Split test describe block to fix the `max-lines-per-function` lint violation
- Ran prettier on `blit.ts` to fix line-length formatting
- Committed as `4748007cd` on `feature/mk64-leaderboards`
- Pushed to `origin/feature/mk64-leaderboards` (80ac067ee → 4748007cd)
- Resolved both Greptile threads via GraphQL mutation

### Remaining

- None; CI should re-run and the `mag-greptile-review` gate should pass once Greptile processes the new commit.

### Caveats

- The Prisma client was not generated in the worktree (`src/generated/` missing); ran `bunx prisma generate` manually to unblock typecheck. The generated files are gitignored and not committed.
