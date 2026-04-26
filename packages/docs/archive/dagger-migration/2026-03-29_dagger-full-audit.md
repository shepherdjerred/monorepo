# Dagger CI/CD Full Audit

**Date:** 2026-03-29
**Scope:** Every line of Dagger code in the monorepo (34 files, ~5000 lines)

## Context

The Dagger setup was built incrementally with many hacks: silent error swallowing via `|| true`, dead code, duplicated constants, overengineered abstractions, and skipped safety checks. This audit reads every line and catalogs every issue.

## Files Audited

**Dagger module (8 files):** `dagger.json`, `.dagger/src/index.ts` (1507 lines), `deps.ts`, `release.ts` (703 lines), `quality.ts`, `security.ts`, `java.ts`, `latex.ts`

**CI pipeline generator (19 files):** `pipeline-builder.ts`, `change-detection.ts`, `catalog.ts`, `lib/buildkite.ts`, `lib/k8s-plugin.ts`, `lib/types.ts`, `steps/per-package.ts`, `steps/quality.ts`, `steps/release.ts`, `steps/images.ts`, `steps/npm.ts`, `steps/sites.ts`, `steps/helm.ts`, `steps/tofu.ts`, `steps/argocd.ts`, `steps/clauderon.ts`, `steps/cooklang.ts`, `steps/version.ts`, `steps/code-review.ts`

**Scripts (5 files):** `simulate-ci.ts` (1053 lines), `quality-ratchet.ts`, `compliance-check.sh`, `check-suppressions.ts`, `validate-commit-msg.ts`

**Uncommitted changes:** `dryrun` params being added to release.ts helpers + pipeline-builder.ts removing `!dryrun` guards

---

## Findings Summary

| Tier | Category                           | Count  | Severity     |
| ---- | ---------------------------------- | ------ | ------------ |
| 1    | Correctness & Security Bugs        | 6      | **Critical** |
| 2    | Silent Failures (error swallowing) | 8      | **High**     |
| 3    | Dead Code & Duplication            | 8      | **Medium**   |
| 4    | Overengineering & Design           | 5      | **Low**      |
|      | **Total findings**                 | **27** |              |

---

## Tier 1: Correctness & Security (fix immediately)

These issues silently produce wrong behavior or leak secrets.

### 1.1 `bun install` silent fallback in `bunBase()`

- **File:** `.dagger/src/index.ts:159-165` (also lines 311, 344)
- **Hack:** `"bun install --frozen-lockfile 2>/dev/null || bun install"` silently falls back to non-frozen install, suppressing stderr with `2>/dev/null`
- **Why bad:** Hides lockfile drift. CI passes with dependencies that don't match the lockfile. Breaks reproducibility. The `2>/dev/null` hides the diagnostic output that would explain WHY the frozen install failed.
- **Fix:** `bun install --frozen-lockfile` with no fallback. If lockfile is stale, CI should fail. Same fix needed at 3 locations.

### 1.2 Production image skips lockfile enforcement

- **File:** `.dagger/src/index.ts:608`
- **Hack:** `bun install` (no `--frozen-lockfile`) for production OCI images
- **Why bad:** Two builds from the same commit can install different dependency versions. Production images are not reproducible.
- **Fix:** Add `--frozen-lockfile`.

### 1.3 NPM token written to disk

- **File:** `.dagger/src/release.ts:194`
- **Hack:** `echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" > ~/.npmrc` writes the token as a file inside the container
- **Why bad:** Token persists in Dagger layer cache. If the container is exported or cached, the token leaks. Dagger provides `withSecretVariable` for exactly this purpose.
- **Fix:** Use `bun publish --token $NPM_TOKEN` or Dagger secret-backed file via `withNewFile`.

### 1.4 Git token in clone URL

- **File:** `.dagger/src/release.ts:465`
- **Hack:** `git clone "https://x-access-token:$GH_TOKEN@github.com/..."` puts the token in the process argument list
- **Why bad:** Token visible in `ps` output, git config, and Dagger layer cache. Anyone with access to the container or process list sees it.
- **Fix:** Use `GIT_ASKPASS` environment variable or `git config credential.helper`.

### 1.5 `git add -A` stages everything in version commit-back

- **File:** `.dagger/src/release.ts:470`
- **Hack:** Blindly stages all files in the cloned repo
- **Why bad:** If any unexpected files exist (build artifacts, temp files), they get committed and pushed to a PR branch.
- **Fix:** `git add packages/homelab/src/cdk8s/src/versions.ts` — only stage the specific file being modified.

### 1.6 Site deploy CI flags don't match Dagger function params

