# Plan: Buildkite Dynamic Pipeline for Granular Dagger CI Visibility

## Context

The entire Dagger CI pipeline runs as a single opaque Buildkite step (`dagger call ci`). When something fails, developers dig through logs to find which check broke. This change splits Tier 0 validation checks into individual Buildkite steps — each gets its own pass/fail, logs, and retry button.

One Dagger engine pod (K8s) means all `dagger call` must be serialized. Sequential steps on one engine share BuildKit cache automatically.

## Step 1: Expose `complianceCheck` as a `@func()`

`complianceCheck` in `index-infra.ts:279` is a plain function (not a `@func()`), so it can't be called via `dagger call`. Add a `@func()` wrapper to the `Monorepo` class.

**File:** `.dagger/src/index.ts`
```ts
@func()
async complianceCheck(source: Directory): Promise<string> {
  await complianceCheck(source).sync();
  return "✓ Compliance check";
}
```

## Step 2: Extract shared setup to `setup-dagger.sh`

**Create:** `.buildkite/scripts/setup-dagger.sh`

Extract the ~30 lines duplicated across `ci.sh`, `code-review.sh`, `code-review-interactive.sh`, `update-readmes.sh`:
- Install system deps (curl, jq)
- Install kubectl
- Install Dagger CLI (version from `dagger.json`)
- Find Dagger engine pod, export `_EXPERIMENTAL_DAGGER_RUNNER_HOST`
- Install Dagger module deps (`cd .dagger && bun install --frozen-lockfile`)
- Guard with `_DAGGER_SETUP_DONE` so safe to source multiple times

## Step 3: Create generic dagger wrapper

**Create:** `.buildkite/scripts/run-dagger.sh`
- Sources `setup-dagger.sh`
- Runs `dagger -v call "$@"`
- No retry (Buildkite `retry.automatic` handles it)

## Step 4: Write TypeScript pipeline generator

**Create:** `.buildkite/generate-pipeline.ts`

A bun script that:
1. Detects versions-only changes (Renovate fast path) via `git diff`
2. Builds a pipeline object with typed step definitions
3. Outputs JSON to stdout (Buildkite's `pipeline upload` accepts JSON)

The script defines step configs for:
- 5 Tier 0 checks (compliance, quality, mobile, birmel, packages)
- Main CI step (`ci-main.sh`, depends_on all 5 checks)
- Code review (PR only, soft_fail, independent)
- Update READMEs (main only, depends_on CI)

Every dagger-calling step gets:
- `concurrency: 1` + `concurrency_group: "dagger"` (serializes within AND across builds)
- `retry.automatic` for exit codes -1 and 255
- The kubernetes plugin with `buildkite-ci-secrets`

No `depends_on` between the 5 checks — all run even if earlier ones fail. The CI step hard-depends on all 5 (skips if any fail).

Each check step's `command` is: `.buildkite/scripts/run-dagger.sh <function-name> --source=. [args...]`

## Step 5: Create main CI step script

**Create:** `.buildkite/scripts/ci-main.sh`
- Sources `setup-dagger.sh`
- Builds args array with branch-specific secrets (from current `ci.sh`)
- Runs `dagger -v call ci "${ARGS[@]}"`

## Step 6: Update `pipeline.yml`

**Modify:** `.buildkite/pipeline.yml`

Replace all steps with a single generator:
```yaml
steps:
  - label: ":pipeline: Generate Pipeline"
    command: bun .buildkite/generate-pipeline.ts | buildkite-agent pipeline upload
    image: "oven/bun:debian"
    plugins:
      - kubernetes:
          checkout:
            cloneFlags: --depth=1
            fetchFlags: --depth=1
```

No secrets or serviceAccountName — generator only uses git + bun.

## Step 7: Simplify existing scripts

**Modify:** `.buildkite/scripts/code-review.sh`, `code-review-interactive.sh`, `update-readmes.sh`

Replace duplicated 30-line setup with `source setup-dagger.sh`.

## Step 8: Delete `ci.sh`

**Delete:** `.buildkite/scripts/ci.sh`

Logic split between `generate-pipeline.ts` (versions-only detection) and `ci-main.sh` (dagger call).

## Generated Pipeline Structure

```
:pipeline: Generate Pipeline
  ├─ :white_check_mark: Compliance        (dagger call compliance-check)
  ├─ :shield: Quality & Security           (dagger call quality-checks)
  ├─ :iphone: Mobile CI                    (dagger call mobile-ci)
  ├─ :robot_face: Birmel Validation        (dagger call birmel-validation)
  ├─ :package: Package Validation          (dagger call package-validation)
  │
  ├─ :dagger: CI Pipeline                  (dagger call ci — depends_on all 5)
  ├─ :robot_face: Code Review              (PR only, soft_fail)
  └─ :books: Update READMEs               (main only, depends_on CI)
```

## Trade-offs

- **Setup overhead:** Each step is a separate K8s pod (~30-60s setup). Mitigable later with custom Docker image.
- **Sequential Tier 0:** Current `ci()` runs Tier 0 in background parallel with Tier 1. Now Tier 0 gates Tier 1. Total wall time increases but failures surface faster.
- **Cache duplication:** `ci()` re-runs Tier 0 internally but cache-hits everything from preceding steps (instant).
- **No Dagger code changes** beyond the one `complianceCheck` wrapper.

## Verification

1. Run `bun .buildkite/generate-pipeline.ts` locally to verify valid JSON output
2. Push on a PR branch, confirm Buildkite shows individual steps
3. Verify `concurrency_group` serializes steps (not concurrent)
4. Break a check, verify CI Pipeline step is skipped
5. In CI Pipeline logs, verify Tier 0 cache-hits (instant completion)
6. Test versions-only path with a `versions.ts`-only PR
