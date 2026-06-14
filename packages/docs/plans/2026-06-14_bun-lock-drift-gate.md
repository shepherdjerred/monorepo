# Per-package `bun.lock` drift gate

## Status

In Progress

## Context

PR #1213 (`@anthropic-ai/sdk` 0.95 → 0.96) regenerated `packages/llm-observability/bun.lock` but left `packages/discord-plays-pokemon/bun.lock` stale, because dpp pulls llm-obs via `file:../llm-observability` (declared in the nested `packages/discord-plays-pokemon/packages/backend/package.json`). Renovate doesn't propagate transitive lockfile updates across workspace `file:` links. The drift hid through #1213's branch CI (canceled twice by intermediate pushes, auto-merged on Greptile-only), through main build #4232 (canceled when #1214 merged 7 min later), and only surfaced on build #4233's dpp Lint/Typecheck/Test — looking like a protobufjs bug. Same pattern previously caused `fedba1020` and `649f56077`.

The gate catches it at PR time with `bun install --frozen-lockfile --dry-run` (resolve-only, no download/link) per package — fast enough to run on every PR, scoped via the existing affected-packages closure so the cost stays in ms.

## The check

`scripts/check-bun-lock-drift.ts` supports three modes:

1. `--packages a,b,c` — CI mode. Used by the Dagger gate; the pipeline generator computes `affected.packages` (already a transitive closure) and passes it as a comma-separated list.
2. `--base <ref>` — local dev mode. Diffs `packages/<X>/package.json` and `packages/<X>/bun.lock` vs `<ref>`, walks the reverse `file:`-dep closure (reads each top-level `package.json` + its declared `workspaces` to catch nested manifests), and dry-runs the closure.
3. `--all` — debug / nightly. Sweeps every `packages/<X>/bun.lock`.

For each affected package, the script runs `bun install --frozen-lockfile --dry-run` in `packages/<P>/`. Exit non-zero on any failure, listing each drifted lockfile + the verbatim `bun` error + a `(cd packages/X && bun install) && git add packages/X/bun.lock` fix line.

The reverse-dep walker **walks nested workspaces** (`packages/<X>/packages/backend/package.json`, etc.) so the dpp case — where the `file:`-dep edge to `llm-observability` is declared in a nested manifest — is correctly attributed to `discord-plays-pokemon` for closure purposes. This is the only meaningful difference from `scripts/ci/src/change-detection.ts:readWorkspaceDeps`, which only reads top-level manifests and would silently miss dpp here.

## Wiring

| File                                    | Change                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/check-bun-lock-drift.ts` (new) | The check above.                                                                                                                                                                                                                                                                       |
| `.dagger/src/quality.ts`                | `bunLockDriftCheckHelper(source, packages)` — `bunQualityBase` + `bun scripts/check-bun-lock-drift.ts --packages <list>`.                                                                                                                                                              |
| `.dagger/src/index.ts`                  | `@func() bunLockDriftCheck(source, packages)` wrapper.                                                                                                                                                                                                                                 |
| `scripts/ci/src/steps/quality.ts`       | `bunLockDriftCheckStep(packages: string[])` — label `:lock: Lockfile Drift Check`, key `bun-lock-drift-check`, 5-min timeout.                                                                                                                                                          |
| `scripts/ci/src/pipeline-builder.ts`    | Conditionally insert the step into `blockingGates` next to `lockfileCheckStep()`. Only emit when `!affected.buildAll && packages.length > 0` — on `buildAll` every per-package job already runs frozen install (gate adds no signal); on the no-changes path we short-circuit earlier. |

No lefthook / pre-commit wiring (per the explicit user scope). No Renovate config changes — `postUpgradeTasks` is a follow-up.

## Departure from the harness plan

The harness plan (`~/.claude/plans/ok-1-sounds-fine-replicated-swan.md`) said the Dagger helper would shell out to `--base origin/main`. That was wrong: `bunQualityBase` doesn't ship `git`, so an in-container `git diff` would fail. The implemented gate passes `--packages` instead, using the affected-packages closure that `change-detection.ts` already produces server-side. The `--base` mode survives for local-dev use.

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
