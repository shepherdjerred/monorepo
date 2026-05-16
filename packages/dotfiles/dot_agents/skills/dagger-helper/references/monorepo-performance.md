# Dagger Monorepo Performance & Caching

## The --source . Problem

When passing `--source .` on `dagger call`, the CLI converts the local path `.` into a `Directory` object and uploads the entire tree to the engine via BuildKit's filesync protocol. For large monorepos, Dagger's docs describe this as "prohibitive cost." The `.git` directory alone can be larger than source code. With ~25+ projects, the CLI has been reported to freeze entirely (issue #9487).

Subsequent calls only upload changed files (incremental sync since v0.15), but any file change anywhere in the synced directory can invalidate caches for unrelated operations.

## Pre-Call Filtering (ignore Annotations)

Dagger does NOT have a `.daggerignore` file — the concept was explicitly rejected (issue #6155). Instead, use `ignore` annotations on `Directory`-typed function parameters. Filtering is applied BEFORE transfer — excluded files never leave the host.

Syntax uses `.gitignore` patterns. Order matters: `["*", "!packages/foo/**"]` excludes everything except `packages/foo`. The reverse order `["!packages/foo/**", "*"]` excludes everything.

Dagger does NOT auto-read `.dockerignore` or `.gitignore` (issue #6627 tracks this request).

### Pattern: defaultPath + ignore Allowlist

For per-package builds that need root-level config (tsconfig.json, eslint config):

```typescript
@func()
async build(
  @argument({
    defaultPath: "/",
    ignore: ["*", "!packages/foo/**", "!tsconfig.json",
             "!package.json", "!bun.lock"]
  })
  source: Directory,
): Promise<Container> { ... }
```

This uploads only `packages/foo/`, `tsconfig.json`, `package.json`, and `bun.lock`. Unrelated file changes won't invalidate the cache.

### Pattern: Multiple Directory Parameters

Accept separate `Directory`/`File` arguments for independent caching:

```typescript
@func()
async build(
  @argument({ defaultPath: "/packages/foo" }) pkgDir: Directory,
  @argument({ defaultPath: "/packages/shared" }) sharedDir: Directory,
  @argument({ defaultPath: "/tsconfig.json" }) tsconfig: File,
): Promise<Container> { ... }
```

Each is synced and cached independently. Combine inside the function with `withDirectory()`/`withFile()` chains (no native directory merge operation exists — issue #6476).

### Context Directory Resolution

For Git repositories: absolute paths (`defaultPath: "/"`) resolve from the repo root; relative paths (`defaultPath: "."`) resolve from the `dagger.json` directory. For non-Git directories, all paths resolve relative to `dagger.json`.

## dagger.json Filtering

The `include`/`exclude` fields in `dagger.json` only affect module loading — NOT directories passed as function arguments:

```json
{
  "name": "mymodule",
  "sdk": "typescript",
  "source": "./dagger",
  "include": ["tsconfig.json", "eslint.config.js"]
}
```

## Multi-Module Architecture

Dagger documents two patterns for monorepo module organization:

| Pattern                 | Best For                                   | Benefits                                                                  |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| Top-level + sub-modules | Heterogeneous repos (SDKs, CLIs, web apps) | Better cache granularity, easier debugging, code reuse across sub-modules |
| Single shared module    | Homogeneous repos (all microservices)      | Less duplication, lower onboarding friction, consistent CI environment    |

Dagger's layer cache means even if "unnecessary" CI jobs are triggered, most finish nearly instantly because the cache determines there's nothing to do.

## WithMountedDirectory Cache Caveat

`WithMountedDirectory`/`WithMountedFile` do NOT use content-based caching for `withExec` by default. BuildKit disables this to avoid expensive content checksum computation, except when the mount is non-root and read-only (issue #6421, PR #6211).

Prefer `WithDirectory` (copy) when cache correctness matters. Use `WithMountedDirectory` only for CI operations where the mounted files won't appear in the final image.

## Cache Debugging

### Introspection Commands

```bash
# List all cache entry metadata
dagger core engine local-cache entry-set entries

# High-level cache usage summary
dagger core engine local-cache entry-set

# Prune unused cache entries
dagger core engine local-cache prune

# Prune using configured GC policy
dagger core engine local-cache prune --use-default-policy
```

### Common Cache Miss Causes

1. **Disk pressure / GC eviction** — Limited disk causes repeated eviction. Running in a VM with 25GB can cause "random" failures (issue #10504)
2. **Module source changes** — Any change to module source invalidates ALL function cache for that module
3. **Ephemeral CI runners** — Empty cache each run without Dagger Cloud or persistent engine
4. **TTL doesn't guarantee retention** — GC can evict before TTL expires under disk pressure
5. **Secrets incompatibility** — Functions returning `SetSecret` references fall back to session-only caching
6. **WithMountedDirectory** — Doesn't use content-based caching for `withExec` (see above)

### Observability

- **Dagger TUI** — Shows cached vs freshly-executed steps with timing
- **Dagger Cloud Traces** — Browser-based cache hit/miss per step, timing, resource usage
- **OpenTelemetry** — All operations emit OTel traces (since v0.11.0); export to Jaeger, Honeycomb, etc.
- **Debug mode** — `dagger --debug` reveals detailed cache-related output
- **Engine logs** — `docker logs $(docker container list --all --filter 'name=^dagger-engine-*' --format '{{.Names}}')`

The Dagger team acknowledges cache miss debugging is "by far the trickiest problem" — no diff tooling yet for comparing cache key inputs between expected-hit and actual-miss runs (issue #8004).

## Remote Cache Options

### Dagger Cloud

Transparently syncs both layer cache and cache volumes across CI runners. Layer cache is pulled on-demand; cache volumes are downloaded at run start and uploaded at run end.

### Persistent Engine

Run the engine as a K8s DaemonSet or service. CI jobs connect via `_EXPERIMENTAL_DAGGER_RUNNER_HOST`. All jobs on the same node share the same local cache. This is what the monorepo currently uses.

### Registry Cache (Experimental)

```bash
export _EXPERIMENTAL_DAGGER_CACHE_CONFIG="type=registry,ref=registry.example.com/cache,mode=max"
```

Known bugs with private registries. S3 backend not yet available (planned via Storage Drivers, issue #8004). Cache volumes cannot be exported to registries — only layer cache.

## Function Cache TTL Migration

The `@func({ cache: "10m" })` syntax and default 7-day TTL were introduced in v0.19.4+. Modules initialized before v0.19.4 default to `"session"` caching and must explicitly opt-in to persistent caching by adding cache annotations.

## Dagger Shell (v0.20)

Dagger Shell is a bash-syntax frontend for the engine — the default entry point when running `dagger` with no arguments. It translates shell commands to Dagger API requests, enabling:

- Interactive debugging of pipeline steps without writing TypeScript module code
- Quick ad-hoc operations for testing cache behavior
- AI agent integration (designed for programmatic interaction)

## Dagger Checks (Managed CI)

Dagger Checks runs check functions on Dagger Cloud's managed infrastructure and reports results back to GitHub as commit statuses — no self-hosted runners required. Checks execute in parallel automatically. Requires Dagger Cloud; currently integrates with GitHub.

## Version Performance History

| Version | Key Performance Change                                            |
| ------- | ----------------------------------------------------------------- |
| v0.10   | Fixed re-transferring all files on every call                     |
| v0.12   | TUI rendering optimization (only renders visible region)          |
| v0.13   | Pre-call filtering for monorepos — "massive performance gains"    |
| v0.14   | Improved disk usage management                                    |
| v0.15   | Centralized filesync caching across sessions                      |
| v0.16   | General performance boost                                         |
| v0.19   | ~1s faster module init when cached; improved git implementation   |
| v0.20   | Reduced disk syncing and lock contention; Dagger Shell introduced |

## Case Studies (Vendor-Reported)

| Company   | Before → After | Notes                                                     |
| --------- | -------------- | --------------------------------------------------------- |
| Civo      | 30min → 5min   | Confounded with monorepo consolidation (40+ repos merged) |
| OpenMeter | 25min → 5min   | Caching + larger runners + Depot; 50% cost reduction      |
| Airbyte   | 2-5x faster    | 350+ connectors; 75% cost reduction via K8s auto-scaling  |

All case studies are from Dagger's blog or partner posts. No independent third-party benchmarks found.

## Pain Points at Scale

Known operational issues reported by practitioners:

- **CLI freezes** with ~25 projects in a monorepo — only recovery is closing the terminal (issue #9487)
- **600GB of volumes** after a day of development / 50-100 invocations (issue #8561)
- **~2.5GB in-use memory** from buildkit solver operations, marshaling, and gRPC buffers (issue #6719)
- **Cryptic error messages** — logs hidden or abstracted away; hours spent debugging trivial failures like `.dockerignore` misconfiguration
- **Module migration** steepened the learning curve — some developers felt "mostly alone" after the API change from client SDKs to modules
- **Production scaling** — "What is the best way to scale Dagger in production?" remains an open question (issue #6486)

## JS Runtime Comparison in Dagger

### pnpm

`pnpm fetch` downloads packages using only the lockfile (`pnpm-lock.yaml`) — no `package.json` needed. This is ideal for layer caching since the lockfile changes far less frequently than `package.json`. The pattern:

1. Copy `pnpm-lock.yaml` only
2. `pnpm fetch --frozen-lockfile` (populates store from lockfile)
3. Copy `package.json`
4. `pnpm install --frozen-lockfile --offline` (install from pre-fetched store, no network)

Bun lacks a `bun fetch` equivalent — `bun install` requires `package.json`, so metadata changes (scripts, version) can invalidate the install layer. The mitigation is cache volumes for `~/.bun/install/cache`.

pnpm was observed ~1.5x faster than npm/yarn at downloading dependencies in Dagger containers.

### Official Dagger Node Module

The Node module on Daggerverse (`github.com/dagger/dagger/sdk/typescript/dev/node`) provides `build()`, `test()`, `lint()`, `install()`, `withNpm()`, `withYarn()`, `withPnpm()`. It auto-creates cache volumes for dependencies.

### Deno

Supported as Dagger SDK runtime since v0.17.1. Auto-detected from `deno.json`/`deno.lock`. Deno requires no transpilation or `node_modules`, simplifying container builds. Least common in the Dagger ecosystem.

### SDK Runtime Summary

Three TypeScript SDK runtimes: Node.js (stable), Bun (experimental), Deno (experimental). Auto-detection: `package-lock.json`/`yarn.lock`/`pnpm-lock.yaml` → Node; `bun.lock`/`bun.lockb` → Bun; `deno.json`/`deno.lock` → Deno; fallback → Node.

The TypeScript SDK was bundled from ~155MB down to ~4.5MB, cutting cold starts 50% (20-30s → ~11s).

## Optimal Caching Strategy

Use all three caching layers together for maximum performance:

1. **Pre-call filtering** (`ignore` annotations) — prevent unrelated file changes from invalidating caches
2. **Layer cache** via two-phase install — lockfile + package.json first, `bun install`, then source code
3. **Cache volumes** (`WithMountedCache`) — mount `~/.bun/install/cache` so even on layer miss, the package manager does incremental work
4. **Persistent engine** (K8s DaemonSet/Service) or Dagger Cloud — preserve cache across CI runs

Layer cache hit = zero work (fastest). Cache volume hit with layer miss = partial work (package manager only downloads the diff). Both missing = full reinstall from scratch (slowest).
