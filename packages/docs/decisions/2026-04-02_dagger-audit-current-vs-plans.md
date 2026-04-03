# Dagger CI Audit: Current State vs Plans

## Context

The monorepo migrated CI from Bazel back to Dagger. Multiple planning docs (15 total in `packages/docs/`) laid out recommendations across code quality, feature restoration, and refactoring. This plan audits what was actually implemented vs what was planned, and proposes fixes for every gap.

**User goals:**
1. 100% feature set — lost capabilities restored
2. All code audit recommendations applied — no exceptions
3. Highest quality Dagger code — no hacks, no skips
4. Local development prioritized — Dagger as thin layer on top of local commands

---

## Audit: Code Quality Findings (27 items from `decisions/2026-03-29_dagger-full-audit.md`)

### Tier 1: Correctness & Security — 6/6 FIXED

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| 1.1 | `bun install` silent fallback | FIXED | `--frozen-lockfile` only, no fallback |
| 1.2 | Production image skips lockfile | FIXED | Uses `--frozen-lockfile` |
| 1.3 | NPM token written to disk | FIXED | `withSecretVariable` + `--token` flag |
| 1.4 | Git token in clone URL | FIXED | `GIT_ASKPASS` helper script (release.ts:496) |
| 1.5 | `git add -A` | FIXED | Stages specific file (release.ts:507) |
| 1.6 | Site deploy flag mismatch | FIXED | Flags aligned between CI and Dagger |

### Tier 2: Silent Failures — 6/8 FIXED, 2 REMAINING

| # | Finding | Status | Location |
|---|---------|--------|----------|
| 2.1 | release-please `\|\| true` | FIXED | Now `&&` chaining (release.ts:631) |
| 2.2 | ArgoCD sync `\|\| true` | FIXED | `curl -sf` fails on HTTP errors (release.ts:316) |
| 2.3 | Cooklang push `2>/dev/null \|\| true` | **REMAINING** | release.ts:256 — playwright install |
| 2.4 | Cooklang release `\|\| echo` | ACCEPTABLE | release.ts:417 — SHA lookup fallback for first-time files |
| 2.5 | Knip `--no-exit-code` | FIXED | Removed |
| 2.6 | Knip install triple fallback | FIXED | Removed |
| 2.7 | Version fallback to "dev" | FIXED | No fallbacks, metadata assumed |
| 2.8 | Retry config dead code | FIXED | Actual limits: exit -1→2, exit 34→2, exit 255→2 |

**Remaining:** `release.ts:256` — `bunx playwright install chromium --with-deps 2>/dev/null || true`. This is banned by the dagger-hygiene check's allowlist. The playwright install should either succeed or fail the step.

### Tier 3: Dead Code & Duplication — 7/8 FIXED, 1 REMAINING

| # | Finding | Status |
|---|---------|--------|
| 3.1 | Dead `*WithGenerated` methods | FIXED — deleted |
| 3.2 | Dead `generate` method | FIXED — deleted |
| 3.3 | `SOURCE_EXCLUDES` duplicated 4x | FIXED — centralized in constants.ts |
| 3.4 | `BUN_IMAGE`/`BUN_CACHE` duplicated 3x | FIXED — centralized |
| 3.5 | `simulate-ci.ts` stale code | FIXED — deleted |
| 3.6 | Resource tiers all identical | FIXED — HEAVY(1000m/2Gi), MEDIUM(500m/1Gi), LIGHT(250m/512Mi) |
| 3.7 | Cooklang build runs 3 times | **REMAINING** — `cooklangBuildAndPush` and `cooklangBuildAndRelease` each call `this.cooklangBuild()` separately |
| 3.8 | playwright duplicate ~60 lines | FIXED — `playwrightBase()` extracted |

### Tier 4: Overengineering — 2/5 FIXED, 3 REMAINING

| # | Finding | Status |
|---|---------|--------|
| 4.1 | ciAll hardcodes package lists | FIXED — reads from `WORKSPACE_DEPS` |
| 4.2 | WORKSPACE_DEPS duplicates package.json | **REMAINING** — still manually maintained in deps.ts |
| 4.3 | deploySite 12 positional params | **REMAINING** — still many params, though uses named kebab-case args |
| 4.4 | Inconsistent dep mounting | Acceptable — `pkgDir`+`depNames`+`depDirs` pattern is consistent for Bun packages |
| 4.5 | cooklangBuild `cache: "never"` | FIXED — now default cache |

