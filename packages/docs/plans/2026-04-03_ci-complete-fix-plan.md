# Dagger, BuildKite & CI — Complete Fix Plan

> Full audit of `.dagger/src/` (21 files), `scripts/ci/src/` (16+ files), `.buildkite/scripts/` (24 scripts). 14+ agents conducted broad pattern scanning and deep line-by-line logic review. Cross-referenced against goals in `packages/docs/decisions/` and `packages/docs/plans/`.

## Work DAG

```
Layer 0 (independent, all parallel)
├── A1: argocd --timeout-secs → --timeout-seconds          [1 line]
├── A2: depNames/depDirs length validation (6 files)        [~18 lines]
├── A3: Renovate annotation on CADDY_BUILDER_IMAGE          [1 line]
├── A4: add ~8 missing packages to deps.ts                  [~16 lines]
├── A5: tighten tasknotes smoke pattern "3000"              [1 line]
├── A6: eliminate cooklang double-build                      [~15 lines]
├── A7: mount homelabTsconfig in ci.ts                      [~6 lines]
├── A8: formatFailureDetails undefined → fallback           [1 line]
├── A9: lefthook.yml rewrite large-file check               [~5 lines]
├── A10: check() catch handle non-Error types               [~3 lines]
├── A11: centralize resolveDeps in lib/buildkite.ts         [~20 lines]
├── A12: K8s plugin resource presets                         [~15 lines]
└── A13: verify frontend deploys (DRYRUN_FLAG + creds)      [investigation]

Layer 1 (release.ts bug fixes — must complete before refactor)
│   depends on: nothing (but touching release.ts, do before split)
├── B1: fix digests single-quote injection                   [~8 lines]
├── B2: fix cargoDenyHelper caches + mount order             [~10 lines]
├── B3: use GH_CLI_VERSION constant (2 locations)            [2 lines]
└── B4: narrow silent catch to ENOENT only                   [~5 lines]

Layer 2 (refactor — the big structural change)
│   depends on: B1, B2, B3, B4 (all release.ts bugs fixed first)
└── C1: split release.ts → 9 modules                        [~834 lines moved]
    ├── extract ghCliContainer() helper                      [~15 lines new]
    ├── extract withDryrun() helper                          [~8 lines new]
    └── update index.ts imports                              [~20 lines changed]

Layer 3 (new features — parallel, after or alongside refactor)
│   depends on: nothing (new files, independent of release.ts)
├── D1: CDK8s validation (homelab.ts + index.ts + per-pkg)   [~80 lines new]
├── D2: wire Bun test coverage into CI                       [~30 lines]
├── D3: wire Java/JaCoCo coverage into CI                    [~15 lines]
├── D4: tofu scheduled drift detection                       [~40 lines]
└── D5: tofu PR plan annotations                             [~25 lines]

Layer 4 (tests — benefits from refactor making modules smaller)
│   depends on: C1 (smaller modules = easier to test)
└── E1: critical-path test coverage                          [~400 lines new]
    ├── smoke test evaluation logic (misc.ts)
    ├── step generator command correctness (steps/*.ts)
    ├── depNames/depDirs validation behavior
    └── pipeline builder snapshot tests

Layer 5 (final)
│   depends on: everything above
└── F1: end-to-end verification
    ├── bun run typecheck
    ├── bun run test
    ├── cd .dagger && bun test
    ├── cd scripts/ci && bun test
    ├── bun run scripts/check-dagger-hygiene.ts
    └── pipeline generates without errors
```

---

## Audit Findings Summary

### Tier 1: Critical

| #   | Issue                                                                  | File:Line                        |
| --- | ---------------------------------------------------------------------- | -------------------------------- |
| 1   | ArgoCD `--timeout-secs` should be `--timeout-seconds` (param mismatch) | `argocd.ts:47` vs `index.ts:671` |
| 2   | Single-quote injection: `echo '${digests}'` breaks if JSON has `'`     | `release.ts:593`                 |
| 3   | No depNames/depDirs length validation (6 files)                        | `base.ts:59`, `image.ts:34`, +4  |
| 4   | CDK8s lint/typecheck/test never run in CI                              | `homelab.ts`, `per-package.ts`   |

### Tier 2: High

