# Chunk A: Nuke Bazel

**Wave:** 1 (parallel with R, B, C)
**Agent type:** Code agent, git worktree
**Touches:** `tools/`, `scripts/ci/`, all BUILD.bazel, Bazel config, CI scripts, CLAUDE.md files, lefthook, compliance, quality-baseline, .gitignore, CI image
**Depends on:** Nothing
**Blocks:** Wave 2 (D, E, F need Bazel gone)

## Goal

Delete every Bazel artifact and the entire Python CI package from the monorepo. Update all config files that reference Bazel. No dead code remains.

## Steps

### 1. Delete tool directories

```bash
rm -rf tools/bazel/ tools/rules_bun/ tools/rules_bun2/ tools/bun/
rm -f tools/oci/*.bzl tools/oci/BUILD.bazel
```

### 2. Delete Python CI

```bash
rm -rf scripts/ci/
```

### 3. Delete all BUILD.bazel files

67 total across `.buildkite/`, `tools/`, `packages/`, `poc/`:

```bash
find . -name BUILD.bazel -not -path './node_modules/*' -not -path './.git/*' -delete
```

### 4. Delete Bazel config files

```bash
rm -f .bazelversion .bazelrc .bazelignore MODULE.bazel
```

### 5. Delete Bazel CI scripts

```bash
rm -f .buildkite/scripts/bazel-phase.sh
rm -f .buildkite/scripts/bazel-test-targets.sh
rm -f .buildkite/scripts/bazel-package.sh
rm -f .buildkite/scripts/buildifier.sh
```

### 6. Delete Bazel package scripts

```bash
rm -f packages/glance/scripts/bazel-build.sh
rm -f packages/glance/scripts/bazel-test.sh
rm -f packages/glance/scripts/bazel-lint.sh
```

### 7. Delete bazel-remote K8s infrastructure

```bash
rm -f packages/homelab/src/cdk8s/src/resources/argo-applications/bazel-remote.ts
rm -f packages/homelab/src/cdk8s/src/cdk8s-charts/bazel-remote.ts
rm -f packages/homelab/src/cdk8s/dist/bazel-remote.k8s.yaml
```

Also remove `bazel-remote` from HELM_CHARTS list if referenced in any remaining code.

### 8. Update .gitignore

Remove lines: `bazel-bin`, `bazel-out`, `bazel-testlogs`, `bazel-monorepo`

### 9. Update .buildkite/ci-image/Dockerfile

- Remove Bazelisk install (~5 lines)
- Remove target-determinator install (~5 lines)
- Remove `.bazelversion` copy
- Add `dagger` CLI install (curl from dagger.io)
- Bump `.buildkite/ci-image/VERSION`

### 10. Update lefthook.yml

- Remove `buildifier` hook (lines ~215-222)
- Remove `cargo-deny` job that references `bazel test` (line ~261)
- Remove any `.bzl` glob patterns from other hooks

### 11. Update scripts/compliance-check.sh

- Remove the check that requires `BUILD.bazel` in each package

### 12. Update .quality-baseline.json

- Remove `hermeticity-exempt` entries that reference Bazel runner scripts being deleted

### 13. Update .buildkite/scripts/setup-tools.sh

- Remove `install_bazel()` and `install_target_determinator()` functions
- Remove version constants for Bazelisk and target-determinator

### 14. Update mise.toml

- Remove `bazelisk` or `bazel` tool entries if present

### 15. Update 5 CLAUDE.md files

For each, remove all Bazel commands, conventions, debugging sections:

- `/CLAUDE.md` (root) — remove "Bazel Debugging" and "Bazel Conventions" sections, update "Commands" section
- `packages/clauderon/CLAUDE.md`
- `packages/homelab/CLAUDE.md`
- `packages/resume/CLAUDE.md`
- `packages/scout-for-lol/CLAUDE.md`

### 16. Verify

```bash
# Zero Bazel files remain
find . -name '*.bzl' -o -name 'BUILD.bazel' -o -name '.bazelrc' -o -name '.bazelversion' | grep -v node_modules | grep -v .git
# Should output nothing

# Zero Python CI files remain
ls scripts/ci/ 2>/dev/null
# Should fail or be empty

# Grep for stale references
grep -r 'bazel' --include='*.ts' --include='*.sh' --include='*.yml' --include='*.md' . \
  | grep -v node_modules | grep -v .git | grep -v archive | grep -v docs/decisions | grep -v docs/plans
# Review — only historical docs should remain
```

## Definition of Done

- [ ] Zero `BUILD.bazel` files anywhere in repo
- [ ] Zero `.bzl` files anywhere in repo
- [ ] No `.bazelrc`, `.bazelversion`, `.bazelignore`, `MODULE.bazel`
- [ ] `tools/{bazel,rules_bun,rules_bun2,bun}/` deleted
- [ ] `scripts/ci/` (Python) deleted
- [ ] CI image Dockerfile updated (no Bazel, has Dagger CLI)
- [ ] `lefthook.yml` has no buildifier or bazel references
- [ ] `compliance-check.sh` doesn't require BUILD.bazel
- [ ] All 5 CLAUDE.md files updated
- [ ] `grep -r bazel` shows only historical docs/decisions, no active code
- [ ] `bun install` still works (no broken imports)

## Success Criteria

The repo has zero active Bazel code. `bun install` works. No broken imports or references to deleted files.