- **File:** `scripts/ci/src/steps/sites.ts:23-32` vs `.dagger/src/index.ts:1339-1367`
- **Hack:** CI passes `--s3-bucket`, `--endpoint-url`, `--aws-access-key`, `--aws-secret-key`. Dagger function expects `--bucket`, `--target`, `--aws-access-key-id`, `--aws-secret-access-key`. The params `--dist-subdir` and `--target` are missing from CI entirely.
- **Why bad:** Interface contract between CI and Dagger is broken. Deploys are either silently failing or running with wrong params.
- **Fix:** Align CI flags with Dagger function kebab-cased parameter names. Remove `--endpoint-url` (derived from `target` inside the helper). Pass `--dist-subdir` and `--target`.

---

## Tier 2: Silent Failures (fix soon)

Every `|| true` below hides a failure mode. Each removal is a separate testable change.

### 2.1 `release-please || true`

- **File:** `.dagger/src/release.ts:571`
- **Hack:** `release-please release-pr ... || true` swallows all errors from release PR creation
- **Why bad:** If release-please fails due to auth issues, API errors, or misconfiguration, CI reports success. No signal that releases stopped working.
- **Fix:** Remove `|| true`. release-please exits 0 when there's nothing to do.

### 2.2 ArgoCD sync `|| true`

- **File:** `.dagger/src/release.ts:303`
- **Hack:** `curl -sf -X POST ... || true` swallows sync trigger failures
- **Why bad:** If ArgoCD is down or the token is invalid, deploys appear to succeed but nothing syncs. Cluster runs stale code.
- **Fix:** Remove `|| true`. If sync trigger fails, the step should fail.

### 2.3 Cooklang push `2>/dev/null || true`

- **File:** `.dagger/src/release.ts:399-400`
- **Hack:** Multiple error swallows in GitHub API calls for pushing cooklang artifacts
- **Why bad:** If the push fails, you have no artifacts in the target repo. Failures are invisible.
- **Fix:** Remove `2>/dev/null || true`. Handle specific expected conditions (e.g., file already exists) with explicit checks.

### 2.4 Cooklang release `|| echo "Release already exists"`

- **File:** `.dagger/src/release.ts:606`
- **Hack:** `gh release create ... || echo "Release already exists or no version"` catches ALL failure modes with a generic message
- **Why bad:** Auth failures, rate limits, and network errors all produce the same "release already exists" message.
- **Fix:** Check existence first with `gh release view`. If it exists, skip. If not, let `gh release create` fail naturally on error.

### 2.5 Knip `--no-exit-code`

- **File:** `.dagger/src/quality.ts:66`
- **Hack:** Knip runs with `--no-exit-code`, meaning it never fails the build regardless of findings
- **Why bad:** A quality gate that gates nothing. Output only visible if someone reads CI logs manually.
- **Fix:** Either remove `--no-exit-code` to make it a real gate, or remove knip entirely if nobody acts on its output.

### 2.6 Knip install triple fallback

- **File:** `.dagger/src/quality.ts:63-64`
- **Hack:** `(bun install --frozen-lockfile 2>/dev/null || bun install) || true` — three layers of error suppression in a loop over all packages
- **Why bad:** If ANY package fails to install, the error is silently ignored. Knip runs against an incomplete workspace, producing misleading results.
- **Fix:** `bun install --frozen-lockfile` with no fallback. Remove outer `|| true`.

### 2.7 Version fallback to "dev"

- **Files:** `scripts/ci/src/steps/clauderon.ts:50`, `scripts/ci/src/steps/cooklang.ts:43`
- **Hack:** `buildkite-agent meta-data get VERSION || echo dev` falls back to "dev" if metadata is missing
- **Why bad:** Production binaries could be uploaded to a GitHub release tagged "dev" instead of a real version. Data integrity issue.
- **Fix:** Fail if version metadata is missing. A prior step should always set it.

### 2.8 Retry config is dead code

- **File:** `scripts/ci/src/lib/buildkite.ts:10-18`
- **Hack:** Every exit code has `limit: 0` — no retries will ever happen. Config exists but does nothing.
- **Fix:** Either set meaningful retry limits (e.g., `limit: 2` for transient failures) or delete the RETRY constant entirely.

---

## Tier 3: Dead Code & Duplication (clean up)

### 3.1 Dead `*WithGenerated` methods

- **File:** `.dagger/src/index.ts:300-368`
- `lintWithGenerated`, `typecheckWithGenerated`, `testWithGenerated`, `generatedBase` — 4 methods, never called from CI or any other code
- The Prisma workflow uses `generateAndLint`, `generateAndTypecheck`, `generateAndTest` instead
- **Fix:** Delete all four methods.

### 3.2 Dead `generate` method

- **File:** `.dagger/src/index.ts:282-297`
- Returns a `Directory` but is never called from CI. The `generateAnd*` methods handle generation internally.
- **Fix:** Delete.

### 3.3 `SOURCE_EXCLUDES` duplicated 4 times

- **Files:** `index.ts:67`, `release.ts:14`, `quality.ts:16`, `security.ts:14`
- Identical constant defined in 4 files. When excludes need updating, all 4 must change in sync.
- **Fix:** Create `.dagger/src/constants.ts`, export once, import everywhere.

