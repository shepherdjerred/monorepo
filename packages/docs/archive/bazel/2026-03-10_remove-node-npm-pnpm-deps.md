# Plan: Remove all node/npm/pnpm dependencies — Bun only

## Status: ~95% Complete (2026-03-19)

Items 1-7, 9-11 are complete. Items 8 (obsidian-headless), 12-15 are minor remaining work or accepted as-is.

## Context

The monorepo should have zero dependencies on node, npm, or pnpm. Bun is the only JS runtime/package manager. `node_modules/` directories are fine (Bun uses them). `practice/` directory is excluded from scope.

Exceptions (with comments explaining why):

- React Native packages (`tasks-for-obsidian`, `clauderon/mobile`) — Metro bundler requires Node ([oven-sh/bun#25870](https://github.com/oven-sh/bun/issues/25870))
- Prisma build rule `node` symlink — `prisma generate` hangs without a `node` binary ([prisma/prisma#26560](https://github.com/prisma/prisma/issues/26560))

---

## Changes

### 1. CI: Claude Code → native binary installer

**Files:** `.buildkite/scripts/code-review.sh`, `.buildkite/scripts/code-review-interactive.sh`

Replace:

```bash
install_node
bun add -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
```

With:

```bash
curl -fsSL https://claude.ai/install.sh | bash -s "${CLAUDE_CODE_VERSION}"
export PATH="$HOME/.local/bin:$PATH"
```

### 2. CI: release.sh — drop install_node

**File:** `.buildkite/scripts/release.sh`

Remove `install_node` call. `release-please` is pure JS and is already installed via `bun add -g` — it should work under Bun's Node compat. Add a comment noting this.

### 3. CI: Remove install_node function

**File:** `.buildkite/scripts/setup-tools.sh`

Delete the `install_node()` function entirely (lines 133-141).

### 4. CI Docker image: Remove Node.js installation

**File:** `.buildkite/ci-image/Dockerfile`

Remove the nodesource Node.js 22 installation block (lines 65-68).

### 5. Remove pnpm-lock.yaml and pnpm-workspace.yaml

**Files:** `pnpm-lock.yaml`, `pnpm-workspace.yaml`

Delete both files. They are not referenced by any active Bazel rule (`bun_install.bzl` parses `bun.lock` only). The `pnpm_workspace` attr in `bun_install.bzl` is documented as "temporary, for transition."

### 6. Bazel: Remove pnpm_workspace references

**Files:**

- `MODULE.bazel` — remove `pnpm_workspace = "//:pnpm-workspace.yaml"` (line ~170)
- `BUILD.bazel` (root) — remove `"pnpm-workspace.yaml"` from `exports_files`
- `tools/rules_bun/bun/extensions.bzl` — remove `pnpm_workspace` attr and passthrough
- `tools/rules_bun/bun/private/bun_install.bzl` — remove `pnpm_workspace` attr and symlink logic

### 7. Bazel: Delete dead `tools/bun/repositories.bzl`

**File:** `tools/bun/repositories.bzl`

This file loads `@rules_nodejs` but is never instantiated (not registered in MODULE.bazel). Delete it. Also check if the rest of `tools/bun/` has dead code referencing it.

### 8. Bazel: obsidian-headless — replace npm with bun

**Files:**

- `tools/oci/obsidian_headless.bzl` — change genrule from `npm install --global` to use `$(location //tools/bun:bun) add --global`
- `tools/oci/obsidian-headless/Dockerfile` — change `FROM node:22-slim` to a bun base image, replace `npm install -g` with `bun add -g`
- `MODULE.bazel` — remove the `node_slim` OCI pull (lines 202-212) and `use_repo` refs

### 9. mise.toml: Remove node from homelab and starlight-karma-bot

**Files:**

- `packages/homelab/mise.toml` — remove `node = "lts"`
- `packages/starlight-karma-bot/mise.toml` — remove `node = "lts"`

### 10. Shell scripts: npx/node → bun/bunx

**Files:**

- `packages/anki/generate.sh` — `npx` → `bunx` (4 occurrences)
- `packages/astro-opengraph-images/generate_readme.sh` — `npx tsx src/...` → `bun run src/...`
- `packages/cooklang-for-obsidian/package.json` — `node esbuild.config.mjs` → `bun esbuild.config.mjs`
- `packages/discord-plays-pokemon/misc/run.sh` — `node packages/...` → `bun packages/...`

### 11. CI pipeline generator: Remove pnpm-lock.yaml from watched files

**File:** `scripts/ci/src/ci/pipeline_generator.py` — remove `"pnpm-lock.yaml"` from the watched files list

### 12. Rename scripts/ci/src/ci/lib/npm.py

**File:** `scripts/ci/src/ci/lib/npm.py` → rename to `publish.py` or add comment

The file already uses `bun publish` internally. Rename to avoid confusion, and update the import in `scripts/ci/src/ci/publish.py`.

### 13. dotfiles/Dockerfile: Clean up node references

**File:** `packages/dotfiles/Dockerfile`

- Remove `rm -rf /home/${USERNAME}/.npm` (line 159)
- Update comments mentioning node (lines 129, 202)

### 14. Add comments to kept exceptions

**Files:**

- `packages/tasks-for-obsidian/package.json` — add comment near engines.node explaining RN requirement + link to bun issue
- `packages/clauderon/mobile/package.json` — same
- `tools/rules_bun/bun/private/bun_prisma_generate.bzl` — update comment on node symlink with link to prisma issue

### 15. helm-types engines.node — keep as-is

Published package metadata for npm consumers. No change needed.

---

## Verification

1. `bazel build //...` — ensure no breakage from pnpm/node_slim removal
2. `bazel test //...` — all 55 targets still green
3. `grep -rn 'node\|npm\|pnpm\|npx' --include='*.sh' --include='*.bzl' --include='*.toml' --include='*.py' --include='Dockerfile' --exclude-dir=node_modules --exclude-dir=archive --exclude-dir=practice` — verify no remaining refs (except RN/Prisma/helm-types exceptions)
4. Verify `bun install` still works at root without `pnpm-workspace.yaml` (bun reads `workspaces` from root `package.json`)
5. CI: test code-review pipeline with native claude binary
6. CI: test release pipeline without node
