# Plan: Hermetic Vite/Astro Build Rules + Cacheable OCI Images

## Status: ~90% Complete (2026-03-19)

- Phase 1 (bun_build rule): Complete
- Phase 2 (bun_astro_check): Complete
- Phase 3 (Vite migration): Complete
- Phase 4 (Astro migration): Complete
- Phase 5 (OCI image cacheable): Being implemented now
- Phase 6 (Cleanup): Complete (legacy macros deleted)

## Context

The Bazel monorepo has ~80 targets, but Vite/Astro builds and OCI images bypass the remote cache entirely:

- **Vite/Astro rules** use `local = True` + `no-remote-cache = True`, escaping the sandbox to run in the real workspace. They declare almost no inputs, so Bazel can't cache them.
- **OCI image targets** are tagged `manual`, so they're never built during normal CI — only during the publish phase on main. This means the first build is never cached when publish runs.

The repo already has a mature `materialize_tree` pattern (used by `bun_test`, `bun_eslint_test`, `bun_typecheck_test`) that creates fully hermetic TreeArtifacts with sources + npm deps. The Vite/Astro `bun_library` targets already declare all their sources and deps — the non-hermetic rules just don't use them.

**Goal:** Make everything hermetic and cacheable so CI is faster and deterministic.

## Inventory of Affected Targets

### Targets with `no-remote-cache` or `local` execution:

| Rule                | File                              | Used by                      |
| ------------------- | --------------------------------- | ---------------------------- |
| `vite_build`        | `tools/bazel/vite_build.bzl`      | 6 packages                   |
| `astro_build`       | `tools/bazel/astro_build.bzl`     | 5 packages                   |
| `astro_check`       | `tools/bazel/astro_check.bzl`     | 5 packages                   |
| `obsidian_headless` | `tools/oci/obsidian_headless.bzl` | 1 target (keep as-is, niche) |

### OCI image targets tagged `manual` (cacheable but never built in CI):

| Package                                             | Target                                        |
| --------------------------------------------------- | --------------------------------------------- |
| birmel                                              | `image`, `image_push`                         |
| sentinel                                            | `image`, `image_push`                         |
| tasknotes-server                                    | `image`, `image_push`                         |
| scout-for-lol                                       | `image`, `image_push`                         |
| discord-plays-pokemon                               | `image`, `image_push`                         |
| starlight-karma-bot                                 | `image`, `image_push`                         |
| better-skill-capped/fetcher                         | `image`, `image_push`                         |
| homelab/src/{dns-audit,deps-email,ha,caddy-s3proxy} | `image`, `image_push`                         |
| tools/oci                                           | `obsidian_headless`, `obsidian_headless_push` |

---

## Phase 1: Create `bun_build` Rule

Create a single hermetic build rule that replaces both `vite_build` and `astro_build`. The implementation follows the same pattern as `bun_test` / `bun_typecheck_test`.

### New files

**`tools/rules_bun/bun/private/bun_build.bzl`** — Rule implementation

The rule:

1. Resolves `BunInfo` from deps (identical to `bun_test`)
2. Merges workspace deps (identical to `bun_test`)
3. Calls `materialize_tree` to create a hermetic TreeArtifact
4. Runs a shell action that copies the tree to a writable temp dir (Vite/Astro write `.vite/`, `.astro/`, `dist/` during build), runs the build command, and copies `dist/` to the output TreeArtifact

Key difference from test rules: this is `test = False` — it's a build rule that produces a TreeArtifact output, not a test with a launcher script. Uses `ctx.actions.run_shell` with the tree as an input.

```python
# Sketch of the build action
ctx.actions.run_shell(
    outputs = [out_dir],
    inputs = depset([tree, bun]),
    command = """
        set -euo pipefail
        BUN_DIR=$(cd "$(dirname "{bun}")" && pwd)
        export PATH="$BUN_DIR:$PATH"
        export HOME="${{TMPDIR:-/tmp}}"
        # Copy tree to writable location (Vite/Astro write during build)
        WORK=$(mktemp -d)
        trap 'rm -rf "$WORK"' EXIT
        cp -R "{tree}/{pkg_dir}/." "$WORK/"
        # Symlink node_modules from the tree (avoid copying ~100MB)
        ln -s "$(cd "{tree}/{pkg_dir}/node_modules" && pwd)" "$WORK/node_modules"
        cd "$WORK"
        {build_cmd}
        cp -r {dist_dir}/* "{out_dir}/"
    """,
    # NO execution_requirements — fully hermetic, fully cacheable
)
```