| #   | Issue                                                    | File:Line            |
| --- | -------------------------------------------------------- | -------------------- |
| 5-6 | cargoDenyHelper: missing 2 caches + wrong mount order    | `release.ts:820-833` |
| 7   | Hardcoded `v2.74.0` instead of `GH_CLI_VERSION` constant | `release.ts:483,572` |
| 8   | CADDY_BUILDER_IMAGE missing Renovate annotation          | `constants.ts:33`    |
| 9   | Silent catch swallows all errors (not just ENOENT)       | `release.ts:238`     |
| 10  | ~8 packages missing from WORKSPACE_DEPS                  | `deps.ts`            |
| 11  | tasknotes pattern `"3000"` matches error messages        | `misc.ts:290`        |
| 12  | Cooklang double-build (per-package + cooklang-build)     | `cooklang.ts:23-37`  |
| 13  | ci.ts missing homelabTsconfig mount for HA generation    | `ci.ts:177-182`      |

### Tier 3: Medium

| #   | Issue                                            | File:Line               |
| --- | ------------------------------------------------ | ----------------------- |
| 14  | Shell values interpolated without escaping       | `release.ts:54,399,428` |
| 15  | `formatFailureDetails` prints `"undefined"`      | `ci-format.ts:44`       |
| 16  | `lefthook.yml` has banned patterns (not scanned) | `lefthook.yml:40`       |
| 17  | 11 duplicate dryrun echo branches                | `release.ts` (11 locs)  |
| 18  | Multi-tag push: no rollback on partial failure   | `image.ts:81-84`        |
| 19  | Fragile sed for aarch64 cross-compilation        | `rust.ts:66-70`         |
| 20  | `check()` catch assumes Error type               | `ci.ts:33`              |

### Agent False Positives (verified NOT bugs)

- Smoke test `|| true` → working tree already has exit-code checking
- `DRYRUN=true` hardcoded → false; all functions accept `dryrun` param (default `false`)
- `index.ts` too large → ~210 lines real wrapper code; architecture is correct
- Timeout exit 124 = "logic inversion" → correct; exit 124 = service survived 30s = success
- `captureContainerOutput` error context lost → outer `error` correctly captured in closure
- `ciAll` Promise.all race condition → Dagger containers are immutable DAG nodes

### Confirmed Strengths