---

## Audit: Lost Features (from `2026-03-29_dagger-ci-three-era-audit.md`)

### Restored

| Feature | Status |
|---------|--------|
| HA type generation | RESTORED — `haGenerate`, `haLint`, `haTypecheck` |
| Parallel result aggregation | RESTORED — ciAll properly collects/reports |
| Error capture | RESTORED — full error messages, no truncation |
| Orchestrated validation | REPLACED — pipeline generator handles this |
| ArgoCD health waiting | NEW — `argoCdHealthWait` polls for health |
| OpenTofu apply | NEW — `tofuApply` for 3 stacks |

### Still Lost — Safety-Critical

| Feature | Risk | Recommendation |
|---------|------|----------------|
| **CDK8s validation** (typecheck/lint/test) | HIGH — manifests deployed without validation | Add cdk8s typecheck/lint/test before Helm packaging |
| **Tofu drift detection** (plan before apply) | HIGH — infra changes without knowing what will change | Add `tofuPlan` function, run before apply on PRs |
| **Smoke tests** for pushed images | MEDIUM — images pushed without any verification they start | Add container startup smoke test |
| **eslint-config rebuilt N times** | LOW — wasted compute, not correctness | Build once, mount dist everywhere |

### Still Lost — Now Scheduled for Restoration

| Feature | Current State | What Exists | What's Missing |
|---------|--------------|-------------|----------------|
| **Frontend deployments** | NOT DEPLOYED | scout-for-lol/frontend has `astro build`, better-skill-capped has `vite build` | No DEPLOY_SITES entries, no S3 buckets |
| **Docs deployments** | PARTIAL | discord-plays-pokemon has full MkDocs Material config (`docs/mkdocs.yml`), webring TypeDoc IS deployed | MkDocs build/deploy step not in pipeline |
| **Coverage reporting** | CONFIGURED | castle-casters pom.xml has JaCoCo 0.8.14 + Coveralls 4.3.0 + Checkstyle + SpotBugs | No CI step to run coverage or publish |
| **Timing/observability** | MINIMAL | ArgoCD health wait has shell-based elapsed logging | No structured timing, no duration tracking per Dagger function |
| **Caddyfile validation** | SCRIPT ONLY | `packages/homelab/src/cdk8s/scripts/generate-caddyfile.ts` generates from code | No `caddy validate` or `caddy fmt --check` step in CI |

### Still Lost — Deferred (not restoring now)

| Feature | Notes |
|---------|-------|
| Desktop/Tauri builds | scout-for-lol desktop code exists but untested |
| Clauderon macOS binaries | Only Linux targets now (x86_64, aarch64) |
| macOS cross-compiler | In SKIP_PACKAGES |

---

## New Issues Found in This Audit

| # | Issue | File | Severity |
|---|-------|------|----------|
| N1 | `shellcheck-alpine:stable` floating tag | index.ts:812 | HIGH — non-reproducible |
| N2 | `MAVEN_IMAGE`, `TEXLIVE_IMAGE` not in constants.ts | java.ts, latex.ts | LOW — only used locally |
| N3 | `DRYRUN=true` hardcoded | generate-pipeline.sh:9 | BLOCKER — all deploys disabled |
| N4 | `golangci-lint@latest` installed at runtime | index.ts:945 | MEDIUM — floating version |
| N5 | `gh` CLI version hardcoded inline | release.ts:654 | LOW — no Renovate annotation |
| N6 | index.ts is 1,416 lines | .dagger/src/index.ts | MEDIUM — refactoring not done |
| N7 | Zero tests for Dagger module | .dagger/src/ | MEDIUM — no regression protection |
| N8 | `cooklangCreateReleaseHelper` has hardcoded gh version | release.ts:654 | LOW |
| N9 | ciAll passes full monorepo `source` to `rustBase`/`goBase` | index.ts:900,933 | LOW — wide context but functional |

---

## Local-First Assessment

**Verdict: Dagger IS a thin layer.** All packages have local scripts:
- `bun run lint` → `eslint`
- `bun run typecheck` → `tsc --noEmit`  
- `bun run test` → `bun test`
- `cargo clippy/test/fmt` → native cargo
- `mvn test` → native Maven