Attrs:

- `deps` (label_list, mandatory) — must provide BunInfo
- `tsconfig` (label, single file)
- `data` (label_list, allow_files) — for `public/`, content files
- `extra_files` (label_list) — for `vite.config.ts`, `astro.config.ts`, `index.html`, `postcss.config.*`, etc.
- `node_modules` (label) — aggregate npm deps
- `prisma_client` (label, single file)
- `build_cmd` (string, default `"bun run build"`)
- `dist_dir` (string, default `"dist"`)
- `env` (string_dict)
- `_hoisted_links` — `@bun_modules//:hoisted_links.sh`

**`tools/rules_bun/bun/private/BUILD.bazel`** — Add to `exports_files`

### Modified files

**`tools/rules_bun/bun/defs.bzl`** — Add public API:

```python
load("//tools/rules_bun/bun/private:bun_build.bzl", _bun_build = "bun_build")

def bun_build(node_modules = ":node_modules", **kwargs):
    _bun_build(node_modules = node_modules, **kwargs)

# Convenience aliases
def bun_vite_build(**kwargs):
    bun_build(**kwargs)

def bun_astro_build(**kwargs):
    bun_build(**kwargs)
```

---

## Phase 2: Create `bun_astro_check` Rule

Same pattern as `bun_typecheck_test` but runs `bun x astro check` instead of `tsc`.

### New files

**`tools/rules_bun/bun/private/bun_astro_check.bzl`** — Rule implementation (copy of `bun_typecheck.bzl` with different command)

**`tools/rules_bun/bun/private/bun_astro_check.sh.tpl`** — Launcher template:

```bash
#!/usr/bin/env bash
set -euo pipefail
# ... runfiles resolution (same as bun_typecheck.sh.tpl) ...
BUN="$RUNFILES/{{BUN_PATH}}"
TREE="$RUNFILES/{{TREE_PATH}}"
cd "$TREE/{{PKG_DIR}}"
exec "$BUN" x astro check "$@"
```

### Modified files

**`tools/rules_bun/bun/private/BUILD.bazel`** — Add `bun_astro_check.sh.tpl` to `exports_files`
**`tools/rules_bun/bun/defs.bzl`** — Add `bun_astro_check` to public API

---

## Phase 3: Migrate Vite Packages (6 packages)

Update each BUILD.bazel to use `bun_build` instead of `vite_build`. Start with the simplest (`hn-enhancer`) and work up.

### Order and changes

1. **`packages/hn-enhancer/BUILD.bazel`** (simplest — no workspace deps, minimal config)
   - Replace `load("//tools/bazel:vite_build.bzl", "vite_build")` → add `"bun_build"` to existing rules_bun load
   - Replace `vite_build(name = "vite_build")` with:
     ```python
     bun_build(
         name = "vite_build",
         extra_files = ["vite.config.ts", "tsconfig.json", "tsconfig.node.json", "//:tsconfig.base.json", "manifest.json"],
         data = glob(["public/**"], allow_empty = True),
         deps = [":pkg"],
     )
     ```

2. **`packages/better-skill-capped/BUILD.bazel`** (similar simplicity)
3. **`packages/discord-plays-pokemon/packages/frontend/BUILD.bazel`**
4. **`packages/sentinel/web/BUILD.bazel`** — note `dist_dir = "../dist/web"`, need to check if vite config can be adjusted or if dist_dir needs special handling
5. **`packages/scout-for-lol/packages/desktop/BUILD.bazel`** — Tauri + Vite
6. **`packages/clauderon/web/frontend/BUILD.bazel`**

For each: verify with `bazel build //packages/<name>:vite_build` after migration.

---

## Phase 4: Migrate Astro Packages (5 packages)

1. **`packages/cook-preview/BUILD.bazel`** (simplest Astro site)
   - Replace both `astro_build` and `astro_check` loads
   - Add content/data files to `data` attr, config files to `extra_files`

2. **`packages/status-page/web/BUILD.bazel`**
3. **`packages/clauderon/docs/BUILD.bazel`**
4. **`packages/scout-for-lol/packages/frontend/BUILD.bazel`**
5. **`packages/sjer.red/BUILD.bazel`** (most complex — Tailwind, PostCSS, content collections, MDX, sharp, webring workspace dep)