- Zero `any`, zero `as` assertions in production code
- All secrets use Dagger `Secret` type; git auth via `GIT_ASKPASS`
- 24/24 shell scripts use `set -euo pipefail`
- 13+ tool versions Renovate-managed with annotations
- 1,037 lines of tests across 7 files; catalog validates against filesystem
- 17 quality gates (11 blocking, 4 soft-fail, 2 dagger)
- Trivy, Semgrep, Gitleaks, Shellcheck all pinned
- Proper mutual exclusion on tofu and argocd
- All `dagger call` commands match function signatures (except #1)

---

## Feature Gaps

### Frontend Deploys — Already Configured

All 8 sites configured in `catalog.ts:88-143`. Pipeline steps exist in `sites.ts`. Dagger helpers exist in `release.ts:272-371` and `misc.ts:20-49`. **Action:** Verify they actually execute (check DRYRUN_FLAG, SeaweedFS credentials, recent builds).

### Coverage Reporting — Infrastructure Exists, Not Wired

- **Bun:** `bunfig.toml` has 70% thresholds + lcov reporter. No CI step.
- **Java:** `mavenCoverageHelper()` exists in `java.ts:46-62` + JaCoCo in `pom.xml:85-88`. No CI step invokes it.

### Tofu Drift Detection — PR Plan + Main Apply Work

- PR plan with `-detailed-exitcode` on 3 stacks: exists
- Main apply with `-auto-approve`: exists
- **Missing:** Scheduled drift detection (cron), PR plan annotations

---

## Detailed Scope Per Task

### Layer 0: Independent fixes (all parallel)

**A1: ArgoCD parameter name mismatch**

- File: `scripts/ci/src/steps/argocd.ts:47`
- Change: `--timeout-secs` → `--timeout-seconds`
- Size: 1 line

**A2: depNames/depDirs length validation**

- Files: `.dagger/src/base.ts:59`, `image.ts:34`, `playwright.ts:57`, `release.ts:199,307,457`
- Change: Add `if (depNames.length !== depDirs.length) throw new Error(...)` before each loop
- Size: ~18 lines (3 lines × 6 locations)

**A3: Renovate annotation on CADDY_BUILDER_IMAGE**

- File: `.dagger/src/constants.ts:33`
- Change: Add `// renovate: datasource=docker depName=caddy` above the constant
- Size: 1 line

**A4: Add missing packages to deps.ts**

- File: `.dagger/src/deps.ts`
- Change: Add entries for birmel, glance, homelab (root), leetcode, monarch, resume, tips, toolkit
- Requires: Read each package's package.json to determine workspace dependencies
- Size: ~16 lines (2 lines per package)

**A5: Tighten tasknotes smoke test pattern**

- File: `.dagger/src/misc.ts:290`
- Change: Replace `"3000"` with `"listening on port 3000"` or `"listening on 3000"`
- Size: 1 line

**A6: Eliminate cooklang double-build**

- File: `scripts/ci/src/steps/cooklang.ts:23-37`
- Change: Have cooklang-build step depend on per-package build and skip redundant compilation, OR remove cooklang-for-obsidian from per-package build steps (add to SKIP_PACKAGES for build, keep for lint/typecheck/test)
- Size: ~15 lines

**A7: Mount homelabTsconfig in ci.ts**

- File: `.dagger/src/ci.ts:177-182`
- Change: After `bunBaseContainer()` call, mount homelabTsconfig at `/workspace/packages/homelab/tsconfig.base.json` (match pattern from homelab.ts:51-56)
- Requires: Extract homelabTsconfig from source directory
- Size: ~6 lines

**A8: formatFailureDetails undefined handling**

- File: `.dagger/src/ci-format.ts:44`
- Change: `f.error` → `f.error ?? "No error details available"`
- Size: 1 line

**A9: Rewrite lefthook large-file check**

- File: `lefthook.yml:40`
- Change: Replace `wc -c < "$f" 2>/dev/null || echo 0` with `wc -c < "$f"` (fail fast) or `stat`-based approach
- Size: ~5 lines

**A10: check() catch handle non-Error types**

- File: `.dagger/src/ci.ts:33`
- Change: `(e: Error)` → `(e: unknown)` and use `e instanceof Error ? e.message : String(e)`
- Size: ~3 lines

**A11: Centralize resolveDeps**

- File: `scripts/ci/src/lib/buildkite.ts` (add new export)
- Change: Add `resolveDeps(baseKey, pkgKey?, extras?)` helper. Update callers in steps/\*.ts.
- Size: ~20 lines new + ~10 lines changed across callers

**A12: K8s plugin resource presets**

- File: `scripts/ci/src/lib/k8s-plugin.ts`
- Change: Add `K8S_LIGHT`, `K8S_MEDIUM`, `K8S_HEAVY` preset objects. Replace inline resource specs.
- Size: ~15 lines new + ~20 lines simplified across callers

**A13: Verify frontend deploys**

- Action: Read DRYRUN_FLAG value. If it adds `--dryrun`, trace where it's set. Check SeaweedFS secrets. Check recent main-branch build logs.
- Size: Investigation → 0 lines if working, or fix DRYRUN_FLAG if blocking

### Layer 1: release.ts bug fixes (before refactor)

**B1: Fix digests single-quote injection**

- File: `.dagger/src/release.ts:593`
- Change: Replace `echo '${digests}'` with base64 encoding:

  ```
  echo '${Buffer.from(digests).toString("base64")}' | base64 -d | jq ...
  ```

- Size: ~8 lines

**B2: Fix cargoDenyHelper caches + mount order**

- File: `.dagger/src/release.ts:820-833`
- Change: (1) Move cache mounts before `.withDirectory()`. (2) Add `cargo-git` and `target` cache volumes.
- Size: ~10 lines

**B3: Use GH_CLI_VERSION constant**

- File: `.dagger/src/release.ts:483,572`
- Change: Replace literal `v2.74.0` with `v${GH_CLI_VERSION}`
- Size: 2 lines

**B4: Narrow silent catch**

- File: `.dagger/src/release.ts:238`
- Change: Rethrow if not file-not-found:

  ```typescript
  catch(e) {
    if (e instanceof Error && (e.message.includes("ENOENT") || e.message.includes("no such file"))) continue;
    throw e;
  }
  ```

- Size: ~5 lines

### Layer 2: Refactor release.ts

**C1: Split release.ts into 9 modules + extract helpers**

- Source: `.dagger/src/release.ts` (834 lines)
- Target files:
  - `.dagger/src/release-helm.ts` — `helmPackageHelper()` (lines 28-69)
  - `.dagger/src/release-tofu.ts` — `tofuApplyHelper()`, `tofuPlanHelper()` (lines 76-168)
  - `.dagger/src/release-npm.ts` — `publishNpmHelper()` (lines 179-266)
  - `.dagger/src/release-sites.ts` — `deploySiteHelper()` (lines 272-372)
  - `.dagger/src/release-argocd.ts` — `argoCdSyncHelper()`, `argoCdHealthWaitHelper()` (lines 378-431)
  - `.dagger/src/release-cooklang.ts` — 3 cooklang helpers (lines 437-516, 667-743)
  - `.dagger/src/release-clauderon.ts` — upload + collectBinaries (lines 523-653)
  - `.dagger/src/release-version.ts` — versionCommitBack + releasePlease (lines 560-703)
  - `.dagger/src/release-review.ts` — codeReviewHelper (lines 751-814)
- Shared helpers:
  - `ghCliContainer(baseImage, additionalPkgs, ghToken)` — replaces 3 duplicated setups
  - `withDryrun(container, dryrun, message, actualExec)` — replaces 11 identical branches
- Update `.dagger/src/index.ts` imports
- Size: ~834 lines moved, ~30 lines new helpers, ~50 lines simplified

### Layer 3: New features (parallel)

**D1: CDK8s validation helpers + CI wiring**

- New helpers in `.dagger/src/homelab.ts`: `homelabCdk8sLintHelper`, `TypecheckHelper`, `TestHelper`
- New @func() wrappers in `.dagger/src/index.ts`
- Wire into `scripts/ci/src/steps/per-package.ts` alongside existing HA steps
- Size: ~80 lines new

**D2: Wire Bun test coverage into CI**

- Modify `.dagger/src/typescript.ts` testHelper: add optional `coverage` parameter
- Add coverage step variant in `scripts/ci/src/steps/per-package.ts`
- Add Buildkite artifact upload for coverage reports
- Size: ~30 lines

**D3: Wire Java/JaCoCo coverage into CI**

- Add CI step in `scripts/ci/src/steps/per-package.ts`: `dagger call maven-coverage --pkg-dir ./packages/castle-casters`
- Size: ~15 lines

**D4: Tofu scheduled drift detection**

- Add scheduled pipeline trigger (Buildkite cron or `.buildkite/pipeline-drift.yml`)
- Runs `tofu plan` on all 3 stacks periodically, reports via annotation
- Size: ~40 lines

**D5: Tofu PR plan annotations**

- Modify `scripts/ci/src/steps/tofu.ts` tofuPlanStep: capture plan output
- Add Buildkite annotation with plan diff
- Size: ~25 lines

### Layer 4: Tests

**E1: Critical-path test coverage**

- `.dagger/src/__tests__/misc.test.ts` — smoke test evaluation: success/fail patterns, empty output, edge cases (~10 cases)
- `.dagger/src/__tests__/base.test.ts` — depNames/depDirs validation: matched, mismatched, empty (~6 cases)
- `scripts/ci/src/__tests__/steps.test.ts` — step generators: dagger call strings, deps, conditions (~15 cases)
- `scripts/ci/src/__tests__/pipeline-snapshot.test.ts` — full/partial pipeline snapshots (~4 cases)

Size: ~400 lines across 4 test files

### Layer 5: Verification

1. `bun run typecheck`
2. `bun run test`
3. `cd .dagger && bun test`
4. `cd scripts/ci && bun test`
5. `bun run scripts/check-dagger-hygiene.ts`
6. `cd scripts/ci && bun run src/main.ts` — pipeline generates
7. Review generated pipeline JSON

---

## Summary

| Layer     | Tasks                  | Total scope                                  | Parallelism  |
| --------- | ---------------------- | -------------------------------------------- | ------------ |
| 0         | 13 independent fixes   | ~100 lines changed                           | All parallel |
| 1         | 4 release.ts bug fixes | ~25 lines changed                            | All parallel |
| 2         | 1 large refactor       | ~834 lines moved, ~80 lines new/changed      | Sequential   |
| 3         | 5 new features         | ~190 lines new                               | All parallel |
| 4         | 1 test suite           | ~400 lines new                               | Sequential   |
| 5         | 1 verification         | 0 lines                                      | Sequential   |
| **Total** | **25 tasks**           | **~800 lines new/changed + 834 lines moved** |              |

Desktop/Tauri builds: skipped.
