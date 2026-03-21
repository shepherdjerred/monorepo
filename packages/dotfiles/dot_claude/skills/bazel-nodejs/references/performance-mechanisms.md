# JS-Specific Performance Mechanisms in rules_js

## Benchmark Data

The following benchmarks are from Aspect Build (the rules_js vendor) circa 2022, run on Kibana's ~3750-package dependency tree using a 2019 MacBook Pro with pnpm 7.x, npm 8.x, and yarn 1.x. Current tool versions may perform differently -- pnpm in particular has made substantial improvements in v8/v9.

### Full Fetch + Link (cold cache)

| Tool | Time |
|------|------|
| rules_js (`npm_translate_lock`) | 73s |
| pnpm 7 | 78s |
| npm 8 | 90s |
| yarn 1 | 92s |
| `npm_install` (rules_nodejs) | 101s |
| `yarn_install` (rules_nodejs) | 104s |

### Link with Warm Cache

| Tool | Time |
|------|------|
| pnpm 7 | 28s |
| rules_js | 35s |
| yarn 1 | 44s |
| npm 8 | 48s |
| `yarn_install` (rules_nodejs) | 54s |
| `npm_install` (rules_nodejs) | 56s |

### Incremental Dependency Change (warm cache)

| Tool | Time |
|------|------|
| npm 8 | 8s |
| yarn 1 | 13s |
| pnpm 7 | 16s |
| rules_js | 21s |
| `yarn_install` (rules_nodejs) | 75s |
| `npm_install` (rules_nodejs) | 84s |

### Lazy Run Single Tool (warm cache)

| Tool | Time |
|------|------|
| rules_js | **1.12s** |
| pnpm 7 | 29s |
| yarn 1 | 45s |
| npm 8 | 46s |
| `yarn_install` (rules_nodejs) | 54s |
| `npm_install` (rules_nodejs) | 56s |

**Key insight**: The 1.12s lazy run is the headline result. When building a single target that needs a handful of packages from a 3750-package tree, rules_js only fetches and links those packages. Native package managers must install everything.

**Caveats**: All benchmark data is vendor-sourced. No independent benchmarks were found. The absolute performance gap with pnpm has likely narrowed since these benchmarks were run.

## Lazy Fetching Deep Dive

Traditional npm workflow: run `npm install` (or equivalent) as a monolithic step that processes the entire `package.json`. Even if one test depends on 20 packages, all 3750 must be installed.

rules_js workflow: `npm_translate_lock` generates one `npm_import` repository rule per package. Each is lazy -- Bazel only executes it when a build target transitively depends on that package. The hub repository knows the full dependency graph but doesn't trigger downloads until needed.

This transforms the cost model:
- **Traditional**: O(total packages in lockfile) per install
- **rules_js**: O(packages needed by requested targets) per build
- For a large monorepo where any given target uses <5% of total dependencies, this is transformative

## Directory-Level Sandbox Granularity

Each npm package is represented as a single TreeArtifact (declared directory) in Bazel. This affects three performance-critical paths:

**Sandbox setup**: Instead of creating symlinks for every file in every npm package (hundreds of thousands of symlinks), Bazel creates one symlink per package directory. Reduces sandbox setup from minutes to milliseconds.

**Remote cache**: TreeArtifacts are cached as single entries. Uploading/downloading one directory artifact per package is far cheaper than individual file operations.

**Action input tracking**: Bazel tracks one input per package, not one per file. This reduces the Merkle tree computation, action cache key computation, and memory pressure from input tracking.

## Remote Execution

Remote execution became viable with rules_js because:
1. The static `node_modules` layout (no runtime linker mutation) works in remote sandboxes
2. Symlink support in remote execution was added in Bazel 5.3.0
3. TreeArtifacts have well-defined serialization for remote transfer

Aspect Build reported an **8.4x speedup** for TypeScript builds with RBE on one customer project. This is highly workload-dependent -- factors include project size, parallelism configuration, network latency, and baseline local build performance. The claim should be treated as a best-case vendor result, not a general expectation.

The enabler: small CI machines backed by a large auto-scaling remote execution cluster can handle TypeScript compilation that would overwhelm the CI machine locally.

## Incremental Re-linking

When a dependency changes (e.g., upgrading `lodash@4.17.20` to `lodash@4.17.21`):
- **rules_js**: Only that package and its transitive dependents are re-fetched/re-linked. Other packages remain cached.
- **rules_nodejs** (`yarn_install`/`npm_install`): The entire `node_modules` tree is invalidated and rebuilt from scratch on any lockfile change.

This reduced incremental dependency changes from 74-84s (rules_nodejs) to 21s (rules_js) in the Kibana benchmark.

## Persistent Workers for TypeScript

`rules_ts` supports persistent worker mode (`tsc_worker`):
- Keeps a `tsc` process running between compilations
- Maintains an LRU cache and virtual filesystem
- Avoids JIT warmup costs on each compilation action
- Workers were incompatible with `rules_nodejs` because the runtime linker mutated `node_modules` at process startup

Worker mode is opt-in due to known correctness edge cases. Enable per-action or globally:
```
build --strategy=TsProject=worker
```

## Loading-Phase Overhead

The performance bottleneck that **doesn't** scale well: lockfile parsing during Bazel's loading phase.

`npm_translate_lock` parses the entire `pnpm-lock.yaml` in single-threaded Starlark. For large lockfiles (thousands of packages), this adds seconds to every build invocation -- even when building targets unrelated to npm. Known issues:
- Lockfile parsed for unrelated targets (#2769)
- Adding one package invalidates caches for unrelated targets (#2540)
- Memory pressure from non-internable Starlark strings (#2138)

This is an architectural limitation of Bazel's module extension / repository rule system, not specific to rules_js.

## Sources

- [HackMD: npm benchmarks](https://hackmd.io/@aspect/npm-benchmarks)
- [Aspect blog: TypeScript 8.4x faster with RBE](https://blog.aspect.build/typescript-with-rbe)
- [Aspect blog: rules_js npm benchmarks](https://blog.aspect.build/rulesjs-npm-benchmarks)
- [rules_js README](https://github.com/aspect-build/rules_js)