Dagger adds: hermetic containers, caching, dependency mounting, Buildkite integration.

**Gaps in local-first design:**

| Gap | Issue |
|-----|-------|
| `packages/resume` | All local scripts are `true` no-ops — LaTeX only builds in CI |
| Security scanning | trivy, semgrep, gitleaks are CI-only — no local equivalents |
| CDK8s validation | No local `bun run typecheck` for cdk8s code before synth |

---

## Implementation Plan

### Phase 1: Fix remaining hacks (code quality)

**1a. Pin floating image tags**
- `index.ts:812`: Replace `koalaman/shellcheck-alpine:stable` with pinned version + Renovate comment
- `index.ts:945`: Pin `golangci-lint` version instead of `@latest`
- `release.ts:654`: Move `gh` CLI version to constants.ts with Renovate comment

**1b. Fix playwright install error swallowing**
- `release.ts:256`: Replace `2>/dev/null || true` with a proper conditional:
  - Check if the site needs Playwright (only sjer.red does)
  - If needed, install without error suppression
  - If the site doesn't need it, skip entirely

**1c. Consolidate remaining constants**
- Move `MAVEN_IMAGE` from java.ts to constants.ts
- Move `TEXLIVE_IMAGE` from latex.ts to constants.ts
- Add `GOLANGCI_LINT_VERSION` and `GH_CLI_VERSION` to constants.ts

**1d. Fix cooklang double-build**
- `cooklangBuildAndPush` and `cooklangBuildAndRelease` each call `cooklangBuild()` separately
- Refactor so the build result is passed as input, not recomputed

**Files:** `.dagger/src/index.ts`, `.dagger/src/release.ts`, `.dagger/src/constants.ts`, `.dagger/src/java.ts`, `.dagger/src/latex.ts`

### Phase 2: Restore safety-critical lost features

**2a. CDK8s validation (typecheck/lint/test)**
- Add local scripts to `packages/homelab/src/cdk8s/package.json` for lint/typecheck/test
- Add `@func()` methods: `cdk8sLint`, `cdk8sTypecheck`, `cdk8sTest`
- Wire into pipeline generator: run validation before `homelabSynth`
- This catches manifest errors BEFORE they're packaged into Helm charts

**2b. Tofu plan (drift detection)**
- Add `@func()` `tofuPlan` that runs `tofu plan -input=false -detailed-exitcode`
- Exit code 2 = changes detected (not an error, just drift)
- Run on PRs that touch homelab to show what will change
- Keep `tofuApply` for main branch only

**2c. Smoke tests for pushed images**
- Add `@func()` `smokeTest(image: Container, healthPath?: string)` 
- Starts the container, waits for a health endpoint or successful startup, then exits
- Wire into pipeline generator: after `pushImage`, run smoke test before ArgoCD sync
- Start with birmel and tasknotes-server (have health endpoints)

**Files:** `.dagger/src/index.ts`, `.dagger/src/release.ts`, `scripts/ci/src/steps/per-package.ts`, `scripts/ci/src/steps/tofu.ts`, `scripts/ci/src/steps/images.ts`, `packages/homelab/src/cdk8s/package.json`

### Phase 3: Restore remaining lost features

**3a. Frontend deployments**
- Add `scout-frontend` to `DEPLOY_SITES` in catalog.ts
  - bucket: `scout-frontend`, buildDir: `packages/scout-for-lol/packages/frontend`
  - buildCmd: `bun run build` (astro build), distSubdir: `dist`
  - deps: eslint-config, scout-for-lol data/report packages
- Add `better-skill-capped` to `DEPLOY_SITES`
  - bucket: `better-skill-capped`, buildDir: `packages/better-skill-capped`
  - buildCmd: `vite build`, distSubdir: `dist`
- Create S3 buckets on SeaweedFS (or verify they exist)
- Wire into pipeline generator: deploy when package changes

**3b. Docs deployments**
- Add `discord-plays-pokemon-docs` to `DEPLOY_SITES`
  - bucket: `discord-plays-pokemon-docs`
  - buildCmd: needs `mkdocs build` (Python/uv) — add MkDocs build Dagger function
  - distSubdir: `site`
- Add `@func()` `mkdocsBuild(source: Directory)` in index.ts
  - Python container with `uv pip install mkdocs-material` + extensions
  - Runs `mkdocs build`
  - Returns built `site/` directory
