---
name: bazel-nodejs
description: |
  Bazel Node.js and npm integration via rules_js (Aspect Build) - npm dependency management, node_modules layout, BUILD files for JS/TS packages, and JS-specific performance.
  This skill should be used when working with rules_js, rules_ts, npm_translate_lock, npm_import, node_modules in Bazel, js_library, js_binary, js_test, js_run_binary, npm_link_all_packages, npm_package, ts_project, pnpm virtual store in Bazel, BUILD.bazel files for JavaScript or TypeScript packages, or Bazel npm dependencies. Also use when debugging npm resolution issues in Bazel, configuring MODULE.bazel for npm, or optimizing JS-specific build performance.
---

# Bazel + Node.js/npm Integration

rules_js by Aspect Build is the standard Bazel ruleset for JavaScript and npm. It replaced the deprecated `build_bazel_rules_nodejs`. The core design: replicate pnpm's symlinked `node_modules` structure inside Bazel's output tree (`bazel-out`), enabling standard Node.js module resolution without patching `require()` or running a runtime linker.

Three design goals: **Lazy** (only fetch npm packages needed for requested targets), **Correct** (standard Node.js resolution works), **Fast** (npm packages are directory-level artifacts, not thousands of individual files).

## Architecture

The Aspect Build team tried three approaches over four years before landing on the current design:

1. **Monkey-patching `require()`** (Google-internal style, like Yarn PnP) -- failed because too many npm packages implement their own resolution
2. **Runtime linker** (`npm link`-style, used by `rules_nodejs`) -- slow, incompatible with persistent workers, caused TypeScript `rootDirs` issues from source/output tree separation
3. **pnpm-style virtual store in `bazel-out`** (the rules_js approach) -- JS tools always run with working directory in Bazel's output tree; sources are copied there; a pnpm-compatible `node_modules` tree is pre-built before actions execute

The key insight: copy sources into the output tree so sources and outputs live side-by-side (matching npm conventions), then build a pnpm-style `node_modules` layout there. Standard Node.js resolution "just works" with no patches.

Companion rulesets built on rules_js: `rules_ts`, `rules_swc`, `rules_jest`, `rules_esbuild`, `rules_webpack`, `rules_rollup`, `rules_lint`.

For deep architectural details and historical context, consult `references/rules-js-architecture.md`.

## npm Dependency Pipeline

The pipeline has three distinct phases:

### Phase 1: Resolution (loading time)
`npm_translate_lock` reads a `pnpm-lock.yaml` (can convert from `package-lock.json` or `yarn.lock` via `pnpm import`). The lockfile is parsed entirely in Starlark -- no external tools. For each package, it generates an `npm_import()` repository rule. A hub repository (e.g., `@npm`) is created containing the `npm_link_all_packages()` macro.

### Phase 2: Fetching (lazy, per-package)
Each `npm_import` downloads a single npm tarball using Bazel's built-in downloader (`rctx.download()`), verified against SHA-512 integrity hashes from the lockfile. Crucially, Bazel only executes `npm_import` rules when a target actually depends on that package -- a lockfile with thousands of packages does not cause all to download.

### Phase 3: Linking (build time)
`npm_link_all_packages()` in BUILD files creates a virtual `node_modules` tree under `bazel-bin/` using symlinks, mirroring pnpm's layout. The virtual store lives at `bazel-bin/node_modules/.aspect_rules_js/`. Lifecycle hooks run as cacheable Bazel build actions (shared via remote cache).

## node_modules Layout

rules_js replicates pnpm's symlinked structure:

```
bazel-bin/
  node_modules/
    .aspect_rules_js/           # virtual store (like .pnpm/)
      lodash@4.17.21/
        node_modules/
          lodash/               # actual package contents
    lodash -> .aspect_rules_js/lodash@4.17.21/node_modules/lodash
  packages/
    my-app/
      node_modules/
        my-lib -> ...           # workspace package symlink
      index.js                  # copied source
```

- Only declared direct dependencies are symlinked -- no phantom deps from hoisting
- Aims for compatibility with pnpm's `hoist=false` mode (some divergences exist)
- Standard Node.js resolution works without `NODE_PATH` hacks

## Key Rules Quick Reference

