# Plan: Move `scripts/` to `packages/`

## Status

Not Started. Root `scripts/` still exists; `packages/ci/` and `packages/scripts/` do not.

## Context

The monorepo convention is that all code lives under `packages/`, but `scripts/` sits at the root as a holdover. `scripts/ci/` is already a proper Bun package (`@shepherdjerred/ci`). Moving everything under `packages/` makes the repo structure consistent and aligns with the workspace model.

## Approach

Two moves:

1. `scripts/ci/` -> `packages/ci/` (already a Bun package, just relocate)
2. Remaining loose scripts -> `packages/scripts/` (new package `@shepherdjerred/scripts`)

This plan also owns the archived `scripts/ci` ESLint follow-up. Add CI-script linting after the path move so the new `packages/ci` location is the only target to wire into lint and CI.

## Phase 1: Move files

### 1a. `git mv scripts/ci packages/ci`

- tsconfig `extends` uses `../../tsconfig.base.json` — same depth, no change needed
- tsconfig `include` has `../../.dagger/src/deps.ts` — same depth, no change needed

### 1b. Move loose scripts to `packages/scripts/`

```
mkdir packages/scripts
git mv scripts/*.ts scripts/*.sh scripts/*.py scripts/BENCH.md packages/scripts/
rmdir scripts  # should be empty after both moves
```

Create `packages/scripts/package.json`:

```json
{
  "name": "@shepherdjerred/scripts",
  "private": true
}
```

### 1c. Fix `setup.ts` ROOT calculation

`packages/scripts/setup.ts` line 9: `join(import.meta.dirname, "..")` must become `join(import.meta.dirname, "../..")` since it's now 2 levels deep from repo root.

## Phase 2: Update all external references

### Root config files

| File                       | Change                                            |
| -------------------------- | ------------------------------------------------- |
| `package.json` (5 scripts) | `scripts/` -> `packages/scripts/`                 |
| `.mise.toml`               | `scripts/setup.ts` -> `packages/scripts/setup.ts` |

### lefthook.yml (7 run commands + 1 glob)

| Old                                          | New                                                   |
| -------------------------------------------- | ----------------------------------------------------- |
| `bun scripts/validate-commit-msg.ts`         | `bun packages/scripts/validate-commit-msg.ts`         |
| `bash scripts/check-env-var-names.sh`        | `bash packages/scripts/check-env-var-names.sh`        |
| `bun scripts/check-suppressions.ts`          | `bun packages/scripts/check-suppressions.ts`          |
| `bun scripts/guard-no-package-exclusions.ts` | `bun packages/scripts/guard-no-package-exclusions.ts` |
| `bash scripts/compliance-check.sh`           | `bash packages/scripts/compliance-check.sh`           |
| `bash scripts/check-dagger-hygiene.sh`       | `bash packages/scripts/check-dagger-hygiene.sh`       |
| `bash scripts/quality-ratchet.sh`            | `bash packages/scripts/quality-ratchet.sh`            |
| `"scripts/ci/src/**/*.ts"` (glob)            | `"packages/ci/src/**/*.ts"`                           |

### .buildkite/scripts/ (16 shell scripts)

All `cd scripts/ci && ...` -> `cd packages/ci && ...`:

- `generate-pipeline.sh`, `deploy-site.sh`, `clauderon-build.sh`, `release.sh`, `publish-npm-package.sh`, `cooklang-create-release.sh`, `push-image.sh`, `version-commit-back.sh`, `homelab-argocd-health.sh`, `clauderon-upload.sh`, `cooklang-build.sh`, `cooklang-push.sh`, `homelab-tofu-stack.sh`, `deploy-argocd.sh`, `homelab-cdk8s.sh`, `homelab-helm-push.sh`

Plus `quality-gate.sh`: `PYTHONPATH=scripts/ci/src ... --project scripts/ci` -> `PYTHONPATH=packages/ci/src ... --project packages/ci`

### CI pipeline generator (inside packages/ci/src/ after move)

