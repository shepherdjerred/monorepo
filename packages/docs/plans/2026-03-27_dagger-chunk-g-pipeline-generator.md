# Chunk G: TypeScript Pipeline Generator

**Wave:** 3 (sequential — after D+E+F)
**Agent type:** Code agent, git worktree
**Touches:** `scripts/ci/` (NEW directory), `.buildkite/scripts/generate-pipeline.sh`
**Depends on:** Chunks D + E + F merged (all Dagger functions available)
**Blocks:** Nothing — this is the final chunk

## Goal

Build the TypeScript pipeline generator that replaces the deleted Python generator. It uses git-diff change detection, emits `dagger call` BuildKite steps, and includes failed-build retry logic. This is what makes CI green end-to-end.

## Context

- Load the `dagger-helper` skill before starting
- The old Python generator is deleted (Chunk A). Reference it from git history if needed: `git show 8542233b8~1:scripts/ci/src/ci/pipeline_generator.py`
- The old Python catalog is at: `git show 8542233b8~1:scripts/ci/src/ci/lib/catalog.py`
- All Dagger functions from Chunks B/D/E/F are available via `dagger call`
- Services at `*.sjer.red` are accessible via Cloudflare tunnel (public)
- Dagger engine at `tcp://dagger-engine.dagger.svc.cluster.local:8080`
- CI base image: `ghcr.io/shepherdjerred/ci-base:{version}` (updated in Chunk A with Dagger CLI)

## Directory Structure

```
scripts/ci/
  package.json              # bun project
  tsconfig.json
  src/
    main.ts                 # entry: detect changes -> build pipeline -> JSON stdout
    catalog.ts              # all targets, images, charts, sites, deploy mappings
    change-detection.ts     # git-diff + workspace dep graph + failed-build retry
    pipeline-builder.ts     # assembles BuildKite pipeline JSON
    steps/
      per-package.ts        # lint/typecheck/test per affected package
      quality.ts            # prettier, shellcheck, compliance, ratchet, knip, gitleaks
      release.ts            # release-please
      images.ts             # image build + push with digest metadata
      npm.ts                # npm publish
      sites.ts              # site deploy (S3/R2)
      helm.ts               # cdk8s synth + helm push (29 charts)
      tofu.ts               # tofu apply (3 stacks)
      argocd.ts             # sync + health check
      clauderon.ts          # rust build + upload
      cooklang.ts           # build + push
      version.ts            # commit-back
      code-review.ts        # Claude AI PR review (soft_fail)
    lib/
      buildkite.ts          # step/group types, metadata helpers
      k8s-plugin.ts         # K8s plugin config (resources, secrets, dagger engine)
      types.ts              # shared types
```

## Steps

### 1. Initialize project

```bash
mkdir -p scripts/ci/src/{steps,lib}
```

Create `package.json` (bun workspace member), `tsconfig.json`.

### 2. Port catalog (`src/catalog.ts`)

Port from the old Python catalog (reference git history). Include:
- `IMAGE_PUSH_TARGETS`: 9 app images + 4 infra images (13 total)
- `NPM_PACKAGES`: bun-decompile, astro-opengraph-images, webring, helm-types (4)
- `DEPLOY_SITES`: sjer.red, clauderon docs, resume, webring, cooklang-rich-preview, status-page, cook (7)
- `HELM_CHARTS`: 29 charts
- `TOFU_STACKS`: cloudflare, github, seaweedfs (3)
- `DEPLOY_TARGETS`: mapping of app → images + charts + ArgoCD apps
- `ALIASES`: tasks → tasknotes, scout → scout-beta/prod, karma → starlight-karma-bot-beta/prod
- `PACKAGE_RESOURCES`: Heavy (2/4Gi), Medium (1/2Gi), Light (500m/1Gi) per package

### 3. Implement change detection (`src/change-detection.ts`)

```typescript
interface AffectedPackages {
  packages: Set<string>
  buildAll: boolean
  homelabChanged: boolean
  clauderonChanged: boolean
  cooklangChanged: boolean
  castleCastersChanged: boolean
  resumeChanged: boolean
  hasImagePackages: Set<string>
  hasSitePackages: Set<string>
}
```

Logic:
1. **Base revision**: `git merge-base HEAD origin/main` for PRs. For main branch: query Buildkite API for last passed build's commit SHA.
2. **Changed files**: `git diff --name-only {base} HEAD`
3. **Infrastructure check**: if any of `bun.lock`, root `package.json`, `tsconfig.base.json`, `.buildkite/`, `.dagger/`, `scripts/ci/` changed → `buildAll = true`
4. **Map files to packages**: `packages/{name}/...` → package name
5. **Dependency graph**: read `package.json` from each workspace package, build dep graph, compute transitive closure of changed packages
6. **Feature flags**: set `homelabChanged`, `clauderonChanged`, etc. based on affected packages

**Failed-build retry:**
```typescript
async function getLastGreenCommit(branch: string): Promise<string | null> {
  // Query Buildkite API:
  // GET /v2/organizations/{org}/pipelines/{pipeline}/builds?branch={branch}&state=passed&per_page=1
  // Return commit SHA, or null if no green builds
}
```
When on main branch, use `getLastGreenCommit()` instead of merge-base. `git diff {lastGreen}..HEAD` naturally unions all consecutive failures.

### 4. Implement step generators (`src/steps/*.ts`)

