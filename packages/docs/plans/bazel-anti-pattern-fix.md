# Bazel Anti-Pattern Fix Plan

## Context

Deep audit found 55 anti-patterns across the monorepo's Bazel setup. This plan addresses all of them in 7 implementation phases, ordered by dependency and risk. Each phase can be verified independently before proceeding to the next.

---

## Phase 1: Quick Config Wins (no code logic changes)

**Goal:** Fix trivial config issues that can't break anything.

| # | File | Change |
|---|------|--------|
| 43 | `tools/bazel/workspace_status.sh:1` | Change `#!/bin/bash` → `#!/usr/bin/env bash` |
| 44 | `.bazelrc` | Remove duplicate `build:ci --remote_local_fallback` |
| 45 | `.bazelrc` | Remove `build --incompatible_disallow_empty_glob` (default in Bazel 8) |
| 48 | `.bazelignore` | Remove dead `.dagger` entry |
| 34 | `packages/sentinel/BUILD.bazel` | Remove `"requires-network"` from typecheck tags (redundant with `manual`) |
| 30 | `packages/monarch/BUILD.bazel`, `packages/starlight-karma-bot/BUILD.bazel` | Change `bun-types` → `@types/bun` in typecheck deps |
| 15 | `MODULE.bazel` | Add `"//packages/cooklang-for-obsidian:package.json"` to `npm_translate_lock` data list |

**Verify:** `bazel build //...` and `bazel test //...` still pass (55/55 green).

---

## Phase 2: Dead Code Cleanup

**Goal:** Remove unused code that creates confusion and maintenance burden.

| # | File | Change |
|---|------|--------|
| 8 | `tools/bazel/bazel_sandbox_common.sh` | Delete file (257 lines, never sourced, not in exports_files) |
| 54 | `tools/bazel/prisma.bzl` | Delete file (legacy, superseded by `bun_prisma_generate`) |
| 36 | `tools/bazel/typecheck.bzl:52-92` | Delete `workspace_typecheck_test` function (no callers) |

**Verify:** `bazel build //...` passes. Grep for deleted filenames to confirm zero references.

---

## Phase 3: Core rules_bun Fixes (Critical correctness)

**Goal:** Fix the 6 critical bugs in the custom rule framework. These are interdependent and should be done together.

### 3a. Fix `readlink -f` on macOS (`materialize.bzl`)
**File:** `tools/rules_bun/bun/private/materialize.bzl` — `_MATERIALIZE_SCRIPT` string

Replace `target=$(readlink -f "$link" 2>/dev/null) || continue` with a portable `_realpath` shell function:
```bash
_realpath() {
    local target="$1"
    local dir base
    while [ -L "$target" ]; do
        dir=$(dirname "$target")
        target=$(readlink "$target")
        case "$target" in /*) ;; *) target="$dir/$target" ;; esac
    done
    dir=$(dirname "$target")
    base=$(basename "$target")
    echo "$(cd -P "$dir" 2>/dev/null && pwd)/$base"
}
```

### 3b. Fix multiple BunInfo deps dropped (`bun_test.bzl`, `bun_typecheck.bzl`, `bun_binary.bzl`)
**Files:** `tools/rules_bun/bun/private/bun_test.bzl:10-16`, `tools/rules_bun/ts/private/bun_typecheck.bzl:10-16`, `tools/rules_bun/bun/private/bun_binary.bzl:10-16`

Replace the `break`-after-first pattern with the merge pattern from `bun_eslint_test.bzl`:
```python
bun_info = None
extra_workspace_deps = []
for dep in ctx.attr.deps:
    if BunInfo in dep:
        if bun_info == None:
            bun_info = dep[BunInfo]
        else:
            extra_workspace_deps.append(dep[BunInfo])
if not bun_info:
    fail("No dep provides BunInfo")

if extra_workspace_deps:
    merged_ws = depset(extra_workspace_deps, transitive = [bun_info.workspace_deps])
    merged_npm = depset(transitive = [bun_info.npm_sources] + [d.npm_sources for d in extra_workspace_deps])
    bun_info = BunInfo(
        target = bun_info.target, sources = bun_info.sources,
        package_json = bun_info.package_json, package_name = bun_info.package_name,
        transitive_sources = bun_info.transitive_sources, npm_sources = merged_npm,
        npm_package_store_infos = bun_info.npm_package_store_infos, workspace_deps = merged_ws,
    )
```

