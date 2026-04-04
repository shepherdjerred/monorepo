# rules_bun2: Monolithic bun install for Bazel

Date: 2026-03-20

## Problem

The existing `rules_bun` (v1) takes ~10 minutes to install npm dependencies for Bazel builds. The bottleneck is per-package materialization: the repo rule parses the lockfile in Starlark, generates 2,784 per-package targets, and individually copies/links each package into the Bazel output tree. Meanwhile, native `bun install` does the same work in 236ms.

The goal: npm dependency management in Bazel that's at most 1x slower than running outside Bazel.

## Architecture: What We Built

### Core Design

One `bun install` invocation produces a flat `node_modules/` that Bazel treats as a single artifact via `BAZEL_TRACK_SOURCE_DIRECTORIES=1`. No Starlark lockfile parsing, no per-package materialization, no per-package targets.

```
Repository rule:
  1. Download Bun binary
  2. Copy all package.json files (maintaining directory structure)
  3. Strip "workspaces" from root package.json
  4. Merge all workspace deps into one flat dependency list
  5. Run `bun install` (~9s)
  → Output: node_modules/ as a source directory

.bazelrc:
  startup --host_jvm_args=-DBAZEL_TRACK_SOURCE_DIRECTORIES=1

Generated BUILD.bazel:
  exports_files(["node_modules"])

Downstream rules:
  bun_test / bun_eslint_test / bun_typecheck_test
  → Copy sources to temp dir, symlink node_modules, run command
```

### Key Files

- `tools/rules_bun2/bun/private/bun_install.bzl` — Repository rule
- `tools/rules_bun2/bun/private/common.bzl` — Shared test runner infrastructure
- `tools/rules_bun2/bun/private/bun_test.bzl` — Test rule
- `tools/rules_bun2/bun/private/bun_eslint_test.bzl` — Lint rule
- `tools/rules_bun2/bun/private/bun_typecheck_test.bzl` — Typecheck rule
- `tools/rules_bun2/bun/defs.bzl` — Public API
- `tools/rules_bun2/bun/extensions.bzl` — Bzlmod module extension

## Approaches Tried and Rejected

### 1. Per-package materialization (rules_bun v1, rules_js approach)

Parse lockfile in Starlark → generate per-package `npm_import` repository rules → materialize each package individually.

**Why it fails for Bun**: `bun install` is 236ms for 3,348 packages. The decomposition overhead (Starlark parsing, per-package actions, sandbox setup per package) far exceeds the native install time. rules_js designed this for pnpm/npm where install takes 78-104s — the decomposition amortized that cost. With Bun, it's 10 minutes of overhead for a 236ms operation.

### 2. filegroup with glob

```python
filegroup(name = "node_modules", srcs = glob(["node_modules/**"]))
```

**Result**: 1,082,152 targets configured. 40s creating runfiles tree. 223s total. Bazel tracks every file individually — the glob expands to ~1M files, each becoming a Skyframe node and requiring a symlink in the sandbox.

### 3. TreeArtifact via build action (cp -c / clonefile)

Create a build action that clones node_modules into a `declare_directory()` TreeArtifact using macOS `clonefile()` (O(1) CoW) or Linux hardlinks.

**Why it fails**: The source directory (from the repo rule) can't be an input to a sandboxed build action — Bazel only puts declared artifacts in the sandbox, and a pre-existing directory from a repo rule isn't a declared artifact. You'd need `no-sandbox` to access it, which breaks hermeticity.