| File                     | Lines        | Change                                                                                                    |
| ------------------------ | ------------ | --------------------------------------------------------------------------------------------------------- |
| `change-detection.ts:32` | `INFRA_DIRS` | `"scripts/ci/"` -> `"packages/ci/"`                                                                       |
| `steps/quality.ts:80`    | command      | `"bun scripts/quality-ratchet.ts"` -> `"bun packages/scripts/quality-ratchet.ts"`                         |
| `steps/quality.ts:89`    | command      | `"bash scripts/compliance-check.sh"` -> `"bash packages/scripts/compliance-check.sh"`                     |
| `steps/quality.ts:123`   | command      | `"bun scripts/check-suppressions.ts --ci"` -> `"bun packages/scripts/check-suppressions.ts --ci"`         |
| `steps/quality.ts:144`   | command      | `"bun scripts/check-dagger-hygiene.ts"` -> `"bun packages/scripts/check-dagger-hygiene.ts"`               |
| `steps/quality.ts:178`   | command      | `"bash scripts/check-env-var-names.sh"` -> `"bash packages/scripts/check-env-var-names.sh"`               |
| `steps/quality.ts:187`   | command      | `"bun scripts/guard-no-package-exclusions.ts"` -> `"bun packages/scripts/guard-no-package-exclusions.ts"` |

### CI tests (inside `packages/ci/src/__tests__/` after move)

| File                          | Change                                                      |
| ----------------------------- | ----------------------------------------------------------- |
| `dagger-hygiene.test.ts:39`   | `scripts/ci/src/catalog.ts` -> `packages/ci/src/catalog.ts` |
| `change-detection.test.ts:33` | `scripts/ci/src/main.ts` -> `packages/ci/src/main.ts`       |
| `change-detection.test.ts:32` | test description string (cosmetic)                          |

### Dagger

| File                     | Change                                                                      |
| ------------------------ | --------------------------------------------------------------------------- |
| `.dagger/src/misc.ts:93` | `scripts/generate-caddyfile.ts` -> `packages/scripts/generate-caddyfile.ts` |

### Example package postinstall paths

| File                                                           | Old                                        | New                                     |
| -------------------------------------------------------------- | ------------------------------------------ | --------------------------------------- |
| `packages/webring/example/package.json`                        | `../../../scripts/copy-example-deps.ts`    | `../../scripts/copy-example-deps.ts`    |
| `packages/astro-opengraph-images/examples/custom/package.json` | `../../../../scripts/copy-example-deps.ts` | `../../../scripts/copy-example-deps.ts` |
| `packages/astro-opengraph-images/examples/preset/package.json` | `../../../../scripts/copy-example-deps.ts` | `../../../scripts/copy-example-deps.ts` |

### Other config files

| File              | Change                                                                  |
| ----------------- | ----------------------------------------------------------------------- |
| `knip.json`       | `"scripts/**"` ignore -> `"packages/scripts/**"`                        |
| `.conflictignore` | `scripts/ci/src/steps/quality.ts` -> `packages/ci/src/steps/quality.ts` |

### Documentation

| File             | Change                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `CLAUDE.md`      | Update all `scripts/ci/` and `scripts/` references                                              |
| `packages/docs/` | Update references in docs (archive docs can be left as-is since they describe historical state) |

### CI catalog

| File                         | Change                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ci/src/catalog.ts` | If `ALL_PACKAGES` doesn't already include `ci` and `scripts`, add them. Or add to `SKIP_PACKAGES` if they shouldn't have CI steps. |

## Phase 3: Verification

1. `bun run typecheck` — type errors across monorepo
2. `bun run test` — run all tests
3. `cd packages/ci && bun test` — CI package tests specifically
4. `bun run packages/scripts/setup.ts` — verify ROOT computation works
5. Grep entire repo for stale root `scripts/` references (excluding `node_modules/`, `.git/`, and package-local `scripts/` dirs)
6. Verify `lefthook run pre-commit` hooks resolve

## Notes

- The 15 `.buildkite/scripts/*.sh` files that invoke `python -m ci.*` reference Python modules that **don't exist** in `scripts/ci/src/ci/`. These are dead code. The path update (`cd scripts/ci` -> `cd packages/ci`) is still correct for consistency, but these scripts will fail at runtime regardless. Out of scope for this PR but worth noting.
- Package-local `scripts/` directories (e.g., `packages/homelab/src/cdk8s/scripts/`) are unrelated and should NOT be changed.