### 3c. Fix transitive data files lost (`bun_library.bzl`)
**File:** `tools/rules_bun/bun/private/bun_library.bzl:10`

Change `sources = depset(ctx.files.srcs)` → `sources = depset(ctx.files.srcs + ctx.files.data)` so data files flow through `BunInfo.sources` into `materialize_tree`.

### 3d. Fix workspace dep npm_sources missing from inputs (`materialize.bzl`)
**File:** `tools/rules_bun/bun/private/materialize.bzl:210-213`

Add `inputs.extend(ws_dep.npm_sources.to_list())` inside the workspace deps loop.

### 3e. Fix TreeArtifact mutation — move Prisma dereference into materialize action
**Files:** `tools/rules_bun/bun/private/materialize.bzl`, `bun_eslint_test.sh.tpl`, `bun_typecheck.sh.tpl`

1. Pass `ctx.label.package` as 3rd arg to materialize script
2. Add Prisma dereference block at end of `_MATERIALIZE_SCRIPT` (after `.d.ts` dereference):
```bash
if [ -d "$OUT_DIR/$PKG_DIR/node_modules/.prisma/client" ] && [ -d "$OUT_DIR/$PKG_DIR/node_modules/@prisma/client" ]; then
    TMP_PRISMA=$(mktemp -d)
    cp -RL "$OUT_DIR/$PKG_DIR/node_modules/@prisma/client" "$TMP_PRISMA/"
    rm -rf "$OUT_DIR/$PKG_DIR/node_modules/@prisma/client"
    mv "$TMP_PRISMA/client" "$OUT_DIR/$PKG_DIR/node_modules/@prisma/client"
    rm -rf "$TMP_PRISMA"
fi
```
3. Delete the Prisma dereference blocks (lines 17-24) from both `bun_eslint_test.sh.tpl` and `bun_typecheck.sh.tpl`

### 3f. Fix `env` attr silently ignored (`bun_test.bzl`, `bun_binary.bzl`)
**Files:** `tools/rules_bun/bun/private/bun_test.bzl`, `bun_test.sh.tpl`, `bun_binary.bzl`, `bun_binary.sh.tpl`

In each `.bzl`, generate env exports:
```python
env_vars = "\n".join(["export %s=%s" % (k, v) for k, v in ctx.attr.env.items()])
```
Add `"{{ENV_VARS}}": env_vars` to substitutions. In each `.sh.tpl`, add `{{ENV_VARS}}` before the `exec` line.

### 3g. Fix mutable default args (`materialize.bzl`)
**File:** `tools/rules_bun/bun/private/materialize.bzl:169`

Change `extra_files = []` → `extra_files = None`, `data_files = []` → `data_files = None`. Add guards inside function body.

**Verify:** `bazel test //...` passes (55/55 green). Run `bazel test //packages/birmel:lint //packages/sentinel:lint` to verify Prisma dereference works.

---

## Phase 4: Shell Script & Hermiticity Fixes

**Goal:** Fix non-hermetic patterns and improve error handling in shell scripts.