- Webring TypeDoc is already deployed (confirmed in catalog)

**3c. Coverage reporting**
- Add `@func()` `mavenCoverage(pkgDir: Directory)` in java.ts
  - Runs `mvn verify` (triggers JaCoCo) instead of just `mvn test`
  - Exports coverage report from `target/site/jacoco/`
- Add coverage step to pipeline for castle-casters
  - Run after `mavenTest`, upload report as Buildkite artifact
- For TS packages: add `bun test --coverage` option (Bun has built-in coverage)
  - Not blocking, but wire into per-package steps as optional

**3d. Timing/observability**
- Add `withTiming()` wrapper function in a new `.dagger/src/timing.ts`
  - Wraps any container execution with `Date.now()` before/after
  - Logs `[TIMING] {label}: {duration}ms` to stdout
  - Returns the original result
- Apply to all Dagger helper functions in release.ts, quality.ts, security.ts
- Add Buildkite annotation step at end of pipeline that summarizes timings
- Future: emit OpenTelemetry spans (not in this phase)

**3e. Caddyfile validation**
- Add `@func()` `caddyfileValidate(source: Directory)` in index.ts
  - Container from pinned `caddy:2.9.1-alpine` image
  - Generate Caddyfile: `bun run packages/homelab/src/cdk8s/scripts/generate-caddyfile.ts > /tmp/Caddyfile`
  - Validate: `caddy validate --config /tmp/Caddyfile`
  - Also: `caddy fmt --check /tmp/Caddyfile` (formatting)
- Wire into pipeline: run when homelab changes, before Helm packaging
- Add local script to `packages/homelab/package.json`: `"validate-caddy": "bun run src/cdk8s/scripts/generate-caddyfile.ts | caddy validate --config -"`

**Files:** `scripts/ci/src/catalog.ts`, `scripts/ci/src/steps/sites.ts`, `.dagger/src/index.ts`, `.dagger/src/java.ts`, `.dagger/src/timing.ts` (new), `.dagger/src/constants.ts`, `packages/homelab/package.json`

### Phase 4: Refactor index.ts (1,416 → ~300 lines)

Follow the refactoring plan from `2026-03-27_dagger-refactoring-tests.md`:

**4a. Extract helper modules**
- `base.ts` — `bunBase()`, `rustBase()`, `goBase()` 
- `typescript.ts` — lint, typecheck, test, generate helpers
- `astro.ts` — astroCheck, astroBuild, viteBuild helpers
- `image.ts` — buildImage, pushImage helpers
- `rust.ts` — rustFmt, rustClippy, rustTest, rustBuild helpers
- `golang.ts` — goBuild, goTest, goLint helpers
- `homelab.ts` — homelabSynth, haGenerate helpers
- `swift.ts` — swiftLint helper
- `playwright.ts` — playwrightBase, playwrightTest, playwrightUpdate helpers
- `ci.ts` — ciAll orchestration + pure logic

**4b. index.ts becomes thin wrappers**
```typescript
@func()
async lint(pkgDir: Directory, pkg: string, ...): Promise<string> {
  return lintHelper(bunBase(pkgDir, pkg, ...), pkg).stdout();
}
```

**4c. Add tests**
- `__tests__/constants.test.ts` — all images pinned, no floating tags
- `__tests__/ci.test.ts` — summary formatting, failure detection
- `__tests__/base.test.ts` — workspace dep resolution

**Files:** All new files in `.dagger/src/`, modified `index.ts`

### Phase 5: Local-first improvements

**5a. Resume local build**
- Add a real `build` script to `packages/resume/package.json` that calls `xelatex`
- Requires texlive installed locally (or skip gracefully)

**5b. CDK8s local scripts**
- Ensure `packages/homelab/src/cdk8s/package.json` has lint/typecheck/test scripts
- These should be the same commands Dagger runs

**5c. WORKSPACE_DEPS generation**
- Write a script that reads workspace `package.json` files and generates `deps.ts`
- Run as part of CI validation to catch drift
- Or: read deps at runtime from package.json files (slower but always accurate)

### Phase 6: Enable production

**6a. Remove DRYRUN=true**
- `generate-pipeline.sh:9`: Remove `export DRYRUN=true`
- This enables all deploy/release operations
- Should be done AFTER all fixes are verified