This is a fundamental gap in Bazel's design: **repository rules cannot produce TreeArtifacts**. There's no `rctx.declare_directory()`. The repo rule system predates TreeArtifacts and was never updated to support them. Issue [bazelbuild/bazel#25834](https://github.com/bazelbuild/bazel/issues/25834) tracks this — the `BAZEL_TRACK_SOURCE_DIRECTORIES` JVM flag has existed for 7+ years but isn't enabled by default.

### 4. copy_directory (bazel-skylib)

Bridge pattern: repo rule produces directory → `copy_directory` copies it to a TreeArtifact in `bazel-out/`.

**Why it fails**: Bazel's TreeArtifact validation rejects dangling symlinks. Bun's workspace symlinks (`node_modules/@shepherdjerred/eslint-config -> ../../packages/eslint-config`) are dangling in the external repo context. Error: `child @shepherdjerred/eslint-config is a dangling symbolic link`.

### 5. Bun workspaces layout (per-workspace node_modules)

Keep Bun's native workspace layout with per-workspace `node_modules/` directories containing symlinks into the root `.bun/` virtual store.

**Why it fails**: The per-workspace `node_modules/` directories contain relative symlinks (`express -> ../../../node_modules/.bun/express@5.../...`) that only resolve when the full directory structure is intact. Cherry-picking pieces into a temp work dir breaks the symlink chains. Additionally, workspace package symlinks (`@shepherdjerred/eslint-config -> ../../packages/eslint-config`) cause `BAZEL_TRACK_SOURCE_DIRECTORIES` to fail because they resolve into the source tree, pulling in BUILD.bazel files that reference workspace-only paths.

### 6. Tar + untar

Tar node_modules in the repo rule (single tracked file), untar in a build action to create a TreeArtifact.

**Why rejected**: O(n) twice — once to tar, once to untar. For ~100K files, this adds seconds. The source directory approach is simpler and avoids the double copy. Rejected on principle before benchmarking since simpler alternatives existed.

## Decisions That Stuck

### Strip Bun workspaces, install flat

The repo rule strips the `workspaces` field from the root `package.json` and merges all workspace dependencies into one flat dependency list. `bun install` then produces a single hoisted `node_modules/` with no per-workspace splits and no workspace symlinks.

**Why**: Bun's workspace layout creates relative symlinks and per-workspace `node_modules/` directories that break in Bazel's sandboxing model. A flat install avoids all of these issues. Workspace inter-package imports are handled by Bazel's dependency graph (via `bun_library` targets with `package_name`), not by node_modules symlinks.

**Tradeoff**: Different workspace packages can't use different versions of the same npm dependency. In practice this is rarely an issue — Bun's hoisting already deduplicates aggressively.

### BAZEL_TRACK_SOURCE_DIRECTORIES=1

A 7-year-old JVM flag that makes Bazel treat source directories as TreeArtifacts. One `.bazelrc` line:

```
startup --host_jvm_args=-DBAZEL_TRACK_SOURCE_DIRECTORIES=1
```

**Why**: This is the only way to get O(1) sandbox setup for a directory produced by a repository rule, without copying, tarring, or bypassing the sandbox. Bazel creates one symlink for the entire `node_modules/` directory instead of ~1M individual file symlinks.

**Risk**: Not enabled by default. Could theoretically be removed or changed. But it's been stable for 7 years, and [bazelbuild/bazel#25834](https://github.com/bazelbuild/bazel/issues/25834) proposes making it default.

### Copy sources to temp dir, not symlink

The test runner copies source files to a temp work dir (`cp`) rather than symlinking (`ln -s`). This is because tools like `bun test` write snapshot files next to test sources, and `eslint` writes cache files. Symlinks to read-only runfiles would fail.

The node_modules directory IS symlinked (read-only is fine for deps).

### Run npm binaries via `bun ./node_modules/<pkg>/bin/<cmd>.js`

npm binaries (tsc, eslint) have `#!/usr/bin/env node` shebangs. In Bazel's sandbox, `node` isn't in PATH. `bunx` and `bun run` both try to execute the shebang, which fails.

Running `bun ./node_modules/typescript/bin/tsc` bypasses the shebang entirely — Bun loads the JS file directly with its runtime.

## Performance

| Scenario                              | Time     |
| ------------------------------------- | -------- |
| Cold (after `bazel clean --expunge`)  | 70s      |
| After `bazel clean` (disk cache warm) | 33s      |
| Hot (day-to-day development)          | **1.4s** |

Per-target execution (hot):

| Target                 | Time |
| ---------------------- | ---- |
| bun test (webring)     | 1.4s |
| tsc --noEmit (webring) | 1.0s |
| eslint (webring)       | 2.6s |

Native baseline (no Bazel): bun test ~1.5s, tsc ~1.0s, eslint ~2.5s. Bazel adds <0.5s overhead on hot builds.

## Open Issues

- **Source directory rescan**: After Bazel server restart, Bazel rescans the entire node_modules directory (~30-40s) to rebuild its fingerprint. This is because repo rule outputs live in `external/` which Bazel doesn't trust. A `copy_directory` bridge would avoid this (copies to trusted `bazel-out/`) but fails on workspace symlinks.
- **No `bun_build` rule yet**: Vite/Astro/tsc compilation rules not implemented.
- **Linux cold build**: `BAZEL_TRACK_SOURCE_DIRECTORIES` may have different scanning performance characteristics on Linux (ext4 vs APFS).
- **Version conflicts**: Flat install means all workspace packages share dependency versions. May hit issues with packages needing incompatible versions of the same dep.
