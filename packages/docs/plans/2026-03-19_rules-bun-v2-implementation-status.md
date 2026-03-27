# rules_bun v2 Implementation Status

Implementation progress for the hermetic framework rules migration described in `2026-03-17_rules-bun-v2-link-first-materialization.md` and `2026-03-18_rules-bun-v2-hermetic-framework-rules.md`.

## Completed Infrastructure

### Phase 1: Shared Prepared-Tree Primitive

All done. Backward compatible — existing targets work unchanged.

- `BunTreeInfo` provider added to `tools/rules_bun/bun/providers.bzl`
- `resolve_bun_info()` helper extracted to `tools/rules_bun/bun/private/resolve_bun_info.bzl`, deduplicating the BunInfo merge pattern from 4 rules
- `bun_prepared_tree` rule at `tools/rules_bun/bun/private/bun_prepared_tree.bzl`
- Public macro `bun_prepared_tree` in `tools/rules_bun/bun/defs.bzl`
- `bun_test`, `bun_eslint_test`, `bun_binary`, `bun_typecheck_test` all accept optional `prepared_tree` attr; fall back to inline `materialize_tree` when absent

### Phase 2: Link-First Materialization

Done. Single-file change to `tools/rules_bun/bun/private/materialize.bzl`.

- Phase 2 (regular files): `ln -f || cp -f` with fatal error on failure
- Phase 3 (directory artifacts): fatal error on failure
- Phase 4 (symlinks): fatal error on failure
- Fixed pre-existing bug: `xargs mkdir -p` split paths with spaces (e.g., `thread-stream/test/dir with spaces/test-package.zip`)
- Fixed pre-existing bug: root-level files in `extra_files` (e.g., `tsconfig.base.json`) materialized as directories due to awk `sub()` not matching paths without `/`

### Phase 3: Framework Build Engine

Done. New rules and templates.

| File                                | Purpose                                       |
| ----------------------------------- | --------------------------------------------- |
| `bun/private/bun_build.bzl`         | Private build action rule (`ctx.actions.run`) |
| `bun/private/bun_build_test.bzl`    | Private test rule for `astro check`           |
| `bun/private/bun_build.sh.tpl`      | Build action template (exec-root paths)       |
| `bun/private/bun_build_test.sh.tpl` | Test template (runfiles-based)                |

Public wrappers in `bun/defs.bzl`:

- `bun_vite_build` — runs `bun ./node_modules/vite/bin/vite.js build`
- `bun_astro_build` — runs `bun ./node_modules/astro/astro.js build`
- `bun_astro_check` — runs `bun ./node_modules/astro/astro.js check`

Key design decisions:

- Framework CLIs invoked via direct entrypoint (`./node_modules/astro/astro.js`) instead of `bun run build` or `bun x`. `bun run` spawns a shell that can't find CLIs (sandbox strips PATH). `bun x` downloads from registry instead of using local.
- `cp -a` overlay from materialized tree to `/tmp` working dir. Required because Vite/Rollup resolve HTML entries via realpath — the deep Bazel execroot TreeArtifact path causes relative path computation to produce invalid `../` chains that Rollup rejects. The `/tmp` overlay gives a short, clean CWD.
- Hermetic env: `HOME`, `XDG_CACHE_HOME` set to scratch dirs. `CI=true` + `ASTRO_TELEMETRY_DISABLED=1` + `DO_NOT_TRACK=1`.
- `node_modules/.bin` added to PATH for bun-spawned subprocesses.

## Package Migration Status

### BUILD.bazel Migrations

All 11 packages migrated to new macros. Legacy `tools/bazel:vite_build.bzl`, `astro_build.bzl`, `astro_check.bzl` deleted.

| Package                                   | Framework | Migrated |        Builds in Sandbox        |
| ----------------------------------------- | --------- | :------: | :-----------------------------: |
| `cooklang-rich-preview`                   | Astro     |   yes    |       **yes** (verified)        |
| `status-page/web`                         | Astro     |   yes    |          not verified           |
| `sjer.red`                                | Astro     |   yes    |          not verified           |
| `scout-for-lol/packages/frontend`         | Astro     |   yes    |          not verified           |
| `clauderon/docs`                          | Astro     |   yes    |          not verified           |
| `hn-enhancer`                             | Vite      |   yes    | **no** — see Vite blocker below |
| `better-skill-capped`                     | Vite      |   yes    | **no** — see Vite blocker below |
| `discord-plays-pokemon/packages/frontend` | Vite      |   yes    |          not verified           |
| `scout-for-lol/packages/desktop`          | Vite      |   yes    |          not verified           |
| `sentinel/web`                            | Vite      |   yes    |          not verified           |
| `clauderon/web/frontend`                  | Vite      |   yes    |          not verified           |