| # | File | Change |
|---|------|--------|
| 7 | `tools/bazel/bun_test_runner.sh:38` | Replace `python3 -c "import os,sys; ..."` with `"$BUN_BINARY" -e "console.log(require('fs').realpathSync(...))"` |
| 10 | `tools/bazel/semgrep_runner.sh:17-21` | Add `--exclude node_modules --exclude .aspect_rules_js --exclude "*.d.ts"` |
| 11 | `tools/bazel/vite_build.bzl:26`, `astro_build.bzl:25`, `astro_check.bzl:27` | Remove `/usr/local/bin` from PATH exports |
| 19 | `tools/bazel/workspace_status.sh` | Add `set -euo pipefail`, wrap git commands with `\|\| echo "unknown"` fallbacks |
| 9 | `tools/oci/BUILD.bazel:29-34` | Remove `2>/dev/null` from apt-get commands, add `test -f $$TMPDIR/root/usr/bin/git` validation |
| 18 | `tools/bazel/hermeticity_check.sh` | (a) Change exemption check from file-level to per-line (b) Extend `.bzl` scanning to `tools/oci/` and `tools/rules_bun/` |
| 20 | `tools/bazel/jscpd_runner.sh`, `knip_runner.sh` | Add `# hermeticity-exempt: bunx downloads at runtime` comments |
| 21 | `tools/rules_bun/bun/private/bun_prisma_generate.bzl:22-25` | Remove `\|\| true` and `2>/dev/null`, add proper error messages |
| 27 | `tools/oci/obsidian_headless.bzl:24-38` | Add `local = True` and `# hermeticity-exempt:` comment |
| 49 | Runner scripts with `PRISMA_TMPDIR` | Add `trap 'rm -rf "$PRISMA_TMPDIR"' EXIT` |
| 40 | `tools/rules_bun/bun/private/bun_test.sh.tpl:18` | Add `-path '*/node_modules/*' -prune -o` to find command |
| 29 | `tools/bazel/typecheck_runner.sh:127-145` | Add `normalize_pkg_name()` for scoped packages in `DEV_PEER_LINKS` glob |

**Verify:** `bazel test //...` passes. Run hermeticity check: `bazel test //tools/bazel:hermeticity_check`.

---

## Phase 5: Version & Toolchain Consolidation

**Goal:** Deduplicate version constants and reduce maintenance burden.

### 5a. Shared Bun version constants
Create `tools/bun/versions.bzl`:
```python
BUN_DEFAULT_VERSION = "1.3.9"
BUN_SHA256 = { ... }  # single source of truth
```
Update `tools/bun/repositories.bzl`, `tools/bun/extensions.bzl`, `tools/rules_bun/bun/repositories.bzl`, `tools/rules_bun/bun/extensions.bzl` to import from it.

### 5b. Shared Prisma version constant
Create `tools/rules_bun/bun/private/prisma_versions.bzl`:
```python
PRISMA_DEFAULT_VERSION = "6.19.2"
```
Update `bun_prisma_generate.bzl` to import it. Pass as `PRISMA_FALLBACK_VER` env var to runner scripts.

### 5c. Simplify stamp substitution
Create `tools/oci/git_sha_tag.tmpl` containing `{{STABLE_GIT_SHA}}`. Update `bun_service_image.bzl` to use it directly with `expand_template`, removing the intermediate genrule.

### 5d. Sync BunToolchainInfo provider
Update inlined provider in `tools/rules_bun/bun/repositories.bzl:42-45` to add `doc` field matching `toolchain.bzl`.

### 5e. Add comments for duplicate config_settings
Add cross-reference comments in both `tools/bun/BUILD.bazel` and `tools/rules_bun/bun/BUILD.bazel`.

**Verify:** `bazel build //...` passes. `bazel test //...` passes.

---

## Phase 6: BUILD.bazel Fixes & Manual Target Unblocking

### 6a. Exclude test files from bun_library srcs (10 packages)
Add `exclude = ["src/**/*.test.ts", "src/**/*.spec.ts"]` to `bun_library` glob in:
- `packages/birmel/BUILD.bazel`
- `packages/bun-decompile/BUILD.bazel`
- `packages/clauderon/web/client/BUILD.bazel`
- `packages/discord-plays-pokemon/packages/backend/BUILD.bazel`
- `packages/homelab/src/helm-types/BUILD.bazel`
- `packages/monarch/BUILD.bazel`
- `packages/scout-for-lol/packages/backend/BUILD.bazel`
- `packages/scout-for-lol/packages/data/BUILD.bazel`
- `packages/tasknotes-server/BUILD.bazel`
- `packages/better-skill-capped/BUILD.bazel`