### Phase 7: Save audit to docs

- Save this audit as `packages/docs/decisions/2026-04-02_dagger-audit-current-vs-plans.md`
- Update `packages/docs/index.md` with a link
- This replaces the older audit docs with a single current-state document

---

## Verification Strategy

### Per-Phase Gates

**Phase 1 (hacks):**
1. `dagger functions` — all functions listed
2. `grep -r "stable\|@latest" .dagger/src/` — zero floating tags
3. `grep -r '|| true\|2>/dev/null' .dagger/src/ | grep -v allowlist` — only the cooklang SHA lookup remains
4. `bun run typecheck` in `.dagger/` — no type errors

**Phase 2 (safety features):**
1. `dagger call cdk8s-lint --pkg-dir ./packages/homelab/src/cdk8s ...` — works
2. `dagger call tofu-plan --source . --stack cloudflare ...` — exits with plan output
3. `dagger call smoke-test ...` — starts and stops a container
4. `dagger call caddyfile-validate --source .` — validates generated Caddyfile

**Phase 3 (lost features):**
1. `cd scripts/ci && bun run src/main.ts | jq '.steps[] | select(.label | test("scout-frontend"))' ` — scout frontend deploy step exists
2. `cd scripts/ci && bun run src/main.ts | jq '.steps[] | select(.label | test("mkdocs"))' ` — docs deploy step exists
3. `dagger call maven-coverage --pkg-dir ./packages/castle-casters` — produces coverage report
4. `dagger call caddyfile-validate --source .` — passes

**Phase 4 (refactor):**
1. `wc -l .dagger/src/index.ts` — under 400 lines
2. `dagger functions` — identical function list as before refactor
3. `cd .dagger && bun test` — all tests pass
4. `dagger call lint --pkg-dir ./packages/webring --pkg webring --tsconfig ./tsconfig.base.json` — still works

**Phase 5 (local-first):**
1. `cd packages/resume && bun run build` — produces PDF (or skips gracefully)
2. `cd packages/homelab/src/cdk8s && bun run typecheck` — works
3. `bun run scripts/generate-deps.ts && git diff .dagger/src/deps.ts` — no drift

**Phase 6 (production):**
1. `grep DRYRUN .buildkite/scripts/generate-pipeline.sh` — no DRYRUN line
2. Push to PR branch — Buildkite shows all steps including deploy/release (in dryrun=false mode)

### Regression Check (run after every phase)

```bash
# Must always pass:
dagger functions                           # all functions listed
cd scripts/ci && bun run src/main.ts > /dev/null  # pipeline generates
bun run typecheck                          # monorepo-wide type check
```

### Quality Gate (run before final PR)

```bash
# The hygiene check enforces banned patterns:
bun run scripts/check-dagger-hygiene.ts    # no || true, 2>/dev/null, etc.
bun run scripts/quality-ratchet.ts         # suppression counts don't increase
bun run scripts/check-suppressions.ts      # no new suppressions
```

---

## Critical Files

| File | Lines | Role |
|------|-------|------|
| `.dagger/src/index.ts` | 1,416 | Main Dagger module (needs refactoring) |
| `.dagger/src/release.ts` | 767 | Release/deploy helpers |
| `.dagger/src/constants.ts` | 76 | Shared constants |
| `.dagger/src/deps.ts` | 53 | Manual workspace dep map |
| `.dagger/src/quality.ts` | 85 | Quality gate helpers |
| `.dagger/src/security.ts` | 43 | Security scan helpers |
| `.dagger/src/java.ts` | 49 | Maven helpers |
| `.dagger/src/latex.ts` | 22 | LaTeX helper |
| `scripts/ci/src/catalog.ts` | 396 | CI target registry |
| `scripts/ci/src/pipeline-builder.ts` | 191 | Pipeline assembly |
| `scripts/ci/src/change-detection.ts` | 373 | Git diff + dep graph |
| `.buildkite/scripts/generate-pipeline.sh` | 13 | Entry point (has DRYRUN=true) |
| `packages/homelab/src/cdk8s/scripts/generate-caddyfile.ts` | — | Caddyfile generator (validation target) |
| `packages/castle-casters/pom.xml` | — | JaCoCo/Coveralls configured |
| `packages/discord-plays-pokemon/docs/mkdocs.yml` | — | MkDocs Material config |
