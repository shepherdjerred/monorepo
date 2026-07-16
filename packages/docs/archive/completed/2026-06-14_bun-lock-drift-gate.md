# Per-package `bun.lock` drift gate

## Status

Complete — shipped in PR #1222.

## Context

PR #1213 (`@anthropic-ai/sdk` 0.95 → 0.96) regenerated `packages/llm-observability/bun.lock` but left `packages/discord-plays-pokemon/bun.lock` stale, because dpp pulls llm-obs via `file:../llm-observability` (declared in the nested `packages/discord-plays-pokemon/packages/backend/package.json`). Renovate doesn't propagate transitive lockfile updates across workspace `file:` links. The drift hid through #1213's branch CI (canceled twice by intermediate pushes, auto-merged on Greptile-only), through main build #4232 (canceled when #1214 merged 7 min later), and only surfaced on build #4233's dpp Lint/Typecheck/Test — looking like a protobufjs bug. Same pattern previously caused `fedba1020` and `649f56077`.

The gate catches it at PR time with `bun install --frozen-lockfile --dry-run` (resolve-only, no download/link) per package — fast enough to run on every PR, scoped via the existing affected-packages closure so the cost stays in ms.

## The check

`scripts/check-bun-lock-drift.ts` supports four modes:

1. `--seeds a,b,c` — **CI mode (load-bearing)**. Takes the directly-changed top-level package dirs (`affected.directlyChanged` from `change-detection.ts`), walks the reverse `file:`-dep closure **using a nested-workspace-aware graph**, then dry-runs the closure. The expansion MUST happen here, not in `change-detection.ts`, because the CI change detector's `transitiveClosure` reads only top-level `packages/<X>/package.json` and would silently miss the dpp case (its `file:llm-observability` edge lives in `packages/discord-plays-pokemon/packages/backend/package.json`).
2. `--packages a,b,c` — debug / advanced. Checks **exactly** these packages, no closure expansion. CI must not use this mode.
3. `--base <ref>` — local dev mode. Diffs `packages/<X>/package.json` and `packages/<X>/bun.lock` vs `<ref>`, walks the same nested-aware reverse `file:`-dep closure, and dry-runs the closure.
4. `--all` — debug / nightly. Sweeps every `packages/<X>/bun.lock`.

For each affected package, the script runs `bun install --frozen-lockfile --dry-run` in `packages/<P>/`. Exit non-zero on any failure, listing each drifted lockfile + the verbatim `bun` error + a `(cd packages/X && bun install) && git add packages/X/bun.lock` fix line.

The reverse-dep walker **walks nested workspaces** (`packages/<X>/packages/backend/package.json`, etc.) so the dpp case — where the `file:`-dep edge to `llm-observability` is declared in a nested manifest — is correctly attributed to `discord-plays-pokemon` for closure purposes. This is the only meaningful difference from `scripts/ci/src/change-detection.ts:readWorkspaceDeps`, which only reads top-level manifests; the CI gate's correctness depends on the script re-expanding the closure with this nested-aware graph rather than trusting the change detector's pre-computed `affected.packages`.

## Wiring

