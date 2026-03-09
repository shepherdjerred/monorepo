# Dirty Working Tree State (2026-03-08)

Status snapshot of uncommitted local changes that affect Bazel builds.

## Problem

`bazel test //...` and `bazel build //...` fail locally because MODULE.bazel references `//tools/rules_bun/bun:extensions.bzl` — a WIP `rules_bun` migration that exists only as untracked files, not committed code.

Error:
```
ERROR: Analysis of target '//.buildkite:shellcheck' failed; build aborted:
Error loading '//tools/rules_bun/bun:extensions.bzl' for module extensions,
requested by MODULE.bazel:127:26: Label '//tools/rules_bun/bun:extensions.bzl'
is invalid because 'tools/rules_bun/bun' is not a package
```

## Root Cause

36 uncommitted files spanning two separate efforts:

### 1. WIP `rules_bun` migration (breaks builds)
- `MODULE.bazel` lines 123-143: adds `rules_bun` extension + toolchain registration
- `tools/rules_bun/` (untracked): custom Bun Bazel rules with `bun_library`, `bun_binary`, `bun_typecheck_test`
- `packages/tools/BUILD.bazel`: references `bun_typecheck_test` from `rules_bun`
- Various `tools/bazel/*.bzl` and runner scripts: refactored to use new shared helpers

### 2. Misc BUILD.bazel / CI cleanups (safe)
- Various `packages/*/BUILD.bazel`: minor additions (shellcheck, extra deps)
- `tools/bazel/shellcheck.bzl` deleted (replaced by `rules_shellcheck`)
- `scripts/ci/` changes: buildkite helper extraction, minor refactors
- `.buildkite/scripts/` additions: `knip.sh`, `typeshare-check.sh`

## Affected Files (key ones)

| File | Change | Impact |
|------|--------|--------|
| `MODULE.bazel` | Adds `rules_bun` extension | **Breaks all builds** |
| `tools/rules_bun/**` | New untracked files | Required by MODULE.bazel |
| `tools/bazel/bun_test_runner.sh` | 200+ lines removed | Major refactor |
| `tools/bazel/typecheck_runner.sh` | 200+ lines removed | Major refactor |
| `tools/bazel/bun_package.bzl` | Deleted | Replaced by rules_bun |
| `tools/bazel/shellcheck.bzl` | Deleted | Replaced by rules_shellcheck |

## Resolution Options

1. **Stash all uncommitted changes** (`git stash`) — restores clean committed state, all Bazel commands work
2. **Finish the rules_bun migration** — commit the untracked `tools/rules_bun/` and updated MODULE.bazel together
3. **Revert just the MODULE.bazel rules_bun lines** — removes the broken reference while keeping other changes

## What's Actually Committed and Working

The committed code (HEAD at `de2341492`) includes the Docker-to-Bazel migration:
- 4 new OCI image targets: `dns-audit`, `caddy-s3proxy`, `ha`, `deps-email`
- `git_layer` and `helm_layer` genrules
- GHCR auth via config.json (no Docker CLI)
- CI scripts updated to use `bazel.run_capture()` instead of `docker build/push`

These all built successfully before the dirty state was introduced.