| Rule | Purpose |
|------|---------|
| `js_library` | Group JS sources + deps into a `JsInfo` provider (no actions) |
| `js_binary` | Run a JS program with Node.js (launcher script + node_modules) |
| `js_test` | Same as `js_binary` but as a Bazel test target |
| `js_run_binary` | Run a `js_binary` as a build action producing outputs |
| `js_run_devserver` | Run a devserver in a watch-compatible sandbox (for ibazel) |
| `npm_package` | Assemble files into an npm package layout |
| `npm_link_all_packages` | Create per-workspace `node_modules` tree from lockfile |
| `ts_project` | TypeScript compilation (from `rules_ts`, builds on `rules_js`) |

Depend on npm packages via `:node_modules/<package-name>` targets generated by `npm_link_all_packages`.

## MODULE.bazel Configuration

Configure npm dependencies via Bzlmod module extension:

```python
npm = use_extension("@aspect_rules_js//npm:extensions.bzl", "npm")
npm.npm_translate_lock(
    name = "npm",
    pnpm_lock = "//:pnpm-lock.yaml",
)
use_repo(npm, "npm")
```

Bazel 8 disabled WORKSPACE by default (`--enable_workspace` to restore). Bazel 9 plans to remove it entirely. All new projects should use Bzlmod.

Each workspace package needs a BUILD file calling `npm_link_all_packages()`:

```python
load("@npm//:defs.bzl", "npm_link_all_packages")
npm_link_all_packages(name = "node_modules")
```

## JS-Specific Performance

**Lazy fetching**: Only packages needed by requested targets are downloaded. In a 3750-package tree, running one tool fetches ~20 packages instead of all 3750.

**Directory-level granularity (TreeArtifacts)**: Each npm package is a single declared directory artifact, not thousands of individual files. Sandbox setup creates symlinks to a handful of directories instead of copying files. This was the critical evolution from `rules_nodejs` (which tracked individual files).

**Persistent `tsc` workers**: rules_ts supports keeping `tsc` processes hot between compilations, avoiding JIT warmup. Enabled by rules_js eliminating the runtime linker (which was incompatible with workers).

**Remote execution**: Viable with rules_js because the static `node_modules` layout works in remote sandboxes.

For the `bazel-performance` skill, consult general optimization (profiling, caching strategy, JVM memory, sandbox flags). For JS-specific benchmark data and performance deep-dives, see `references/performance-mechanisms.md`.

## Hermeticity

`js_binary` optionally patches Node.js `fs` module functions (`lstat`, `readlink`, `realpath`, `readdir`, `opendir`) to prevent following symlinks outside the sandbox.

**Known limitation**: ESM `import()` bypasses these fs patches (Node.js ESM resolver uses `realpathSync` directly). Open issue since 2022 (#362).

Platform-specific packages (e.g., `@esbuild/darwin-arm64`) are handled via Bazel `select()` -- all variants are fetched but only the correct platform is linked. This diverges from native pnpm (which skips non-matching platforms) but enables cross-compilation.

## Common Pitfalls

- **Phantom dependency errors**: Packages depending on undeclared transitive deps break. Fix with `pnpm.packageExtensions` in `package.json`
- **Cache invalidation on new packages**: Adding one package can invalidate caches for unrelated targets (#2540)
- **Lockfile parsed for unrelated targets**: Module extension runs during loading for any `@npm` reference (#2769)
- **ESM sandbox escape**: Dynamic imports can resolve outside sandbox (#362)
- **`__dirname` not hermetic**: Points to Bazel output tree, not source tree

For detailed troubleshooting patterns, debugging commands, and migration guidance, see `references/troubleshooting.md`.

## Related Skills

| Skill | Use for |
|-------|---------|
| `bazel-performance` | General Bazel optimization: profiling, caching, JVM memory, sandbox flags, persistent workers |
| `typescript-helper` | TypeScript config, type errors, tsconfig.json patterns |
| `bun-workspaces` | Bun monorepo patterns outside of Bazel |

## Reference Files

For detailed information beyond this overview:

- **`references/rules-js-architecture.md`** -- Deep internals: historical evolution, rules_nodejs vs rules_js comparison, pnpm virtual store mechanics, TreeArtifact details, platform-specific packages, comparison with Turborepo/Nx
- **`references/performance-mechanisms.md`** -- JS-specific performance: benchmark data (with caveats), lazy fetching mechanics, directory-level granularity, remote execution, incremental re-linking
- **`references/troubleshooting.md`** -- Pain points and fixes: phantom deps, ESM escape, cache invalidation, Windows issues, debugging commands, migration from rules_nodejs