### 6b. Remove `manual` tag from lint targets (11 targets)
Remove `"manual"` from tags and add comment if needed:
- `packages/homelab/src/ha:lint`
- `packages/sentinel/web:lint`
- `packages/status-page/web:lint`
- `packages/discord-plays-pokemon/packages/backend:lint`
- `packages/scout-for-lol/packages/data:lint`
- `packages/scout-for-lol/packages/frontend:lint`
- `packages/scout-for-lol/packages/desktop:lint`
- `packages/scout-for-lol/packages/report:lint`
- `packages/scout-for-lol/packages/ui:lint`
- `packages/clauderon/web/client:lint`
- `packages/clauderon/web/frontend:lint`

### 6c. Remove `manual` tag from typecheck/test targets (5 targets)
- `packages/homelab/src/helm-types:typecheck`
- `packages/homelab/src/helm-types:test`
- `packages/homelab/src/deps-email:typecheck`
- `packages/clauderon/web/client:typecheck`
- `packages/clauderon/web/frontend:typecheck`

### 6d. Add missing lint target
- `packages/better-skill-capped/fetcher/BUILD.bazel` — add `bun_eslint_test`

### 6e. Add missing test sizes
- Add `size = "large"` to Prisma-related typecheck/test targets
- Add `size = "small"` to fast library tests without size declaration

### 6f. Add explanatory comments to remaining manual targets
For each target that stays manual, add a `# Manual: <reason>` comment.

**Verify:** `bazel test //...` — target count should increase from 55 to ~71 (16 newly unblocked). All must pass green.

---

## Phase 7: Remaining Improvements

**Goal:** Address remaining low-severity issues.

| # | File | Change |
|---|------|--------|
| 22 | `tools/rules_bun/bun/private/bun_binary.bzl` | Add `prisma_client` attr, pass to `materialize_tree` |
| 23 | `tools/oci/BUILD.bazel:53-65` | Add comment "Container layer: always linux/amd64" to helm_layer |
| 24 | `tools/oci/bun_service_image.bzl:204` | Add `"requires-network"` to `_bun_install_layer` genrule tags |
| 25 | `tools/oci/bun_service_image.bzl` | Add default `org.opencontainers.image.source` label |
| 28 | `tools/rules_bun/bun/private/materialize.bzl:99-106` | Add docstring warning that scoped packages must set `package_name` |
| 32 | `packages/eslint-config/BUILD.bazel` | Add comment explaining why `dist/` is in srcs |
| 37 | `tools/bazel/hermeticity_check.sh` | Already covered in Phase 4 |
| 38 | `tools/bun/BUILD.bazel`, `tools/rules_bun/bun/BUILD.bazel` | Already covered in Phase 5 |
| 41 | `tools/rules_bun/bun/private/materialize.bzl` | Extract `_MATERIALIZE_SCRIPT` to `materialize.sh` source file |
| 47 | Root `BUILD.bazel` | Investigate which tsconfig target to remove; consolidate |
| 50 | `tools/rules_bun/bun/private/bun_eslint_test.bzl:81` | Add `providers` constraint to `node_modules` attr |
| 51 | `tools/oci/bun_service_image.bzl:193` | Remove `2>/dev/null` from primary tar attempt |
| 55 | `tools/rules_bun/bun/private/bun_eslint_test.sh.tpl:26` | Replace hardcoded `src/` with `{{ESLINT_TARGET}}` template var (default `.`) |

**Verify:** `bazel build //...` and `bazel test //...` pass. Full target count stable.

---

## Verification Plan

After each phase:
1. `bazel build //...` — all build targets pass
2. `bazel test //...` — all test targets pass (count should increase in Phase 6)
3. `bazel test //tools/bazel:hermeticity_check` — hermeticity check passes (after Phase 4)
4. `bazel test //tools/bazel:shellcheck` — shellcheck passes on all runner scripts

