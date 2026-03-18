# Phase 3: Drop rules_js — Fully Bun-Native Bazel

## Status: ~95% complete (2026-03-10)

### What's done

- All `@aspect_rules_js`, `@aspect_rules_ts`, `rules_nodejs` imports removed from MODULE.bazel
- All BUILD files migrated to bun-native rules (`bun_library`, `bun_test`, `bun_eslint_test`, `bun_typecheck_test`, etc.)
- Custom `BunInfo` provider and `rules_bun` rules handle everything
- `@bun_modules` repository rule: `bun install` → per-package filegroups + `bun_link_all_packages` macro

### Architecture: .bun/ store structure

Bun installs packages into `node_modules/.bun/<key>/node_modules/<pkg>/` with version-specific keys. Each entry contains the primary package as real files and deps as symlinks to other entries.

**Key design decisions:**

- **Preserve .bun/ structure** in materialized trees (not flat `node_modules/<pkg>/`)
- **Per-package filegroups** with multi-version globs (e.g., `wrap-ansi` globs all 4 version entries)
- **Inter-entry dep symlinks** recreated by `hoisted_links.sh` with existence checks
- **Top-level hoisted symlinks** for standard `node_modules/<pkg>` resolution
- **Per-workspace dep lists** to keep materialized trees small (~400-600 packages vs 2776 total)
- **Targeted .d.ts dereference** — only dereference `.d.ts`/`.d.mts`/`.d.cts` symlinks pointing outside tree; runtime JS symlinks stay intact for correct version resolution

### Files

| File                                          | Purpose                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `tools/rules_bun/bun/private/bun_install.bzl` | Repository rule: `bun install`, lockfile parsing, BUILD/defs generation |
| `tools/rules_bun/bun/private/materialize.bzl` | TreeArtifact builder: copies sources + npm files, runs hoisted_links.sh |
| `tools/rules_bun/bun/providers.bzl`           | `BunInfo` provider definition                                           |
| `tools/rules_bun/bun/extensions.bzl`          | MODULE.bazel extension for `bun_modules`                                |

### Fixed issues (this session)

1. **Alias dep symlinks** — `wrap-ansi-cjs`, `string-width-cjs`, `strip-ansi-cjs` are bun alias names (not real packages). Fixed by:
   - Detecting aliases in `_MAP_PACKAGES_SCRIPT` where dep_name ≠ target primary
   - Using real package name in symlink target path
   - Including real package in transitive dep closure when alias is encountered

2. **Dangling dep symlinks** — per-workspace deps mean not all packages are materialized. Fixed by adding per-dep existence check (`[ -d "$NM_DIR/<target>" ] &&`) before creating each symlink.

3. **Missing eslint-config dep** — 18 packages import `@shepherdjerred/eslint-config` without declaring it as a dependency. Fixed by adding `"@shepherdjerred/eslint-config": "workspace:*"` to each package's devDependencies.

### Verified passing

- `//packages/tools:lint` — PASSED
- `//packages/tools:typecheck` — PASSED
- `//packages/birmel:lint` — PASSED
- `//packages/birmel:typecheck` — PASSED

### Remaining work

1. **Run full `bazel test //...`** — verify all ~55 targets pass. Materialization is slow (~1-5 min per target due to ~80k per-file copies).

2. **Prisma generate** — 4 prisma targets may still fail. Check `bun_prisma_generate` rule against new `.bun/` tree structure.

3. **Performance optimization** — materialization uses per-file `cp -f` for ~80k files per workspace. Consider:
   - Batch copying with `tar`/`cpio`
   - Hardlinks (`cp -l`) instead of copies
   - Further per-workspace dep pruning

4. **Cleanup** — after all tests pass:
   - Delete `pnpm-lock.yaml`
   - Remove `pnpm_workspace` attr from `bun_install`
   - Follow `remove-node-npm-pnpm-deps.md` plan

### How per-workspace deps work

```
_PARSE_LOCK_SCRIPT → { workspaceDeps: { "packages/tools": ["eslint", "zod", ...], ... },
                        workspaceRefs: { "packages/tools": ["packages/eslint-config"], ... } }

_MAP_PACKAGES_SCRIPT → { bunKeys, npmDeps, allKeysByPkg, entryDeps, aliasToReal }

_compute_ws_deps(ws_path):
  1. Follow workspace refs transitively (A→B→C)
  2. Collect npm deps from all transitive workspace refs
  3. Add root workspace deps (always included)
  4. Compute npm transitive closure (follow npmDeps graph)
  5. Resolve aliases (wrap-ansi-cjs → also include wrap-ansi)
```

Each workspace gets ~400-600 packages instead of all 2776. The `bun_link_all_packages` macro uses longest-prefix match to find the right workspace dep set for sub-packages.

### How hoisted_links.sh works

```bash
# Inter-entry dep symlinks (grouped by entry, with existence checks)
if [ -d "$NM_DIR/.bun/<entry_key>/node_modules/<primary>" ]; then
  [ -d "$NM_DIR/.bun/<dep_key>/node_modules/<dep_pkg>" ] && \
    ln -sf "../../<dep_key>/node_modules/<dep_pkg>" "$NM_DIR/.bun/<entry_key>/node_modules/<dep_name>"
fi

# Top-level hoisted symlinks
if [ -d "$NM_DIR/.bun/<key>/node_modules/<pkg>" ]; then
  ln -sf ".bun/<key>/node_modules/<pkg>" "$NM_DIR/<pkg>"
fi
```