| File                                    | Change                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/check-bun-lock-drift.ts` (new) | The check above.                                                                                                                                                                                                                                                                                                                                                    |
| `.dagger/src/quality.ts`                | `bunLockDriftCheckHelper(source, seeds)` — `bunQualityBase` + `bun scripts/check-bun-lock-drift.ts --seeds <list>`.                                                                                                                                                                                                                                                 |
| `.dagger/src/index.ts`                  | `@func() bunLockDriftCheck(source, seeds)` wrapper.                                                                                                                                                                                                                                                                                                                 |
| `scripts/ci/src/steps/quality.ts`       | `bunLockDriftCheckStep(seeds: string[])` — label `:lock: Lockfile Drift Check`, key `bun-lock-drift-check`, 5-min timeout. Passes `--seeds`, NOT `--packages`.                                                                                                                                                                                                      |
| `scripts/ci/src/lib/types.ts`           | `AffectedPackages.directlyChanged: Set<string>` — the diff seeds (top-level package dirs whose own files changed) separate from the post-`transitiveClosure` `packages` set.                                                                                                                                                                                        |
| `scripts/ci/src/change-detection.ts`    | Populate `directlyChanged` in every result builder; `buildScopedResult` now takes it as a second parameter.                                                                                                                                                                                                                                                         |
| `scripts/ci/src/pipeline-builder.ts`    | Conditionally insert the step into `blockingGates` next to `lockfileCheckStep()`. Only emit when `!affected.buildAll && affected.directlyChanged.size > 0` — on `buildAll` every per-package job already runs frozen install (gate adds no signal); on no-direct-changes paths (e.g. helm-types-only, version-commit-back) the drift gate has nothing to seed from. |

No lefthook / pre-commit wiring (per the explicit user scope). No Renovate config changes — `postUpgradeTasks` is a follow-up.

## Departure from the harness plan

The harness plan (`~/.claude/plans/ok-1-sounds-fine-replicated-swan.md`) said the Dagger helper would shell out to `--base origin/main`. That was wrong: `bunQualityBase` doesn't ship `git`, so an in-container `git diff` would fail. The first implementation pivoted to `--packages` consuming `affected.packages` server-side — which Greptile correctly flagged as silently broken (the change detector's top-level-only closure misses the dpp case the gate was built to catch). The gate now uses a `--seeds` mode that takes `affected.directlyChanged` (the diff seeds, pre-closure) and re-expands inside the script with the nested-workspace-aware graph. The `--base` mode survives for local-dev use.

## Verification

Reproduced locally before opening the PR:

1. **Drift reproduces** — in the worktree, `bun scripts/check-bun-lock-drift.ts --packages discord-plays-pokemon` against `origin/main` (which still carries the unfixed dpp lockfile) exits 1 with the expected `lockfile had changes, but lockfile is frozen` message and the `cd packages/discord-plays-pokemon && bun install …` fix line.
2. **Closure reaches nested-workspace deps** — `bun scripts/check-bun-lock-drift.ts --base HEAD~5` correctly extends the touched seed `{birmel, llm-observability, monarch, scout-for-lol, temporal}` to include `discord-plays-pokemon` (via the nested `packages/backend/package.json`).
3. **Clean exits 0** — `bun scripts/check-bun-lock-drift.ts --packages birmel,scout-for-lol,llm-observability,monarch,temporal` exits 0.
4. **No-op exits 0** — `bun scripts/check-bun-lock-drift.ts --base HEAD` (empty diff against itself) exits 0 without invoking `bun install` once.
5. **Sweep cost** — `bun scripts/check-bun-lock-drift.ts --all` across 27 top-level lockfiles completes in ~80 ms on a warm cache; Dagger's persistent `BUN_CACHE` mount keeps the CI run comparably fast after the first build.

## Follow-ups (out of scope)

- **Renovate `postUpgradeTasks`** — auto-regenerate every dependent `bun.lock` at PR creation, so drift never reaches CI.
- **Auto-merge gate** — Renovate currently auto-merges on Greptile alone if Buildkite is canceled (PR #1213 pre-condition). The branch ruleset (`packages/homelab/src/tofu/github/rulesets.tf`) should require a successful Buildkite build for the head SHA.
- **Nightly full-sweep on main** — catches drift introduced without a `package.json` change (bun upgrade, registry republish). Trivial reuse of `--all` mode.

## Session Log — 2026-06-14

### Done

- Opened PR [#1218](https://github.com/shepherdjerred/monorepo/pull/1218) — `fix(discord-plays-pokemon): regenerate bun.lock for @anthropic-ai/sdk 0.96.0`. Unblocks main from the immediate `:eslint: Lint` / `:typescript: Typecheck` / `:test_tube: Test` failures since build #4233.
- Opened PR [#1222](https://github.com/shepherdjerred/monorepo/pull/1222) — `feat(ci): per-package bun.lock drift gate`. New `:lock: Lockfile Drift Check` step in `blockingGates`. Implementation matches this plan with one correction noted in "Departure from the harness plan".

### Remaining

- Buildkite green on #1222 (must show the new `:lock: Lockfile Drift Check` step passing on its own PR).
- After merge, watch the next Renovate PR fan-out to confirm the gate actually fires red-then-green on real drift.
- Move this plan to `packages/docs/archive/completed/` when #1222 lands.
- Follow-ups (Renovate `postUpgradeTasks`, branch-ruleset Buildkite requirement, nightly full sweep on main) — separate PRs.

### Caveats

- The gate currently does NOT catch drift introduced without a `packages/*/package.json` or `packages/*/bun.lock` change (bun-version upgrade, registry republish). Acceptable for v1; the "nightly full sweep" follow-up closes the gap.
- The reverse-closure walker reads the actual `workspaces` field of each top-level manifest, but if a future package adds a `file:` dep from a path the manifest's `workspaces` glob doesn't cover, that edge is invisible. There is no existing case like this in the repo.
- The `:lock: Lockfile Drift Check` step name is intentionally distinct from `:lock: Lockfile Check` (root `bun.lock` only). They're complementary; both stay.

## Session Log — 2026-06-14 (drift-gate seed fix)

### Done

- Fixed the P1 Greptile finding on PR #1222: the CI gate was being passed `affected.packages` (the closure from `change-detection.transitiveClosure`, which reads only top-level manifests), so the dpp/nested-workspace scenario the gate was built to catch slipped through silently.
- Added `--seeds a,b,c` mode to `scripts/check-bun-lock-drift.ts` that takes the directly-changed packages, expands the reverse closure with the script's own nested-workspace-aware `readWorkspaceDeps`, then dry-runs the closure.
- Added `directlyChanged: Set<string>` to `AffectedPackages` and populated it in every `change-detection.ts` result builder (`buildScopedResult`, `fullBuildResult`, `emptyResult` + each call site).
- Wired the pipeline-builder to pass `affected.directlyChanged` (sorted) as `--seeds`. Updated the dagger helper and the `@func` wrapper accordingly.
- Verified locally: `bun scripts/check-bun-lock-drift.ts --seeds llm-observability` now expands to `{birmel, discord-plays-pokemon, llm-observability, scout-for-lol, temporal}` and catches the real dpp drift on main — exactly the regression Greptile flagged.
- Added 5 new pipeline-builder tests covering the seeds vs. closure regression, sort stability, buildAll skip, no-direct-changes skip, and a scoped happy-path.
- All `scripts/ci/` tests pass (271 / 271); CI/dagger typecheck clean (modulo the pre-existing `@dagger.io/dagger` module resolution warnings that are generated at `dagger develop` time).

### Remaining

- Push the fix; wait for Buildkite green on #1222 (`:lock: Lockfile Drift Check` must be visible in the pipeline).
- Move this plan to `packages/docs/archive/completed/` when #1222 lands.

### Caveats

- `--packages` mode is preserved (debug/advanced use) but explicitly marked as not-for-CI in the script header and step docstring; CI uses `--seeds`.
- The drift gate now correctly omits itself on paths where `directlyChanged` is empty even if `packages` is non-empty — e.g. helm-types-only Renovate noops that put `homelab` in `packages` to drive other gates. This is the right behavior (no `package.json`/`bun.lock` was touched, so the gate has nothing to seed from).