Final verification:
- `bazel test //...` with expected target count ~71 (up from 55)
- Spot-check on macOS: verify `.d.ts` dereference works (Phase 3a fix)
- Spot-check: `birmel:test` env vars are actually set (Phase 3f fix)

---

## Phase 8: Prevention — Automated Guards Against Recurrence

**Goal:** Add CI checks, lefthook hooks, and validation scripts so these anti-patterns can't silently reappear.

### 8a. New Bazel lint test: `bazel_lint_check` (`tools/bazel/bazel_lint_check.sh`)

A new `sh_test` target that catches structural anti-patterns in BUILD.bazel and .bzl files. Runs in CI alongside hermeticity_check and shellcheck.

**Checks to implement:**

| Check | What it catches | How |
|-------|----------------|-----|
| Test files in library srcs | Issue 16 recurrence | `grep -r 'bun_library' BUILD.bazel` files, then verify globs have `exclude.*test` |
| Manual tags without comments | Issue 26 recurrence | For each `tags = [.*"manual"` in BUILD.bazel, verify preceding line has `# Manual:` comment |
| `readlink -f` in shell scripts/bzl | Issue 2 recurrence | `grep -rn 'readlink -f' tools/` — must be zero |
| `python3` in runner scripts | Issue 7 recurrence | `grep -rn 'python3' tools/bazel/*_runner.sh` — must be zero |
| `bun-types` instead of `@types/bun` | Issue 30 recurrence | `grep -rn 'bun-types' packages/*/BUILD.bazel` — must be zero |
| `|| true` in Prisma generate | Issue 21 recurrence | `grep -n '|| true' tools/rules_bun/bun/private/bun_prisma_generate.bzl` — must be zero |
| `/usr/local/bin` in .bzl PATH | Issue 11 recurrence | `grep -rn '/usr/local/bin' tools/**/*.bzl` — must be zero |
| Missing `npm_translate_lock` entry | Issue 15 recurrence | Compare workspace package.json files vs MODULE.bazel data list |

**Files:**
- Create `tools/bazel/bazel_lint_check.sh`
- Add `sh_test` target in `tools/bazel/BUILD.bazel` with tag `lint`
- Add to CI pipeline: `//tools/bazel:bazel_lint_check`

### 8b. Extend hermeticity_check.sh scope (already in Phase 4)

The Phase 4 changes to `hermeticity_check.sh` already extend scanning to `tools/oci/*.bzl` and `tools/rules_bun/**/*.bzl`, and make exemptions per-line instead of per-file. This prevents issues 8, 11, 27 from recurring.

### 8c. Update quality ratchet for new hermeticity-exempt entries

After adding `# hermeticity-exempt:` comments to `jscpd_runner.sh` and `knip_runner.sh` (Phase 4), update `.quality-baseline.json` to pin these counts:
```json
"hermeticity-exempt": {
    "tools/bazel/cargo_deny_runner.sh": 1,
    "tools/bazel/semgrep_runner.sh": 1,
    "tools/bazel/jscpd_runner.sh": 1,
    "tools/bazel/knip_runner.sh": 1
}
```
The existing quality ratchet (`scripts/quality-ratchet.ts` + `scripts/ci/src/ci/lib/quality.py`) will then block any NEW hermeticity exemptions from being added without updating the baseline.

### 8d. Lefthook pre-commit: validate new BUILD.bazel files

Add to `lefthook.yml` tier 1c (staged linting, parallel):
```yaml
bazel-lint-check:
  glob: "**/{BUILD.bazel,*.bzl,MODULE.bazel}"
  run: |
    # Quick checks on staged Bazel files
    if grep -l 'bun-types' {staged_files} 2>/dev/null; then
      echo "ERROR: Use @types/bun instead of bun-types" >&2; exit 1
    fi
    if grep -l 'readlink -f' {staged_files} 2>/dev/null; then
      echo "ERROR: readlink -f is not portable (macOS). Use a POSIX realpath function." >&2; exit 1
    fi
    if grep -l '/usr/local/bin' {staged_files} 2>/dev/null; then
      echo "ERROR: /usr/local/bin in PATH breaks hermiticity" >&2; exit 1
    fi
```