Each module exports a function returning BuildKite step(s) as JSON objects.

**per-package.ts**: For each affected package, emit a group with lint/typecheck/test steps:
```typescript
{
  group: `:dagger: ${pkg}`,
  key: `pkg-${safeKey}`,
  steps: [
    { label: ":eslint: Lint", command: `dagger call lint --source . --pkg ${pkg}`, ... },
    { label: ":typescript: Typecheck", command: `dagger call typecheck --source . --pkg ${pkg}`, ... },
    { label: ":test_tube: Test", command: `dagger call test --source . --pkg ${pkg}`, ... },
  ]
}
```

Special handling for:
- Prisma packages (birmel, scout-for-lol, tasknotes-server): generate → lint/typecheck/test
- Astro sites: add astro-check and astro-build steps
- Rust: fmt, clippy, test, cargo-deny
- Go: build, test, lint
- Java: gradle-build, gradle-test
- LaTeX: latex-build

**images.ts**: Image push steps that capture digest metadata:
```bash
DIGEST=$(dagger call push-image --source . --pkg birmel --tag $TAG ...)
buildkite-agent meta-data set "digest:shepherdjerred/birmel" "$DIGEST"
```

**helm.ts**: 29 parallel steps (one per chart) using `parallelism` or individual steps.

### 5. Implement K8s plugin builder (`src/lib/k8s-plugin.ts`)

```typescript
function k8sPlugin(opts: { cpu?: string, memory?: string, secrets?: string[] }) {
  return {
    kubernetes: {
      checkout: { cloneFlags: "--depth=100 --dissociate", fetchFlags: "--depth=100" },
      podSpecPatch: {
        serviceAccountName: "buildkite-agent-stack-k8s-controller",
        containers: [{
          name: "container-0",
          image: CI_BASE_IMAGE,
          resources: { requests: { cpu: opts.cpu ?? "500m", memory: opts.memory ?? "1Gi" } },
          env: [{ name: "_EXPERIMENTAL_DAGGER_RUNNER_HOST", value: "tcp://dagger-engine.dagger.svc.cluster.local:8080" }],
          envFrom: [
            { secretRef: { name: "buildkite-ci-secrets" } },
            ...(opts.secrets ?? []).map(s => ({ secretRef: { name: s, optional: true } })),
          ],
        }],
      },
    },
  }
}
```

### 6. Implement pipeline builder (`src/pipeline-builder.ts`)

Assemble all steps based on `AffectedPackages`:
```
Per-package groups (affected only)
Quality gates (every build)
Security (soft_fail)
Code review (PR only, soft_fail)
--- wait (main only) ---
Release (release-please)
Image pushes (parallel, affected)
NPM publishes (parallel)
Site deploys (parallel, affected)
Clauderon + Cooklang + Castle Casters (if changed)
Homelab track (if changed): images → synth → helm (29x) → tofu (3x) → argocd → health
Version commit-back (if images pushed)
```

### 7. Implement entry point (`src/main.ts`)

```typescript
const affected = await detectChanges()
const pipeline = buildPipeline(affected)
console.log(JSON.stringify(pipeline))
```

### 8. Update `.buildkite/scripts/generate-pipeline.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
export DAGGER_NO_NAG=1 DAGGER_NO_UPDATE_CHECK=1
git fetch origin main --depth=100 2>/dev/null || true
cd scripts/ci && bun run src/main.ts | buildkite-agent pipeline upload
```

### 9. Write tests

- **Unit tests** (`src/__tests__/`):
  - Change detection with mock git output
  - Pipeline builder with known `AffectedPackages` inputs
  - K8s plugin config generation
- **Snapshot tests**:
  - Full build (infrastructure change)
  - Single-package change (e.g., only `packages/webring/`)
  - Homelab-only change
  - PR scenario (includes code review, no release steps)
- **Structural validation**:
  - All step keys are unique
  - All `depends_on` references exist
  - No dependency cycles

### 10. Verify

```bash
cd scripts/ci && bun install
cd scripts/ci && bun run src/main.ts | jq .       # valid JSON
cd scripts/ci && bun run src/main.ts | jq '.steps | length'  # reasonable number of steps
cd scripts/ci && bun test                           # all tests pass
```

## Definition of Done

- [ ] `scripts/ci/` is a working Bun project with TypeScript
- [ ] `catalog.ts` has all targets matching the old Python catalog
- [ ] Change detection: single-package change → only that package's steps emitted
- [ ] Infrastructure change → full build (all packages)
- [ ] Failed-build retry: diffs from last green build on main branch
- [ ] All 13 step generators produce valid BuildKite JSON
- [ ] `main.ts | jq` produces valid pipeline JSON
- [ ] `generate-pipeline.sh` calls the TS generator
- [ ] Unit tests pass for change detection and pipeline builder
- [ ] Snapshot tests cover: full build, single-package, homelab-only, PR
- [ ] Structural validation: unique keys, valid depends_on, no cycles
- [ ] Every `command` field uses `dagger call` (not `bazel`)
- [ ] K8s plugin config includes `_EXPERIMENTAL_DAGGER_RUNNER_HOST`

## Success Criteria

Push a commit to Buildkite → pipeline generates correctly → per-package steps appear in Buildkite UI → `dagger call` commands execute → CI is GREEN end-to-end. Change one package → only that package builds. Change homelab → only homelab track runs.
