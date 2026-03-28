# Plan: CI Readiness — From Code to Green CI

## Context

Phases 2-4 of the Dagger migration are code-complete: Bazel nuked, Dagger module has 48 functions, TypeScript pipeline generator produces 56 steps, 35 tests pass. But CI has never run end-to-end. This plan covers every gap between "code exists" and "fully working CI."

## Comprehensive Audit Results

### What Works

- `dagger functions` loads all 48 functions
- Pipeline generator typechecks, 35 tests pass, produces valid JSON
- All quality scripts exist (`quality-ratchet.ts`, `compliance-check.sh`, `check-suppressions.ts`)
- All buildkite scripts exist (22 scripts in `.buildkite/scripts/`)
- All 28 helm chart directories exist with Chart.yaml
- `dagger.json` correctly at repo root pointing to `.dagger/` source
- `castle-casters/pom.xml` exists (Maven, not Gradle — correct)
- `resume/resume.tex` exists (LaTeX — correct)
- `versions.ts` exists for version commit-back

### What's Broken

**CRITICAL — Will fail immediately:**

1. **Ghost packages in ciAll()** — references 4 non-existent packages:
   - `cooklang-for-obsidian` (removed from monorepo entirely)
   - `sentinel` (moved to `poc/`)
   - `status-page/api` (moved to `poc/`)
   - `status-page/web` (moved to `poc/`)

2. **Ghost packages in catalog.ts** — same packages in ALL_PACKAGES, IMAGE_PUSH_TARGETS, PACKAGES_WITH_IMAGES, DEPLOY_SITES, HELM_CHARTS, DEPLOY_TARGETS, ASTRO_PACKAGES, PACKAGE_RESOURCES

3. **CI base image outdated** — `ci-base:402` has no Dagger CLI. Every pipeline step will fail.

4. **Dead cooklang functions** — `cooklangBuild`/`cooklangPush` in `.dagger/src/release.ts` reference `packages/cooklang-for-obsidian` which doesn't exist. The GitHub release repo `cooklang-obsidian-releases` also doesn't exist. These are dead code.

5. **Pipeline generator cooklang step** — `scripts/ci/src/steps/cooklang.ts` emits steps for a non-existent package. `cooklangChanged` flag in change detection tracks a package that doesn't exist.

**HIGH — Will fail on specific packages:**

6. **Missing packages in ciAll()** — these have lint/typecheck/test scripts but aren't tested:
   - `glance`, `tips`, `sjer.red`, `homelab`

7. **Helm push command mismatch** — Pipeline step passes `--chart-dir packages/homelab/charts` but the Dagger `helmPackage` function signature takes `chartName` (single chart name) and hardcodes the path `packages/homelab/src/cdk8s/helm/${chartName}`. The CLI command format doesn't match the function args.

8. **Pipeline generator emits steps for non-buildable packages** — ALL_PACKAGES includes `anki`, `docs`, `dotfiles`, `fonts`, `leetcode`, `macos-cross-compiler` which have no lint/typecheck/test scripts. Per-package steps will call `dagger call lint --source . --pkg anki` which will fail (no `lint` script in package.json).

**MEDIUM — Won't block initial CI but need fixing:**

9. **Unused change detection flags** — `castleCastersChanged` and `resumeChanged` defined but never used in `pipeline-builder.ts`

10. **Stale Bazel dotfiles** — `packages/dotfiles/` still has `dot_bazelrc.tmpl` and 3 Bazel skill dirs

11. **`buildImage()` is programmatic (not Dockerfile-based)** — This is by design (no Dockerfiles needed for most packages), but it means the image build quality depends entirely on the Dagger function logic. Packages with actual Dockerfiles (starlight-karma-bot, homelab/ha, homelab/dns-audit, homelab/deps-email, homelab/caddy-s3proxy) may need different handling.

---

## Step 1: Remove Dead Code & Fix Ghost References

### `.dagger/src/index.ts`

**ciAll() tsPackages array — remove:**

- `"cooklang-for-obsidian"`
- `"sentinel"`
- `"status-page/api"`
- `"status-page/web"`

**ciAll() tsPackages array — add:**

- `"glance"`
- `"tips"`
- `"sjer.red"`
- `"homelab"`

**Remove cooklang wrapper functions** (or update to cooklang-rich-preview if still needed):

- `cooklangBuild()` — references non-existent package
- `cooklangPush()` — references non-existent repo
- Remove imports of `cooklangBuildHelper`, `cooklangPushHelper`

### `.dagger/src/release.ts`

**Remove dead functions:**

- `cooklangBuildHelper()` (line 245) — references `packages/cooklang-for-obsidian`
- `cooklangPushHelper()` (line 264) — references `cooklang-for-obsidian` GitHub repo

### `scripts/ci/src/catalog.ts`

**ALL_PACKAGES — remove:** `cooklang-for-obsidian`, `sentinel`, `status-page`
**Also remove non-buildable packages that have no lint/typecheck/test:**

