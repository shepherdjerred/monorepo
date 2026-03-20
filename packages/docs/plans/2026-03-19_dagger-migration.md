# Plan: Replace Bazel with Dagger for CI

## Context

Bazel is causing OOMs, slow startup, and pain with Astro/Vite builds across the monorepo (~40 packages, 67 BUILD.bazel files). The previous Dagger-based CI was abandoned after PagerDuty Incident #3042 (10 concurrent BuildKite sessions overwhelmed a single Dagger engine — 202 GB writes, load 587 on 32 cores). However:

1. The proposed mitigations (serialization, ZFS tuning) were **never tried**
2. **Kueue** now handles job admission control, preventing the concurrent overload scenario
3. The root cause of slow Dagger caching has been identified (see below)

**Goal:** Drop Bazel entirely. Use Dagger for hermetic CI execution, BuildKite for orchestration, with dynamic pipeline generation.

---

## Root Cause Analysis: Why Dagger Was Slow

The old Dagger module (deleted in commit `8542233b`) had architectural cache problems beyond the concurrency incident:

### 1. Overly broad source contexts
The module passed the full monorepo as `source: Directory`, then extracted subdirectories inside the function. BuildKit transferred and checksummed the **entire repo** — any file change anywhere invalidated the source layer and cascaded downstream. GitHub issue [#3705](https://github.com/dagger/dagger/issues/3705) confirms: `Host().Workdir().Directory("subdir")` sends the entire workdir; only `Host().Directory("subdir")` sends just the subdirectory.

### 2. No exclusion patterns
`.git/`, `node_modules/`, `dist/`, build outputs were included in the context transfer. The homelab cdk8s workspace alone contains 16 MB of generated CRD imports + 18 MB of generated Helm types.

### 3. Double `bun install`
The 4-phase workspace setup ran `bun install` twice: once after lockfile copy, once after source mount (because mounts replaced the symlinks Phase 2 created). Each install is a full workspace resolution.

### 4. Version-keyed cache volumes
Cache volumes like `mise-tools-bun{v}-python{v}-node{v}` were keyed by version strings. Any Renovate bump created a completely cold cache.

### 5. Monolithic single invocation
Everything ran as one `dagger call ci` — no per-package BuildKite steps, no parallelism beyond Dagger's internal DAG. When the engine was under load, everything slowed down together.

### Mitigations for the new design:
- Pass **narrowest possible directory** per function (just the package, not monorepo root)
- Use `+ignore` annotations or explicit excludes for `.git`, `node_modules`, `dist`
- Single `bun install` with lockfile-based caching, no double-install
- Stable cache volume names (not version-keyed)
- Per-package BuildKite steps, not monolithic invocation
- Kueue limits concurrent engine access

---

## Architecture

### Overview

```
pipeline.yml
  └─ Generate Pipeline step (lightweight, no Dagger)
       └─ TypeScript generator script
            ├─ git diff → changed files → affected packages
            ├─ dependency graph (from package.json workspaces)
            ├─ emits BuildKite pipeline JSON
            └─ buildkite-agent pipeline upload
                 ├─ Step: dagger call lint-package --name=foo --source=./packages/foo
                 ├─ Step: dagger call test-package --name=foo --source=./packages/foo
                 ├─ Step: dagger call build-image --name=birmel --source=./packages/birmel
                 ├─ Step: dagger call homelab-synth --source=./packages/homelab
                 └─ ... (gated by Kueue admission control)
```

### Three components:

1. **Dagger module** (`.dagger/`) — defines hermetic CI operations per package type
2. **Pipeline generator** (TypeScript) — change detection + BuildKite JSON emission
3. **Infrastructure** — Dagger engine DaemonSet on K8s node, ZFS tuning, Kueue

---

## Component 1: Dagger Module

### Package type → operations mapping

Based on analysis of all 67 BUILD.bazel files, there are 6 package types:

| Type | Packages | Operations |
|------|----------|------------|
| **Standard TS** | eslint-config, webring, tools, monarch, tasknotes-types, bun-decompile, astro-opengraph-images, hn-enhancer, cooklang-*, homelab/src/*, clauderon/web/*, scout-for-lol/packages/data\|report\|ui, discord-plays-pokemon/packages/* | lint, typecheck, test |
| **Bun service + OCI** | birmel, starlight-karma-bot, sentinel, tasknotes-server, status-page/api, scout-for-lol (root), discord-plays-pokemon (root) | lint, typecheck, test, image build, image push |
| **Astro site** | sjer.red, clauderon/docs, status-page/web, scout-for-lol/packages/frontend | lint, typecheck, astro check, astro build |
| **Vite/React** | better-skill-capped, clauderon/web/frontend | lint, typecheck, test, vite build |
| **Rust** | clauderon | fmt, clippy, test, build, coverage |
| **Go** | terraform-provider-asuswrt | build, lint, test |

Plus cross-cutting: prettier, shellcheck, quality gate (trivy, semgrep, knip), code review.

### Dagger functions to implement

```typescript
@object()
class CI {
  // Per-package operations (source is JUST the package directory, not monorepo root)
  @func() async lint(source: Directory, name: string): Promise<string>
  @func() async typecheck(source: Directory, name: string): Promise<string>
  @func() async test(source: Directory, name: string): Promise<string>
  @func() async astroBuild(source: Directory, name: string): Promise<Directory>
  @func() async viteBuild(source: Directory, name: string): Promise<Directory>
  @func() async astroCheck(source: Directory, name: string): Promise<string>

  // OCI image operations
  @func() async buildImage(source: Directory, name: string): Promise<Container>
  @func() async pushImage(source: Directory, name: string, tag: string): Promise<string>

  // Rust operations (clauderon)
  @func() async rustFmt(source: Directory): Promise<string>
  @func() async rustClippy(source: Directory): Promise<string>
  @func() async rustTest(source: Directory): Promise<string>
  @func() async rustBuild(source: Directory, target: string): Promise<File>

  // Homelab operations
  @func() async homelabSynth(source: Directory): Promise<Directory>  // cdk8s → YAML
  @func() async helmPackage(source: Directory, chart: string): Promise<File>
  @func() async helmPush(source: Directory, chart: string): Promise<string>
  @func() async tofuPlan(source: Directory, stack: string): Promise<string>
  @func() async tofuApply(source: Directory, stack: string): Promise<string>

  // Quality gates
  @func() async prettier(source: Directory): Promise<string>
  @func() async shellcheck(source: Directory): Promise<string>
  @func() async trivyScan(source: Directory): Promise<string>
  @func() async semgrepScan(source: Directory): Promise<string>

  // Release operations
  @func() async publishNpm(source: Directory, name: string): Promise<string>
  @func() async deploySite(source: Directory, name: string): Promise<string>
  @func() async argoCdSync(): Promise<string>
}
```

### Critical caching design

Each function receives **only its package directory** as source, not the monorepo root. This prevents cache invalidation cascade from unrelated changes.

For workspace dependencies (e.g., `tasknotes-server` needs `tasknotes-types`), the function receives multiple directory arguments or a structured input.

Container setup pattern (replaces the broken 4-phase approach):
```
1. FROM oven/bun:debian
2. COPY bun.lock package.json → container  (lockfile layer, cached unless lockfile changes)
3. RUN bun install                          (deps layer, cached on lockfile)
4. COPY src/ → container                    (source layer, only this package's files)
5. RUN bun test / eslint / tsc              (execution layer)
```

Use `withMountedCache("bun-cache", dag.cacheVolume("bun-install-cache"))` for the global bun cache. No version-keyed volume names.

---

## Component 2: Pipeline Generator

### Change detection (replaces target-determinator)

```typescript
// Pseudocode for the generator
const base = getBaseRevision()  // merge-base for PRs, last green build for main
const changedFiles = gitDiff(base, "HEAD")
const changedPackages = mapFilesToPackages(changedFiles)

// Infrastructure files → full build
if (changedFiles.some(f => INFRA_PATTERNS.test(f))) {
  changedPackages = ALL_PACKAGES
}

// Workspace dependency cascade
const graph = buildDependencyGraph()  // from package.json workspaces
const affectedPackages = transitiveClosureof(changedPackages, graph)
```

### Dependency graph (from research)

The graph is wide and shallow. Key cascade paths:
- `eslint-config` → 28 packages (but eslint-config rarely changes)
- `tasknotes-types` → `tasknotes-server`, `tasks-for-obsidian`
- `scout-for-lol/data` → `report`, `backend`, `frontend`, `desktop`, `ui`
- `homelab/src/helm-types` → `homelab/src/cdk8s`
- Everything else is a leaf

Infrastructure files that trigger full builds (keep from current generator):
- `bun.lock`, root `package.json`, root `tsconfig.json`
- `.buildkite/`, `scripts/ci/`
- `.dagger/` (the Dagger module itself)

### BuildKite pipeline structure

```
Generate Pipeline
  ├─ Per-package groups (only affected packages):
  │   ├─ lint (dagger call lint --source=./packages/foo --name=foo)
  │   ├─ typecheck (dagger call typecheck ...)
  │   └─ test (dagger call test ...)
  ├─ Quality gate: prettier, shellcheck, CI script tests
  ├─ Code review (PR only, soft_fail)
  │
  │ (main branch only, after wait gate):
  ├─ Release (release-please)
  ├─ Image pushes (parallel, per image)
  ├─ NPM publishes (parallel)
  ├─ Site deploys (parallel, depend on image pushes where applicable)
  ├─ Homelab track:
  │   ├─ Infra image pushes (parallel)
  │   ├─ cdk8s synth
  │   ├─ Helm chart pushes (parallel, 29 charts)
  │   ├─ Tofu stacks (parallel, 3 stacks)
  │   └─ ArgoCD sync → health check
  ├─ Clauderon cross-compile (x86_64, aarch64) → upload
  └─ Version commit-back
```

Each step gets Kueue-appropriate resource requests (not Bazel's HEAVY/MEDIUM/LIGHT tiers — Dagger operations are lighter since the engine does the heavy lifting).

### Metadata passing between steps

Current pipeline uses `buildkite-agent meta-data set/get` for image digests, release flags, etc. Keep this pattern — it's BuildKite-native and works well.

---

## Component 3: Infrastructure

### Dagger engine deployment

Re-deploy via official Helm chart as DaemonSet on the single K8s node:

```yaml
# Values for dagger-helm chart
engine:
  config:
    gc:
      maxUsedSpace: "600GB"
      reservedSpace: "100GB"
      minFreeSpace: "20%"
  persistence:
    storageClassName: "zfs-ssd-buildcache"  # new storage class
    size: "1Ti"
```

### ZFS storage class (from the never-implemented decision doc)

Create `zfs-ssd-buildcache` storage class:
- `compression=lz4` — ~2-3x write reduction, CPU-free at NVMe speeds
- `sync=disabled` — eliminates fsync overhead (cache is reproducible, no durability concern)
- `logbias=throughput` — prevents ZIL double-writes
- `atime=off` — eliminates read-triggered metadata writes

Estimated I/O reduction: **202 GB/hr → ~15-30 GB/hr** (from the decision doc analysis).

### BuildKite agent connection

Set in agent pod env:
```
_EXPERIMENTAL_DAGGER_RUNNER_HOST=tcp://dagger-engine.dagger.svc.cluster.local:8080
```

### Kueue

Already deployed. Controls how many BuildKite job pods run concurrently. This prevents the 10-concurrent-session scenario that caused the incident. No changes needed.

---

## Optional: SDK Instrumentation (not a fork)

The SDK research found that `Connection.setGQLClient()` is a **public API**. You can inject a recording proxy that captures every GraphQL query without forking the SDK:

```typescript
const recorder = new QueryRecorder(globalConnection.getGQLClient())
globalConnection.setGQLClient(recorder)
// Run pipeline code — non-terminal methods are synchronous, no engine needed
// Terminal methods are captured by the recorder
// Output: a DAG of operations → BuildKite JSON
```

This enables a "single source of truth" pattern: the Dagger module defines both local dev (`dagger call ci`) and CI (BuildKite steps generated from the same code). ~100-200 lines of instrumentation code.

**Caveat:** Breaks if pipeline code has control flow depending on execution results. Must structure pipeline code to avoid `if (await container.exitCode())` patterns.

**Recommendation:** Start with the explicit TypeScript generator (Component 2). Move to SDK instrumentation later if maintaining the step graph by hand becomes painful. The explicit generator is simpler, debuggable, and doesn't require understanding SDK internals.

---

## Migration Plan

### Phase 1: Infrastructure (no CI changes yet)

1. Create `zfs-ssd-buildcache` storage class in cdk8s
2. Deploy Dagger engine DaemonSet via Helm chart with new storage class
3. Apply `atime=off` to NVMe pool
4. Verify engine is accessible from a test pod

### Phase 2: Dagger module + spike

1. Create `.dagger/` module with functions for the simplest package type (standard TS: lint, typecheck, test)
2. Test against 2-3 packages locally and from a BuildKite agent pod
3. **Critical validation:** Run homelab synth twice — second run must be < 10 seconds
4. Measure disk I/O during runs (`iostat`)
5. If cache doesn't work → investigate before proceeding (see root cause analysis above)

### Phase 3: Full Dagger module

1. Implement all function types (Astro, Vite, Rust, Go, OCI image, Helm, Tofu, etc.)
2. Port the OCI image build pattern from `bun_service_image` (deps layer + src layer)
3. Port quality gates (prettier, shellcheck, trivy, semgrep)
4. Port release operations (npm publish, site deploy, ArgoCD sync)

### Phase 4: Pipeline generator

1. Write TypeScript generator with git-diff change detection + workspace dependency graph
2. Port infrastructure file detection from current Python generator
3. Port resource allocation, retry strategies, conditional steps (PR vs main)
4. Test: `bun .buildkite/generate-pipeline.ts | jq` produces valid BuildKite JSON

### Phase 5: Parallel run

1. Run both Bazel and Dagger pipelines for 1-2 weeks
2. Compare: wall-clock time, cache hit rates, failure modes, disk I/O
3. Fix issues discovered during parallel run

### Phase 6: Remove Bazel

1. Delete all 67 `BUILD.bazel` files
2. Delete `MODULE.bazel`, `.bazelrc`, `.bazelversion`
3. Delete `tools/rules_bun/`, `tools/oci/`, `tools/bazel/`
4. Remove Bazel/Bazelisk/target-determinator from CI base image
5. Remove Bazel-specific Python CI scripts
6. Update all `CLAUDE.md` files
7. Update `mise.toml` configurations

---

## Key Files

| File | Role |
|------|------|
| `packages/docs/decisions/2026-02-23_dagger-disk-write-amplification.md` | Mitigations to apply (ZFS tuning) |
| `packages/docs/plans/2026-02-22_buildkite.md` | Prior plan for this architecture |
| `scripts/ci/src/ci/pipeline_generator.py` | Current generator — port change detection logic |
| `scripts/ci/src/ci/lib/catalog.py` | Registry of images, sites, charts — reuse data |
| Old `.dagger/src/` (git: `8542233b~1`) | Previous Dagger module — learn from mistakes, reuse patterns |
| `tools/rules_bun/bun/private/` | Understand what each rule actually runs |

## Verification

1. **Phase 2 gate:** `dagger call test --source=./packages/webring --name=webring` works, second run < 5s
2. **Phase 2 gate:** `dagger call homelab-synth --source=./packages/homelab` works, second run < 10s
3. **Phase 2 gate:** `iostat` shows < 50 MB/s during single-session Dagger runs
4. **Phase 4:** `bun .buildkite/generate-pipeline.ts | jq` produces valid BuildKite JSON with correct `depends_on` graph
5. **Phase 5:** Full CI run on a PR branch shows per-package steps in BuildKite UI, all green
6. **Phase 6:** `which bazel` returns nothing in CI, all BUILD files deleted, CI still green