### 3.4 `BUN_IMAGE` and `BUN_CACHE` duplicated 3 times

- **Files:** `index.ts:52/85`, `release.ts:32-33`, `quality.ts:9/14`
- Same image tag and cache key in 3 files. When Bun version bumps, all 3 must update.
- **Fix:** Move to shared constants file from 3.3.

### 3.5 `simulate-ci.ts` is 1053 lines of stale code

- **File:** `scripts/simulate-ci.ts`
- References pipeline stages that no longer exist: `bun-install-deps`, `bun-install-source`, `typeshare`, `web-build`, `monorepo-build`. Models an old monolithic pipeline, not the current per-package Dagger architecture.
- **Fix:** Delete entirely. Stale simulations are worse than no simulation.

### 3.6 Resource tiers are all identical

- **File:** `scripts/ci/src/catalog.ts:237-239`
- `HEAVY = MEDIUM = LIGHT = { cpu: "250m", memory: "512Mi" }`. Three constants with the exact same value pretending to be different tiers. Cargo-culted configuration.
- **Fix:** Either differentiate (e.g., HEAVY: 1000m/2Gi, MEDIUM: 500m/1Gi, LIGHT: 250m/512Mi) or collapse to a single `DEFAULT_RESOURCES`.

### 3.7 Cooklang build runs 3 times

- **File:** `scripts/ci/src/steps/cooklang.ts:21,32,43`
- The build step runs `dagger call cooklang-build`. The push step embeds `$(dagger call cooklang-build ...)`. The release step also embeds `$(dagger call cooklang-build ...)`. Three separate Dagger invocations for the same build.
- **Fix:** Run build once, pass artifacts to subsequent steps via Buildkite artifacts or Dagger output references.

### 3.8 `playwrightTest` and `playwrightUpdate` duplicate ~60 lines

- **File:** `.dagger/src/index.ts` (both methods, lines ~780-913)
- Identical container setup: apt-get install, bun install via curl, dep mounting, dep building, frozen lockfile install.
- **Fix:** Extract `playwrightBase()` private method that returns the configured container.

---

## Tier 4: Overengineering & Design (refactor)

### 4.1 `ciAll()` hardcodes package lists

- **File:** `.dagger/src/index.ts:964-1193`
- 230-line method with a hardcoded `tsPackages` array that duplicates what `WORKSPACE_DEPS` in deps.ts already knows. When packages are added/removed, this list silently becomes stale.
- **Fix:** Derive the package list from `WORKSPACE_DEPS` or workspace configuration.

### 4.2 `WORKSPACE_DEPS` duplicates `package.json` workspace deps

- **File:** `.dagger/src/deps.ts`
- Manual map that should be derivable from `package.json` files. `change-detection.ts` already has `readWorkspaceDeps()` that does exactly this.
- **Fix:** Generate `deps.ts` from workspace `package.json` files, or read them at runtime.

### 4.3 `deploySite` has 12 positional parameters

- **File:** `.dagger/src/index.ts:1339-1367`
- 12 positional parameters make the function impossible to call correctly without reading the source.
- **Fix:** Group related params into structured types (credentials, deploy config).

### 4.4 Inconsistent dep mounting patterns

- `bunBase` takes parallel `depNames[]`/`depDirs[]` arrays. `helmPackageHelper` takes `source: Directory` (full repo). No consistent API.
- **Fix:** Standardize on one pattern. The parallel arrays are error-prone (must be same length, order matters).

### 4.5 `cooklangBuild` marked `cache: "never"` but is a pure build

- **File:** `.dagger/src/index.ts:1399`
- A pure build function with no side effects is marked uncacheable. This also exacerbates finding 3.7 (build running 3 times).
- **Fix:** Remove `cache: "never"` so Dagger can cache the result.

---

## Implementation Sequence

| Phase | Scope                                                                                               | Risk   |
| ----- | --------------------------------------------------------------------------------------------------- | ------ |
| 1     | Fix correctness/security: lockfile enforcement, token handling, `git add`, flag mismatch            | High   |
| 2     | Remove all `\|\| true` error swallowing, fix knip, version fallback, retry config                   | Medium |
| 3     | Delete dead code, create shared constants, delete stale `simulate-ci.ts`, fix cooklang triple-build | Low    |
| 4     | Refactor `ciAll()`, `deploySite`, dep mounting patterns                                             | Low    |

## Verification

After each phase:

1. `dagger functions` — all functions listed without error
2. `dagger call lint --pkg-dir ./packages/webring --pkg webring --tsconfig ./tsconfig.base.json` — works
3. Pipeline generator produces valid YAML: `cd scripts/ci && bun run src/index.ts`
4. For Tier 1: verify `bun install --frozen-lockfile` fails correctly when lockfile is stale
5. For Tier 2: verify `|| true` removal doesn't break happy path (release-please exits 0 when nothing to do, etc.)