- `anki`, `docs`, `dotfiles`, `fonts`, `leetcode`, `macos-cross-compiler`

**PACKAGES_WITH_IMAGES — remove:** `sentinel`, `status-page`
**IMAGE_PUSH_TARGETS — remove:** sentinel, status-page-api entries
**ASTRO_PACKAGES — remove:** `status-page`
**PACKAGE_RESOURCES — remove:** `sentinel`
**DEPLOY_SITES — remove:** status-page entry
**HELM_CHARTS — remove:** `sentinel`, `status-page` (K8s infra stays in homelab, just no CI for these)
**DEPLOY_TARGETS — remove:** sentinel, status-page entries

### `scripts/ci/src/steps/cooklang.ts`

Delete this file — cooklang-for-obsidian no longer exists.

### `scripts/ci/src/pipeline-builder.ts`

Remove cooklang release group logic (lines 112-114). Remove `cooklangChanged` usage.

### `scripts/ci/src/lib/types.ts`

Remove `cooklangChanged` from AffectedPackages interface.

### `scripts/ci/src/change-detection.ts`

Remove `cooklangChanged` from return values.

---

## Step 2: Fix Pipeline Generator Correctness

### Helm push command format

The pipeline step emits:

```
dagger call helm-package --source . --chart-dir packages/homelab/charts --chart-museum-password env:CHARTMUSEUM_PASSWORD
```

But the Dagger function signature is:

```typescript
helmPackage(
  source,
  chartName,
  version,
  chartMuseumUsername,
  chartMuseumPassword,
);
```

The function takes `chartName` (a single chart name like "birmel"), not a directory path. Need to fix either:

- **Option A:** Change pipeline to loop over HELM_CHARTS and call `dagger call helm-package --chart-name birmel` for each
- **Option B:** Change Dagger function to accept a directory and iterate

**Recommendation:** Option A — emit one `dagger call helm-package` per chart. This matches the `parallelism: HELM_CHARTS.length` already in the step.

### Per-package steps for non-buildable packages

Currently ALL_PACKAGES includes packages without lint/typecheck/test. When the pipeline generator processes them, it creates `dagger call lint --source . --pkg anki` which will fail because `anki` has no `lint` script.

**Fix:** Remove non-buildable packages from ALL_PACKAGES, OR add a SKIP_PACKAGES set and filter them in `perPackageSteps()`.

### Unused flags cleanup

Remove `castleCastersChanged` and `resumeChanged` from types and change-detection (or wire them up if they should gate special behavior).

---

## Step 3: Build & Push CI Base Image

1. Check current VERSION: `402`
2. Bump to `403`
3. Build: `docker build --platform linux/amd64 -t ghcr.io/shepherdjerred/ci-base:403 .buildkite/ci-image/`
4. Push: `docker push ghcr.io/shepherdjerred/ci-base:403`
5. Update `pipeline.yml` image tag to `:403`
6. Update `k8s-plugin.ts` image tag to `:403`
7. Verify: `docker run --rm ghcr.io/shepherdjerred/ci-base:403 dagger version`

---

## Step 4: Local Dagger Validation — Every Function

Run each function category and fix all failures before pushing.

### Per-package (representative samples)

```bash
dagger call lint --source . --pkg webring
dagger call typecheck --source . --pkg webring
dagger call test --source . --pkg webring
dagger call lint --source . --pkg toolkit
dagger call lint --source . --pkg homelab
dagger call lint --source . --pkg glance
dagger call lint --source . --pkg sjer.red
```

### Astro

```bash
dagger call astro-check --source . --pkg sjer.red
dagger call astro-build --source . --pkg sjer.red
dagger call astro-check --source . --pkg cooklang-rich-preview
```

### Prisma packages

```bash
dagger call generate --source . --pkg birmel
dagger call lint-with-generated --generated $(dagger call generate --source . --pkg birmel) --pkg birmel
```

### Rust

```bash
dagger call rust-fmt --source .
dagger call rust-clippy --source .
dagger call rust-test --source .
dagger call cargo-deny --source .
```

### Go

```bash
dagger call go-build --source .
dagger call go-test --source .
dagger call go-lint --source .
```

### Java

```bash
dagger call maven-build --source .
dagger call maven-test --source .
```

### LaTeX

```bash
dagger call latex-build --source .
```

### Homelab

```bash
dagger call homelab-synth --source .
```

### Quality gates

```bash
dagger call prettier --source .
dagger call shellcheck --source .
dagger call quality-ratchet --source .
dagger call compliance-check --source .
dagger call knip-check --source .
dagger call gitleaks-check --source .
dagger call suppression-check --source .
```

### Security (soft_fail)

```bash
dagger call trivy-scan --source .
dagger call semgrep-scan --source .
```

### Swift

```bash
dagger call swift-lint --source .
```

### The monolith

```bash
dagger call ci-all --source .
```

Every failure must be fixed. No skipping.

---

## Step 5: Cache Performance Validation

