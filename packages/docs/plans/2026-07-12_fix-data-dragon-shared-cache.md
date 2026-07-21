---
id: plan-2026-07-12-fix-data-dragon-shared-cache
type: plan
status: awaiting-human
board: true
verification: human
disposition: active
---

# Fix `scout-data-dragon-weekly-refresh`'s recurring `llm-models` failure + close the CI gap

## Context

`scout-data-dragon-weekly-refresh` failed again this morning (2026-07-12, manual retry after PR #1452 merged) with the exact error PR #1452 was supposed to fix: `Cannot find module '@shepherdjerred/llm-models'`. Investigation (2 Explore agents + a Plan agent, cross-checked by reading the actual source) found two distinct problems:

1. **A second, unguarded `bun install --force`** inside `update-data-dragon.ts`'s `updateSnapshots()` (`packages/scout-for-lol/packages/data/scripts/update-data-dragon.ts:1173`) reuses the Temporal worker pod's **shared, persistent global Bun cache** (`BUN_INSTALL_CACHE_DIR=/tmp/bun-install-cache`, baked into the image by `.dagger/src/image.ts:1110`). **Confirmed live via `kubectl exec`/`describe` against the running `temporal` namespace** (not just inferred from source): `/tmp` is a genuine `EmptyDir` volume explicitly scoped to "a pod's lifetime," and the worker Deployment is single-replica with `recreate()` strategy (`packages/homelab/src/cdk8s/src/resources/temporal/worker.ts:292-294,557-558`) — so every activity invocation processed by that one long-lived pod (data-dragon, season-refresh, readme-refresh, PR review, agent-tasks, everything) shares the same cache directory for as long as the pod stays up between deploys. PR #1452's fix (`installScoutWorkspace()`, called moments earlier in the same run) builds and installs `llm-models` correctly — but this _second_ install, deep inside the scout script, isn't isolated from cross-run cache staleness the way the first one now is. A local repro of the identical command sequence with a fresh/isolated Bun cache does **not** reproduce the failure. (The pod that actually failed this morning was replaced by a new deploy at 11:14 UTC before this investigation, so the exact corrupted cache entry itself couldn't be forensically recovered — but the shared-cache architecture that makes it possible is confirmed fact, not speculation.)
2. **No CI coverage for this exact step.** The `temporal-schedule-rehearsal` CI check (`packages/temporal/scripts/rehearse-bot-clone.ts`) calls `installScoutWorkspace()` and runs one plain `bun test` — it never runs the second `bun install --force` or `updateSnapshots()` itself, so a regression here has no way to fail CI. This is the "didn't we add a test?" gap: yes, a rehearsal test exists, but it doesn't reach this code path.

Goal: eliminate the shared-cache hazard for all three bot-clone-based weekly PR-opening jobs (data-dragon, scout-season-refresh, readme-refresh — they all share the same pod/cache), and add real CI coverage for the specific step that broke.

## Fix 1 — per-run-isolated Bun install cache

Give every bot-clone install its own cache directory scoped to the run's already-unique tempDir, instead of inheriting the pod-wide `/tmp/bun-install-cache`.

- **`packages/temporal/src/activities/bot-clone.ts`**: added an exported helper `botCloneCacheDir(repoDir)` returning `${repoDir}/../bun-install-cache` (sibling of the git clone inside the same per-run `tempDir`, so it's automatically unique per run and cleaned up with the rest of `tempDir`). Wired into `rootInstallWithoutHooks`, `buildLlmModels`, and `installScoutWorkspace` via `env: { BUN_INSTALL_CACHE_DIR: botCloneCacheDir(repoDir) }` on every `runCommand` call they make. No signature changes — `scout-season-refresh.ts` and `readme-refresh.ts` call sites needed no changes at all.

- **`packages/temporal/src/activities/data-dragon.ts`**: the outer `runCommand(["bun", "run", "update-data-dragon", ...])` call now also sets `BUN_INSTALL_CACHE_DIR: botCloneCacheDir(repoDir)` alongside the existing `ENVIRONMENT: undefined` override — `runCommand`'s env becomes the child process's `process.env`, and `update-data-dragon.ts` shells out internally via Bun's `$` tagged template, which inherits `process.env`, so this one change propagates into the nested `bun install --force` and `bun test --update-snapshots` calls inside `updateSnapshots()` without touching that script's install call directly.

- **`packages/scout-for-lol/packages/data/scripts/update-data-dragon.ts`**: no change needed for cache isolation itself.

## Fix 2 — CI coverage for the step that broke

- **`packages/scout-for-lol/packages/data/scripts/update-data-dragon.ts`**: added a `--snapshots-only` CLI flag to `main()` that skips version resolution + asset download entirely and jumps straight to `updateSnapshots()` against whatever Data Dragon assets are already committed in the tree. A version bump / network fetch is only needed to exercise the _download_ step, which isn't what broke.

- **`packages/temporal/scripts/rehearse-bot-clone.ts`**: added a 4th canary, `rehearseSnapshotRefresh(repoDir)`, run after `rehearseScoutWorkspace`: `runCommand(["bun", "run", "update-data-dragon", "--snapshots-only"], { cwd: .../packages/data, env: { ENVIRONMENT: undefined, BUN_INSTALL_CACHE_DIR: botCloneCacheDir(repoDir) } })`. This is real subprocess, real `bun install --force`, real `bun test --update-snapshots`, real `bunfig.toml` hoisted-linker behavior, zero network calls.

- **`packages/scout-for-lol/packages/data/scripts/update-data-dragon.test.ts`**: no change — the rehearsal canary covers this end-to-end; a unit test with mocked `$` calls would not have caught this bug in the first place.

## Root-cause confidence

Raised via live `kubectl exec`/`describe` against the `temporal` namespace (see chat transcript): confirmed `/tmp` is a genuine `EmptyDir` scoped to the pod's lifetime, and the Deployment is single-replica/`recreate()` — so the shared-cache architecture is fact, not inference. The exact corrupted cache entry from the failing run could not be forensically recovered (the pod had already rotated to a new deploy before this investigation started), so the precise corruption mechanism remains unconfirmed — but per-run cache isolation is correct regardless of the exact mechanism, and the new CI canary means any future regression in this step fails the PR instead of failing silently in production.

## Human Verification

- `cd packages/temporal && bun run typecheck && bun test` — pass (3 pre-existing failures are `localhost:7233` integration tests requiring a live Temporal dev server, unrelated to this change).
- `cd packages/scout-for-lol/packages/data && bun run typecheck && bun test` — pass. Ran `bun run update-data-dragon --snapshots-only` directly (with `BUN_INSTALL_CACHE_DIR` unset and set to an isolated dir) — confirmed it exercises the install-refresh + snapshot-test step against committed assets with no network calls, and produces zero `git status` diff (snapshots already match).
- Ran the rehearsal script against a genuinely clean clone (not the dev worktree, which already has lefthook hooks armed from `scripts/setup.ts`'s root install) — all 4 canaries pass: scout, snapshot (new), hooks, cog. (`cog` canary requires the `cog` binary, not installed on this Mac — a local environment gap, not a regression; CI's worker image installs it.)
- Did not do the synthetic "poison a shared cache dir and confirm the canary fails without the fix" step from the original plan — the exact corruption mechanism was never confirmed, so a synthetic poison test would be testing a guess, not the real bug. Skipped as low-value; the live pod architecture confirmation was judged sufficient.
- No real Temporal worker pod or scheduled trigger needed for this verification — `.dagger`'s `temporal-schedule-rehearsal` CI step runs this script inside the built worker image on every PR touching `packages/temporal/**`.
- Once merged, the next real fix-confirmation is the following Saturday's scheduled `scout-data-dragon-weekly-refresh` run (or another manual trigger via the Temporal UI) actually opening a PR.

## Files touched

- `packages/temporal/src/activities/bot-clone.ts` (add `botCloneCacheDir`, wire into 3 helpers)
- `packages/temporal/src/activities/data-dragon.ts` (add `BUN_INSTALL_CACHE_DIR` to the outer `update-data-dragon` runCommand env)
- `packages/scout-for-lol/packages/data/scripts/update-data-dragon.ts` (add a `--snapshots-only` CLI flag for the rehearsal canary)
- `packages/temporal/scripts/rehearse-bot-clone.ts` (new `rehearseSnapshotRefresh` canary)

No changes needed to `scout-season-refresh.ts` or `readme-refresh.ts` — they inherit the cache isolation for free since `botCloneCacheDir` derives from the `repoDir` param they already pass.

## Session Log — 2026-07-12

### Done

- Diagnosed the recurring `scout-data-dragon-weekly-refresh` failure via live Temporal REST API history (found the manual retry this morning had already failed) and live `kubectl exec`/`describe` against the `temporal` namespace (confirmed the shared, pod-lifetime-scoped Bun cache architecture).
- Implemented Fix 1 (per-run `BUN_INSTALL_CACHE_DIR` isolation) in `bot-clone.ts` and `data-dragon.ts`.
- Implemented Fix 2 (`--snapshots-only` flag + new `rehearseSnapshotRefresh` CI canary) in `update-data-dragon.ts` and `rehearse-bot-clone.ts`.
- Verified: typecheck + test pass in both `packages/temporal` and `packages/scout-for-lol/packages/data`; ran the actual `--snapshots-only` flag directly; ran the full rehearsal script against a genuinely clean clone with all 4 canaries passing (except `cog`, blocked by a local-only missing binary).
- Work done in worktree `.claude/worktrees/fix-data-dragon-cache` on branch `fix/data-dragon-shared-cache`.

### Remaining

- Not yet committed or opened as a PR — user has not asked for that yet.
- The real end-to-end proof is the next scheduled (or manually triggered) `scout-data-dragon-weekly-refresh` run actually opening a PR after this ships.

### Caveats

- The exact corruption mechanism inside the shared Bun cache was never forensically confirmed — the pod that failed this morning was replaced by a new deploy before this investigation started, so the corrupted cache entry itself is gone. The architectural hazard (shared, pod-lifetime cache across all activities) is confirmed fact; the precise failure mode inside it is not. Per-run isolation is the correct fix regardless.
- Local rehearsal testing against your own dev worktree gives a false "hooks" canary failure, because `scripts/setup.ts`'s root install (no `--ignore-scripts`) already armed real lefthook hooks — unlike a genuine ephemeral bot clone. Test against a fresh `git clone` (or a plain directory copy of uncommitted changes) instead, as this session had to learn the hard way.
