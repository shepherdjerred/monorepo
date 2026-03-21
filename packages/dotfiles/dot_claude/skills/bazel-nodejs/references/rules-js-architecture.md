# rules_js Architecture Deep Dive

## Historical Context: Three Approaches Over Four Years

The Aspect Build team (led by Alex Eagle, former Google Bazel team member) tried three distinct approaches to making Node.js work inside Bazel before settling on the current design:

### Approach 1: Monkey-patching `require()`
Modeled on Google's internal approach and similar to Yarn PnP. Intercepts Node.js module resolution at runtime to redirect imports to Bazel-managed locations. Failed in practice because a large fraction of the npm ecosystem implements custom resolution logic (e.g., `resolve`, `enhanced-resolve` in webpack) that bypasses the patched `require()`.

### Approach 2: Runtime Linker (`rules_nodejs`)
Used by `build_bazel_rules_nodejs`. At the start of every Node.js process invocation, a linker script ran `npm link`-style symlink creation to build a `node_modules` tree. Problems:
- **Slow**: Symlink creation at every Node.js spawn added latency
- **Incompatible with persistent workers**: Workers need stable filesystem state; the linker mutated the tree at startup
- **Source/output tree separation**: Bazel conventionally keeps sources and outputs in separate trees, but Node.js tools expect them side-by-side. This caused intractable TypeScript `rootDirs` issues and required `genrule`/`ctx.actions.run` workarounds

### Approach 3: pnpm-Style Virtual Store (rules_js)
The winning approach. Always runs JS tools with working directory in Bazel's output tree (`bazel-out`). Sources are copied there, and a pnpm-compatible `node_modules` tree is pre-built as standard Bazel targets before actions execute.

## rules_nodejs vs rules_js Comparison

| Aspect | `rules_nodejs` (deprecated) | `rules_js` (current) |
|--------|---------------------------|---------------------|
| Status | Unmaintained | Actively maintained by Aspect Build |
| Dependency fetching | Calls `npm install` / `yarn install` on full `package.json` | Bazel's downloader fetches individual packages from pnpm lockfile |
| node_modules layout | Runtime linker using symlinks at process startup | pnpm-style tree created as Bazel targets under `bazel-out` |
| Source/output layout | Sources in one tree, outputs in another (standard Bazel) | Sources copied to output tree (npm convention) |
| Module resolution | Monkey-patched `require()` or runtime linker | Standard Node.js resolution against `node_modules` in `bazel-out` |
| Package manager | npm or Yarn | pnpm (lockfile consumed by Bazel) |
| Worker support | Incompatible (linker mutates state at startup) | Compatible (static `node_modules`) |

## pnpm Virtual Store Internals

rules_js mirrors pnpm's content-addressable store architecture:

**pnpm's native structure:**
- A content-addressable store on disk holds actual file contents (one copy per unique file)
- `node_modules/.pnpm/` (the "virtual store") contains directories for each `package@version`
- Hard links connect the virtual store to the content-addressable store
- Each package's dependencies are symlinked within `.pnpm/`
- Direct project dependencies are symlinked from `node_modules/foo` into `.pnpm/foo@version/node_modules/foo`

**rules_js adaptation:**
- Virtual store at `bazel-bin/node_modules/.aspect_rules_js/` (instead of `.pnpm/`)
- Package symlinks: `bazel-bin/node_modules/some_pkg` points into the virtual store
- Workspace-specific node_modules: `bazel-bin/packages/some_pkg/node_modules/some_dep`
- Only declared dependencies are resolvable -- no phantom dependencies from hoisting
- Aims for compatibility with pnpm's `hoist=false` mode, though divergences exist (e.g., `public_hoist_packages` behavior differs)

## TreeArtifact Evolution

How npm packages are represented as Bazel action inputs evolved through three stages:

### Stage 1: Individual Files (rules_nodejs)
Every file in every npm package was declared as an individual action input. A single build action could have hundreds of thousands of inputs. Sandbox setup (creating symlinks for each file) took minutes.

### Stage 2: Source Directories
Reduced input count by representing packages as "source directories." Improved sandbox setup speed but was **incompatible with remote execution** -- remote execution needs to transfer all inputs, and source directories had no well-defined serialization.

### Stage 3: Declared Directories / TreeArtifacts (rules_js)
Each npm package is a single "declared directory" (`TreeArtifact`). Bazel tracks it as one entity. Works with both local sandboxing (one symlink per package) and remote execution (one directory transfer per package). This is the current approach and the key performance enabler.

## Platform-Specific Packages

npm packages can declare `os` and `cpu` constraints in their `package.json` (e.g., `@esbuild/darwin-arm64` specifies `"os": ["darwin"]`, `"cpu": ["arm64"]`).

rules_js handles this via Bazel's `select()` mechanism:
- The pnpm lockfile records `os`/`cpu` fields
- `npm_translate_lock` converts these to Bazel platform constraint `select()` expressions
- Pnpm platform names (e.g., `darwin`, `linux`, `arm64`) are mapped to Bazel constraint values
- Negated constraints (e.g., `"!win32"`) are supported

**Key divergence from pnpm**: All platform variants are fetched (pnpm skips non-matching platforms). Only the correct platform's package is linked at build time via `select()`. This enables cross-compilation and remote execution on different architectures.

## Comparison with Turborepo and Nx

| Dimension | Bazel + rules_js | Turborepo | Nx |
|-----------|-----------------|-----------|-----|
| npm handling | Re-layouts `node_modules` via pnpm in Bazel sandbox | Uses existing `node_modules` as-is | Uses existing package manager |
| Incremental adoption | Requires full buy-in | One package at a time | Incremental with plugins |
| Remote caching | Yes (RBE/EngFlow) | Yes (Vercel Remote Cache) | Yes (Nx Cloud) |
| Remote execution | Yes (RBE/EngFlow) | No | Yes (Nx Cloud) |
| Multi-language | Yes (primary strength) | Can orchestrate any language | Primarily JS/TS |
| Watch mode | ibazel (third-party) | Built-in | Built-in |
| Setup complexity | High (Starlark, BUILD files, pnpm) | Low (turbo.json) | Moderate (nx.json + plugins) |

**When Bazel wins**: Polyglot monorepos at large scale (1M+ SLOC, 100+ devs) where multi-language support and distributed execution justify the setup cost.

**When alternatives win**: JS/TS-only projects, smaller teams, or when rapid onboarding matters more than hermetic builds.

## Aspect Build Context

rules_js is maintained by Aspect Build, a commercial company selling Bazel consulting and services. This is relevant for:
- **Benchmark data**: All published benchmarks come from Aspect Build (the vendor); no independent benchmarks are available
- **Sustainability**: If Aspect Build's business changes, rules_js maintenance could be at risk
- **Bias**: Documentation and blog posts naturally emphasize rules_js strengths

## Sources

- [aspect-build/rules_js README](https://github.com/aspect-build/rules_js)
- [HackMD: rules_js presentation by Alex Eagle](https://hackmd.io/@aspect/rules_js)
- [pnpm: Symlinked node_modules structure](https://pnpm.io/symlinked-node-modules-structure)
- [rules_js migration guide](https://docs.aspect.build/guides/rules_js_migration/)
- [rules_nodejs wiki](https://github.com/bazelbuild/rules_nodejs/wiki)