After all functions pass:

### Cold cache baseline

```bash
# Clear Dagger cache
dagger cache prune

# Time a representative function
time dagger call lint --source . --pkg webring
time dagger call homelab-synth --source .
```

### Warm cache

```bash
# Run same commands again — should be fast
time dagger call lint --source . --pkg webring    # Target: < 5s
time dagger call homelab-synth --source .         # Target: < 10s
```

### Per-package isolation

```bash
# Touch one file in webring
echo "// test" >> packages/webring/src/index.ts

# Run lint — should rebuild webring but NOT re-install deps
time dagger call lint --source . --pkg webring

# Revert
git checkout packages/webring/src/index.ts
```

---

## Step 6: Pipeline Generator Final Verification

```bash
cd scripts/ci

# Typecheck
bun run typecheck

# Tests
bun test

# Full build — verify structure
FULL_BUILD=true bun run src/main.ts 2>/dev/null | jq '.steps | length'

# No ghost packages
FULL_BUILD=true bun run src/main.ts 2>/dev/null | grep -i "sentinel\|status-page\|cooklang-for-obsidian\|anki\|fonts\|dotfiles"
# Should return nothing

# Verify every dagger command in output is a real function
FULL_BUILD=true bun run src/main.ts 2>/dev/null | grep -o 'dagger call [a-z-]*' | sort -u
# Cross-reference with: dagger functions | awk '{print $1}'
```

---

## Step 7: Commit & First Buildkite Run

### Commit in logical groups

1. Ghost package cleanup (catalog, ciAll, pipeline generator)
2. Dead code removal (cooklang functions)
3. Pipeline generator fixes (helm command, per-package filtering)
4. CI base image version bump
5. Bazel dotfile cleanup

### Push to feature branch

```bash
git checkout -b ci/dagger-readiness
git push -u origin ci/dagger-readiness
```

### Open PR and monitor

1. "Generate Pipeline" step — does it produce valid JSON?
2. Per-package groups — do dagger calls succeed?
3. Quality gates — do they pass?
4. If on main: release steps — do they work?

### Expected CI-specific issues to fix iteratively

- Dagger engine connectivity (`_EXPERIMENTAL_DAGGER_RUNNER_HOST=tcp://dagger-engine.dagger.svc.cluster.local:8080`)
- K8s secrets not mounted correctly
- Git clone depth (100) insufficient for `git merge-base` in change detection
- Bun version mismatch between CI image (1.3.9) and Dagger containers (1.2.17)

---

## Step 8: Verify Per-Package Isolation on Real CI

After full build passes:

1. Make trivial change to one package (e.g. comment in `packages/webring/src/index.ts`)
2. Push — verify only webring group in generated pipeline (not 30 packages)
3. Verify build is fast (< 2 min total)

---

## Key Files to Modify

| File                                          | Changes                                                              |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `.dagger/src/index.ts`                        | Remove ghost packages from ciAll, add missing, remove cooklang funcs |
| `.dagger/src/release.ts`                      | Remove cooklangBuildHelper/cooklangPushHelper                        |
| `scripts/ci/src/catalog.ts`                   | Remove ghost + non-buildable packages from all lists                 |
| `scripts/ci/src/steps/cooklang.ts`            | Delete entirely                                                      |
| `scripts/ci/src/pipeline-builder.ts`          | Remove cooklang logic, fix helm step format                          |
| `scripts/ci/src/steps/helm.ts`                | Fix helm-package command to match Dagger function                    |
| `scripts/ci/src/lib/types.ts`                 | Remove cooklangChanged, castleCastersChanged, resumeChanged          |
| `scripts/ci/src/change-detection.ts`          | Remove dead flags                                                    |
| `scripts/ci/src/lib/k8s-plugin.ts`            | Update image tag to :403                                             |
| `.buildkite/ci-image/VERSION`                 | 402 → 403                                                            |
| `.buildkite/pipeline.yml`                     | Update image tag after push                                          |
| `packages/dotfiles/dot_bazelrc.tmpl`          | Delete                                                               |
| `packages/dotfiles/dot_claude/skills/bazel-*` | Delete 3 dirs                                                        |

## Definition of Done

1. **Every `dagger call` function exits 0 locally** — all 48 functions tested, all pass
2. **`dagger call ci-all --source .` exits 0** — the monolith works
3. **Warm cache < 5s** for lint/typecheck/test on unchanged package
4. **Per-package isolation** — touch one file, only that package rebuilds
5. **Pipeline generator clean** — no ghost packages, typecheck passes, 35+ tests pass
6. **CI base image pushed** with Dagger CLI
7. **Buildkite generates pipeline** — "Generate Pipeline" step succeeds
8. **Full CI run passes** on Buildkite (all per-package, quality, and security steps green)
9. **Per-package isolation on CI** — single-package change → only that package in pipeline
10. **Release pipeline validated** — on main: images push, helm charts push, ArgoCD syncs, npm publishes (at least dry-run verified)