### 8e. Lefthook pre-commit: validate shell scripts for python3

Add to `lefthook.yml` tier 1c:
```yaml
no-system-python:
  glob: "tools/bazel/*_runner.sh"
  run: |
    if grep -n 'python3' {staged_files} 2>/dev/null; then
      echo "ERROR: Use hermetic $BUN_BINARY instead of system python3 in runner scripts" >&2; exit 1
    fi
```

### 8f. Compliance check: verify npm_translate_lock data list

Extend `scripts/ci/src/ci/lib/compliance.py` to verify that every workspace package with a `BUILD.bazel` that calls `npm_link_all_packages` has its `package.json` listed in the `npm_translate_lock` data list in `MODULE.bazel`. This prevents issue 15 (cooklang-for-obsidian missing) from recurring when new packages are added.

### 8g. Buildifier enforcement (already exists)

Buildifier already runs in both pre-commit (`buildifier --lint=fix`) and CI (`buildifier.sh` with hermetic binary). This catches Starlark style issues like mutable default args (issue 52) automatically — buildifier's `--lint=fix` mode rewrites these. No additional action needed, but verify buildifier catches the specific patterns.

### 8h. Documentation: add CLAUDE.md notes for Bazel contributors

Add a "Bazel Conventions" section to the root `CLAUDE.md` documenting:
- Always use `@types/bun`, never `bun-types`
- `bun_library` globs must exclude `*.test.ts` and `*.spec.ts`
- Manual tags require a `# Manual: <reason>` comment
- Never use `readlink -f` (not portable) — use POSIX shell realpath or `$BUN_BINARY`
- Never use `python3` in runner scripts — use `$BUN_BINARY`
- Never add `/usr/local/bin` to PATH in .bzl files
- New workspace packages must be added to `npm_translate_lock` data list in MODULE.bazel
- Version constants (Bun, Prisma) have a single source of truth in `versions.bzl` files

### Prevention Coverage Matrix

| Anti-pattern category | Lefthook | CI (Bazel test) | CI (compliance) | Quality ratchet | Buildifier | CLAUDE.md |
|----------------------|----------|-----------------|-----------------|----------------|------------|-----------|
| Non-portable shell (`readlink -f`) | yes | yes (bazel_lint_check) | — | — | — | yes |
| System python3 in runners | yes | yes (bazel_lint_check) | — | — | — | yes |
| `bun-types` instead of `@types/bun` | yes | yes (bazel_lint_check) | — | — | — | yes |
| `/usr/local/bin` in .bzl PATH | yes | yes (bazel_lint_check) | — | — | — | yes |
| Test files in library srcs | — | yes (bazel_lint_check) | — | — | — | yes |
| Manual tags without comments | — | yes (bazel_lint_check) | — | — | — | yes |
| Missing npm_translate_lock entry | — | — | yes (compliance) | — | — | yes |
| New hermeticity exemptions | — | yes (hermeticity_check) | — | yes (ratchet) | — | — |
| New lint suppressions (eslint/ts) | yes (check-suppressions) | — | — | yes (ratchet) | — | — |
| Starlark style (mutable defaults) | yes (buildifier) | yes (buildifier CI) | — | — | yes | — |
| Non-hermetic tool access | — | yes (hermeticity_check) | — | yes (ratchet) | — | — |
| Missing BUILD.bazel for packages | — | — | yes (compliance) | — | — | — |

---

## Files Modified Summary

| Phase | Files touched | New files |
|-------|--------------|-----------|
| 1 | 6 | 0 |
| 2 | 3 deleted | 0 |
| 3 | 8 | 0 |
| 4 | 12 | 0 |
| 5 | 6 | 3 (`versions.bzl`, `prisma_versions.bzl`, `git_sha_tag.tmpl`) |
| 6 | ~25 BUILD.bazel | 0 |
| 7 | 10 | 1 (`materialize.sh`) |
| **Total** | **~70** | **4** |