### Additional Changes

- `sentinel/web/vite.config.ts`: `outDir` changed from `"../dist/web"` to `"dist"`
- `sentinel/src/adapters/webhook.ts`: `serveStatic` root changed from `"./dist/web"` to `"./web/dist"`
- `better-skill-capped` `bun_library`: added `src/**/*.css` to data glob (was only `*.sass`)

## Open Blockers

### Vite HTML Entry Path Resolution

**Affects:** All Vite packages (6 total).

**Symptom:** Rollup rejects HTML entry filenames:

```
The "fileName" or "name" properties of emitted chunks and assets must be strings
that are neither absolute nor relative paths, received
"../../../../../../...execroot/.../packages/better-skill-capped/index.html"
```

**Root Cause:** Vite's `build-html` plugin resolves `index.html` to its absolute realpath inside the Bazel sandbox. Rollup then computes a relative path from `outDir` to this absolute path, producing a deeply nested `../` chain that it rejects. This happens because:

1. The materialized TreeArtifact lives at a deep path like `bazel-out/darwin_arm64-fastbuild/bin/packages/foo/vite_build_tree_tree/`
2. Bun resolves module paths through realpath, which for hardlinked files returns the long execroot path
3. Rollup's `generateBundle` hook rejects filenames with `../`

**Why Astro works but Vite doesn't:** Astro's build pipeline doesn't emit HTML through Rollup's `generateBundle`. It writes static HTML files directly to `dist/` using its own rendering pipeline.

**Attempted fixes that didn't work:**

- `cp -a` overlay to `/tmp/bun_build_$$/tree/` — Bun still resolves realpath through hardlinks back to the original TreeArtifact
- Symlinking tree to a short path — same problem, Bun follows realpath

**Solution implemented:** The `bun_build.sh.tpl` template uses `cp -RL` to re-copy the package source directory with symlink dereferencing into the `/tmp` working directory, excluding `node_modules`. This makes source files fully independent of the TreeArtifact, so Bun/Vite resolve realpaths within the short `/tmp` overlay path instead of the deep execroot path. The `node_modules` directory is still symlinked separately to avoid the copy cost.

### Undeclared Inputs

Hermetic builds surface files that the legacy `local=True` macros masked. Each package may need `bun_library` glob adjustments. Known example: `better-skill-capped` needed `src/**/*.css` added to its `bun_library` data glob.

### Astro Package Sandbox Verification (2026-03-19)

| Package                  | Build Result | Issue                                                                                                                                                                                                               |
| ------------------------ | :----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status-page/web`        |   **PASS**   | Builds and runs in sandbox (733s)                                                                                                                                                                                   |
| `clauderon/docs`         |   **FAIL**   | Starlight CSS virtual module path resolution — Vite can't find compile metadata for `.astro` component styles because Bun resolves node_modules paths through hardlinks back to the deep execroot TreeArtifact path |
| `sjer.red`               |   **FAIL**   | Vite SSR module runner can't resolve workspace package `astro-opengraph-images` — same realpath-through-hardlinks issue affecting node_modules resolution                                                           |
| `scout-for-lol/frontend` |   **FAIL**   | Vite `import.meta.glob("assets/Rank=*.png")` in `@scout-for-lol/report` — glob must start with `/` or `./`. This is a source code bug, not a Bazel issue.                                                           |

The failures are all variants of the same fundamental issue: the `cp -RL` source dereference only covers the package source directory, not `node_modules`. When Vite/Astro process `.astro` files or resolve workspace packages inside `node_modules`, Bun follows hardlinks back to the deep execroot path, breaking path computation. A full `cp -RL` of `node_modules` would fix this but at significant cost (600MB+). A targeted approach (dereference only the specific npm entries that Vite processes) may be needed.

### Clauderon Rust Integration

`clauderon/web/frontend` and `clauderon/docs` export `.gitkeep` placeholders for `include_dir!` in the Rust binary. The hermetic build produces a Bazel TreeArtifact, not a source-tree directory. A staging rule is needed to bridge the Rust build to consume Bazel-produced dist artifacts. Deferred — hardest blocker.