For each: verify with `bazel build //packages/<name>:astro_build` and `bazel test //packages/<name>:astro_check`.

---

## Phase 5: Make OCI Images Cacheable

### Modified files

**`tools/oci/bun_service_image.bzl`**:

- Remove `tags = ["manual"]` from `oci_image` target (line 114) — replace with `tags = []` or omit
- Remove `tags = ["manual"]` from `pkg_tar` targets (lines 64, 77)
- Keep `tags = ["manual", "requires-network"]` on `_bun_install_layer` genrule (line 201)
- Keep `tags = ["manual"]` on `oci_push` and `expand_template` (lines 126, 134) — push should only happen during publish

This means `bazel build //packages/birmel/...` will now include the `image` target. Bazel will transitively build the `_bun_install_layer` (even though it's `manual`) because `oci_image` depends on it. The `_push` target stays excluded from wildcards.

**No CI changes needed** — `pipeline_generator.py` already runs `bazel build //packages/{pkg}/...` which will automatically pick up the now-non-manual image targets.

### Homelab OCI images

The homelab images in `packages/homelab/src/{dns-audit,deps-email,ha,caddy-s3proxy}/BUILD.bazel` use raw `oci_image` + `oci_push` (not `bun_service_image`). These all have `tags = ["manual"]` on their image targets. Apply the same change: remove `manual` from `oci_image`, keep it on `oci_push`.

---

## Phase 6: Cleanup

- Delete `tools/bazel/vite_build.bzl`
- Delete `tools/bazel/astro_build.bzl`
- Delete `tools/bazel/astro_check.bzl`
- Verify no remaining references with `grep -r "vite_build.bzl\|astro_build.bzl\|astro_check.bzl" tools/ packages/`

---

## Risks and Mitigations

| Risk                                                  | Mitigation                                                                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vite/Astro plugins can't resolve in materialized tree | The materialized tree already places npm deps at `{pkg_dir}/node_modules/` — same path resolution as real workspace. ESLint + typecheck already work this way.                |
| Astro `astro:content` virtual modules                 | Generated during build from content files which are declared as `data`. Works as long as `.md/.mdx/.astro` files are in the tree at correct paths (they are via materialize). |
| Build needs writable directory                        | The action copies the materialized tree to a writable tmpdir before running the build. Node_modules are symlinked to avoid the copy cost.                                     |
| `sentinel/web` dist_dir = `"../dist/web"`             | May need adjustment — check if the Vite config can output to `dist/` within the package, or handle the relative path in the copy step.                                        |
| OCI image builds add CI time                          | Only runs when files change (target-determinator). `_bun_install_layer` caches on `package.json` + `bun.lock`. Subsequent runs use remote cache.                              |
| `requires-network` genrule in sandbox                 | `requires-network` execution requirement tells Bazel to allow network access for that action. Works in both local and remote execution.                                       |

---

## Verification

After each phase:

1. `bazel build //packages/hn-enhancer:vite_build` — verify Vite build succeeds in sandbox
2. `bazel build //packages/cook-preview:astro_build` — verify Astro build succeeds
3. `bazel test //packages/cook-preview:astro_check` — verify Astro check succeeds
4. `bazel build //packages/birmel:image` — verify OCI image builds without manual
5. Run a second build and verify cache hits: `bazel build //packages/hn-enhancer:vite_build` should show `(cached)`
6. Full verification: `bazel build //packages/sjer.red:astro_build //packages/better-skill-capped:vite_build //packages/birmel:image`

## Critical Files Reference

| File                                          | Role                                                              |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `tools/rules_bun/bun/private/materialize.bzl` | Reuse `materialize_tree` + `collect_all_npm_sources` (no changes) |
| `tools/rules_bun/bun/private/bun_test.bzl`    | Pattern to follow for BunInfo resolution + workspace dep merging  |
| `tools/rules_bun/bun/defs.bzl`                | Public API — add `bun_build`, `bun_astro_check`                   |
| `tools/rules_bun/bun/private/BUILD.bazel`     | Register new template files                                       |
| `tools/oci/bun_service_image.bzl`             | Remove `manual` from non-push targets                             |
| `tools/bazel/vite_build.bzl`                  | Delete after migration                                            |
| `tools/bazel/astro_build.bzl`                 | Delete after migration                                            |
| `tools/bazel/astro_check.bzl`                 | Delete after migration                                            |
