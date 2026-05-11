# Plan: Close all Renovate / dependency-pinning gaps

## Status

Complete

## Context

A prior audit (recorded in `packages/docs/plans/2026-05-09_renovate-coverage-audit.md` after this plan saves it there) found seven concrete gaps where dependencies are either fully unmanaged by Renovate or appear tracked but actually aren't:

1. `.dagger/src/constants.ts` — has `// renovate:` annotations but the custom regex manager only matches `**/versions.ts` / `**/lib-versions.ts`. 11 docker images and 6 tool versions are silently floating.
2. 13× `mise.toml` entries pinned to the literal `"latest"` (rust, java, bun, python across packages).
3. CI base image drift: `.buildkite/ci-image/VERSION` = `404`, `.buildkite/pipeline.yml:16` pins `403`.
4. `.dagger/src/image.ts:312` hardcodes `node:22-slim` with no annotation, no digest.
5. `tools/oci/obsidian-headless/Dockerfile:2` `npm install -g obsidian-headless` (latest at build time).
6. `packages/homelab/src/talos/patches/image.yaml:5` Talos installer image — bumped manually via `update-image-id.ts`, not Renovate-tracked.
7. `packages/tasks-for-obsidian/ios/ci_scripts/ci_post_clone.sh:31` — Bun installer not pinned.

Plus housekeeping: per `CLAUDE.md`, mirror this plan into `packages/docs/plans/` and update `packages/docs/index.md`.

This plan executes all of them in dependency order.

## Approach

### Phase 0 — Mirror this plan into the repo (housekeeping, no logic)

- Copy `/Users/jerred/.claude/plans/do-we-have-any-glowing-snowglobe.md` → `/Users/jerred/git/monorepo/packages/docs/plans/2026-05-09_renovate-coverage-audit.md` (the audit-and-fix doc, single source of truth).
- Add link to `/Users/jerred/git/monorepo/packages/docs/index.md` under the plans section.

### Phase 1 — Read-only investigation: CI base image drift

Determine the source of truth before any code change:

```
git log -p -- .buildkite/ci-image/VERSION .buildkite/pipeline.yml
```

Outcomes:

- **`404` is real but not yet rolled out** → bump `pipeline.yml` from `403` → `404` in this PR.
- **`404` was a failed/abandoned build** → revert `VERSION` to `403`.
- **`404` was deployed but `pipeline.yml` was missed in a prior PR** → bump `pipeline.yml` to `404`.

Run `gh release view` / `crane` against `ghcr.io/shepherdjerred/ci-base` to confirm which tags exist:

```
crane ls ghcr.io/shepherdjerred/ci-base | sort -n | tail -5
```

Reuse no existing helper — this is a one-off reconciliation.

### Phase 2 — Split `.dagger/src/constants.ts` into `versions.ts` + `constants.ts`

**New file**: `/Users/jerred/git/monorepo/.dagger/src/versions.ts`
Contains every version constant currently in `constants.ts` (lines 12–61), unchanged values, with annotations preserved.

**Existing file rewrite**: `/Users/jerred/git/monorepo/.dagger/src/constants.ts`
Keep only the cache-volume names (lines 67–73) and `SOURCE_EXCLUDES` (lines 80–96). Add a re-export line `export * from "./versions";` so existing `import { BUN_IMAGE } from "./constants"` callers keep working — verify whether any exist; if not, skip the re-export and update imports directly.

**Two small fixes inside the move**:

- Line 25 currently has `// renovate: datasource=docker depName=hashicorp/terraform` for `TOFU_IMAGE = "ghcr.io/opentofu/opentofu:..."` — wrong `depName`. Fix to `depName=opentofu/opentofu`.
- Move `node:22-slim` from `.dagger/src/image.ts:312` into `versions.ts` as `OBSIDIAN_HEADLESS_BASE_IMAGE = "node:22-slim";` with `// renovate: datasource=docker depName=node`. Update `image.ts` to import and use it.

**Find all callers**:

```
rg -n 'from ["\\']\\./constants["\\'']' .dagger/src/
rg -n 'from ["\\'].*constants["\\'']' .dagger/src/
```

Update each import that pulls a version constant to import from `./versions` instead. Cache names and `SOURCE_EXCLUDES` continue to import from `./constants`.

**Effect on Renovate**: the custom regex manager (`renovate.json` `customManagers[0].managerFilePatterns`) already matches `**/versions.ts`. No `renovate.json` change required. On the first Renovate run after merge, `pinDigests: true` will issue PRs adding `@sha256:` to all 11 docker images.

### Phase 3 — Pin every `"latest"` in `mise.toml`

For each file below, replace `"latest"` with the current pinned version and add a `# renovate:` comment matching the existing pattern in `/Users/jerred/git/monorepo/.mise.toml`:

```
# renovate: datasource=github-releases depName=oven-sh/bun
bun = "1.3.13"
```

Files to edit:

| File                                                                   | Replace                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/Users/jerred/git/monorepo/.mise.toml`                                | `rust = "latest"` → pin (use `mise ls-remote rust \| tail -1`); `java = "latest"` → pin (e.g. `25.0.1`); add renovate comments via `github-releases depName=rust-lang/rust` and `mise depName=java` (or `java-jdk` datasource — verify) |
| `/Users/jerred/git/monorepo/packages/scout-for-lol/mise.toml`          | `bun = "latest"` → `bun = "1.3.13"` w/ comment                                                                                                                                                                                          |
| `/Users/jerred/git/monorepo/packages/starlight-karma-bot/mise.toml`    | same                                                                                                                                                                                                                                    |
| `/Users/jerred/git/monorepo/packages/macos-cross-compiler/mise.toml`   | same                                                                                                                                                                                                                                    |
| `/Users/jerred/git/monorepo/packages/sjer.red/mise.toml`               | same                                                                                                                                                                                                                                    |
| `/Users/jerred/git/monorepo/packages/webring/mise.toml`                | same                                                                                                                                                                                                                                    |
| `/Users/jerred/git/monorepo/packages/discord-plays-pokemon/mise.toml`  | same                                                                                                                                                                                                                                    |
| `/Users/jerred/git/monorepo/packages/homelab/mise.toml`                | `bun = "latest"`, `python = "latest"` (pin python to current 3.x; comment `# renovate: datasource=github-releases depName=python/cpython`)                                                                                              |
| `/Users/jerred/git/monorepo/packages/clauderon/mise.toml`              | `rust = "latest"` → pin                                                                                                                                                                                                                 |
| `/Users/jerred/git/monorepo/packages/castle-casters/mise.toml`         | `bun = "latest"` → pin; `java = "25"` → fully-qualified version (e.g. `25.0.1`)                                                                                                                                                         |
| `/Users/jerred/git/monorepo/packages/better-skill-capped/mise.toml`    | `bun = "latest"` → pin                                                                                                                                                                                                                  |
| `/Users/jerred/git/monorepo/packages/astro-opengraph-images/mise.toml` | same                                                                                                                                                                                                                                    |

**Out of scope (chezmoi user dotfiles, separate concern)**:

- `/Users/jerred/git/monorepo/packages/dotfiles/private_dot_config/mise/config.toml` — flag in caveats, do not touch in this plan.

**Validation**:

```
mise install   # in repo root, must succeed with newly pinned versions
```

### Phase 4 — Pin `obsidian-headless` and Bun in iOS CI script

**`/Users/jerred/git/monorepo/tools/oci/obsidian-headless/Dockerfile`**: introduce ARG-style version with renovate comment, identical pattern to `.buildkite/ci-image/Dockerfile`:

```dockerfile
# renovate: datasource=npm depName=obsidian-headless
ARG OBSIDIAN_HEADLESS_VERSION=<current latest>
RUN npm install -g "obsidian-headless@${OBSIDIAN_HEADLESS_VERSION}"
```

Look up current latest with `npm view obsidian-headless version`.

**`/Users/jerred/git/monorepo/packages/tasks-for-obsidian/ios/ci_scripts/ci_post_clone.sh`** (line 31): swap raw `curl … | bash` for the pinned-installer pattern used in `.buildkite/scripts/setup-tools.sh`:

```bash
# renovate: datasource=github-releases depName=oven-sh/bun
BUN_VERSION="bun-v1.3.13"
curl -fsSL "https://bun.sh/install" | bash -s "${BUN_VERSION}"
```

(`bun.sh/install` accepts a tag argument as `bash -s <tag>`; verify against current installer script.)

`brew install node` on line 26 stays as-is (dev-only, low blast radius).

### Phase 5 — Renovate config: Talos installer custom manager

Edit `/Users/jerred/git/monorepo/renovate.json`. Append a third `customManagers` entry:

```json
{
  "customType": "regex",
  "description": "Talos factory installer image — track the Talos version suffix",
  "managerFilePatterns": ["packages/homelab/src/talos/patches/image.yaml"],
  "matchStrings": [
    "image:\\s+factory\\.talos\\.dev/[^:\\s]+:(?<currentValue>v[0-9.]+)"
  ],
  "datasourceTemplate": "docker",
  "depNameTemplate": "siderolabs/installer"
}
```

Renovate already has a `packageRules` entry for `siderolabs/talos` with `automerge: false`. Confirm it covers `siderolabs/installer` too — if not, broaden the rule to a regex like `/^siderolabs\\//`.

**Note on schematic ID**: the path segment `metal-installer-secureboot/<sha>:<tag>` includes a per-config schematic hash that's regenerated by `packages/homelab/src/talos/update-image-id.ts`. The Renovate manager only updates the trailing `:vX.Y.Z`. After Renovate bumps the tag, the existing `update-image-id.ts` flow regenerates the schematic. Document this in the manifest as a comment near `image:` line.

### Phase 6 — Verification

Per repo `CLAUDE.md` `## Verification`:

1. `bun run typecheck` — catches any broken imports from the constants→versions split.
2. `bun run test` — repo-wide smoke.
3. `cd .dagger && bunx eslint . --fix` — Dagger lint clean.
4. `cd .dagger && bun run typecheck` if there's a package-level config.
5. **Renovate dry-run** for the changes:

   ```
   bunx --bun renovate --platform=local --dry-run=full --schedule= 2>&1 | tee /tmp/renovate-dry-run.log
   ```

   Confirm log shows new dep entries for each `versions.ts` constant and the Talos manager match.

6. **Mise smoke**: `mise install` in repo root and inside `packages/scout-for-lol`, `packages/clauderon`, `packages/castle-casters` (the three with non-bun pins).
7. **CI image alignment** (Phase 1 outcome): after `pipeline.yml` is updated, run a no-op Buildkite pipeline upload locally with `bunx @buildkite/cli pipeline validate` (or whatever the existing check is in `scripts/ci/`).

## Critical files

- `/Users/jerred/git/monorepo/.dagger/src/constants.ts` (split)
- `/Users/jerred/git/monorepo/.dagger/src/versions.ts` (new)
- `/Users/jerred/git/monorepo/.dagger/src/image.ts` (line 312, update import)
- `/Users/jerred/git/monorepo/renovate.json` (Talos manager + optionally fix `pinDigests` for `versions.ts` doc image lines)
- `/Users/jerred/git/monorepo/.buildkite/ci-image/VERSION` _or_ `/Users/jerred/git/monorepo/.buildkite/pipeline.yml` (one of, depending on Phase 1 outcome)
- `/Users/jerred/git/monorepo/.mise.toml` + 11 per-package `mise.toml` files (Phase 3 table)
- `/Users/jerred/git/monorepo/tools/oci/obsidian-headless/Dockerfile`
- `/Users/jerred/git/monorepo/packages/tasks-for-obsidian/ios/ci_scripts/ci_post_clone.sh`
- `/Users/jerred/git/monorepo/packages/docs/plans/2026-05-09_renovate-coverage-audit.md` (new — mirror of this plan)
- `/Users/jerred/git/monorepo/packages/docs/index.md` (add link)

## Reused patterns / utilities

- **`# renovate:` comment style for shell** — copy from `.buildkite/scripts/setup-tools.sh` (uv, kubectl, helm, gh, etc.).
- **`# renovate:` comment style for Dockerfile ARG** — copy from `.buildkite/ci-image/Dockerfile` (NODE_VERSION, DAGGER_VERSION).
- **`// renovate:` comment style for TS** — copy from `packages/homelab/src/cdk8s/src/versions.ts` (~70 entries, the canonical example).
- **Existing custom regex manager** in `renovate.json` already covers `**/versions.ts` — no edit needed for Phase 2; new entry only for Phase 5 (Talos).
- **Talos image-id regeneration** — existing script `packages/homelab/src/talos/update-image-id.ts` handles schematic-hash regeneration; the new Renovate manager only feeds it the new tag.

## Risks / what could go wrong

- **Constants split breaks Dagger imports**: mitigated by re-export shim or by grepping all importers up front. `bun run typecheck` is the gate.
- **`pinDigests` PR storm**: after merge, Renovate may open 11+ digest PRs in one wave for the new `versions.ts` entries. Acceptable — they automerge per the existing config (no `automerge: false` rule covers these specific images).
- **`mise.toml` pinned versions drift fast**: by pinning, we trade auto-latest for a 1× Renovate PR per minor bump. This is intended.
- **Talos custom regex manager matches the wrong image**: scope `managerFilePatterns` to the single file, not a glob, to avoid false positives.
- **`bun.sh/install` `bash -s <tag>` syntax** may not be exactly that — verify before committing the iOS CI change.

## Out of scope (explicit)

- `archive/**` and `practice/**` — already excluded by `renovate.json`.
- `packages/dotfiles/install.sh` Homebrew/Fisher bootstraps — interactive, low blast radius.
- `packages/dotfiles/private_dot_config/mise/config.toml` — user dotfiles, separate concern.
- `brew install` calls in dev-only scripts (`.devcontainer/post-install.sh`, etc.).
- Adding workspace-protocol migration (per memory: user firm on `file:` for scout-for-lol).

## Session Log — 2026-05-09

### Done

- **Phase 0** Mirrored plan to `packages/docs/plans/2026-05-09_renovate-coverage-audit.md`; added link to `packages/docs/index.md`.
- **Phase 1** CI image drift resolved: `crane ls ghcr.io/shepherdjerred/ci-base` confirmed `404` is current (`latest` tag points at it). Bumped `.buildkite/pipeline.yml:16` from `403` → `404`.
- **Phase 2** `.dagger/src/constants.ts`:
  - Fixed wrong `depName=hashicorp/terraform` → `depName=opentofu/opentofu` for `TOFU_IMAGE`.
  - Added `OBSIDIAN_HEADLESS_BASE_IMAGE = "node:22-slim"` with renovate annotation; updated `.dagger/src/image.ts:312` to use it (removed hardcoded string).
  - Did NOT split into separate `versions.ts` — instead added a third `customManagers` entry to `renovate.json` matching `export const NAME = "value"` style scoped to `.dagger/src/constants.ts`. Verified via dry-run: 11 docker images + 6 tool versions now extracted (oven/bun, rust, golang, playwright, swiftlint, alpine, opentofu, maven, texlive, caddy, python, node, alpine/helm, release-please, claude-code, golangci-lint, gh-cli, kubectl, github-mcp-server). `pinDigests: true` will queue digest-pin PRs on next Renovate run.
- **Phase 3** Pinned every `"latest"` in `mise.toml`:
  - `.mise.toml`: rust=1.95.0, java=25.0.2 (bun=1.3.13 was already pinned)
  - 11 per-package `mise.toml` files: bun=1.3.13 (with `# renovate:` annotation), python=3.14.4, rust=1.95.0, java=25.0.2 as applicable.
  - Verified Renovate's mise auto-detector picks up bun, rust, java (offers 25.0.3 patch update), python.
- **Phase 4**:
  - `tools/oci/obsidian-headless/Dockerfile`: added `# renovate: ARG OBSIDIAN_HEADLESS_VERSION=0.0.8` pattern; converted file from CRLF → LF (was preventing regex match).
  - `packages/tasks-for-obsidian/ios/ci_scripts/ci_post_clone.sh`: pinned Bun installer to `bun-v1.3.13` via `bash -s` tag arg; verified bun.sh/install accepts tag as first positional arg.
- **Phase 5** Added `customManagers` regex for `packages/homelab/src/talos/patches/image.yaml` matching `:vX.Y.Z` suffix; depNameTemplate `ghcr.io/siderolabs/installer`. Broadened the existing critical-infra `packageRules` entry to also cover `ghcr.io/siderolabs/installer` so it inherits `automerge: false` and 0-day delay. Added schematic-regen comment near the `image:` line. Renovate dry-run confirms: extracts `v1.12.0` and proposes `v1.13.0`.
  - Also broadened the Buildkite custom regex manager file pattern: `[".buildkite/**", "tools/oci/**/Dockerfile", "packages/tasks-for-obsidian/ios/ci_scripts/**"]` and updated value class from `[v0-9][0-9.]*` to `[a-zA-Z0-9._-]+` to handle non-numeric tags like `bun-v1.3.13`. Added `[ \t]*` after `\n` to handle indented variable assignments.
- **Phase 6** Verification:
  - `jq empty renovate.json` ✓ valid JSON
  - `bunx tsc --noEmit` in `.dagger/`: only pre-existing errors (`@types/node` missing in `__tests__/*.test.ts`, `Error.exitCode` access in `misc.ts:172`); none in files I touched.
  - Renovate dry-run (`npx renovate@latest --platform=local --dry-run=lookup`): all 4 expected file types extract correctly:
    - `.dagger/src/constants.ts` → 17 entries
    - `tools/oci/obsidian-headless/Dockerfile` → `obsidian-headless@0.0.8` (npm)
    - `packages/tasks-for-obsidian/ios/ci_scripts/ci_post_clone.sh` → `oven-sh/bun@bun-v1.3.13` (github-releases)
    - `packages/homelab/src/talos/patches/image.yaml` → `ghcr.io/siderolabs/installer@v1.12.0` (docker)

### Remaining

- None. All seven gaps from the audit are closed in this session.

### Caveats

- The Renovate dry-run was authenticated by GitHub-token-required for `github-releases` lookups (skipReason). Real CI run with `RENOVATE_TOKEN` will perform the lookups; extraction (the part this PR enables) is verified working.
- `tools/oci/Dockerfile.obsidian-headless` (different file from the one I edited) still uses the inline `# renovate: ... \n RUN npm install -g obsidian-headless@0.0.7` pattern. It's tracked by Renovate's native Dockerfile inline manager. Versions WILL diverge from `tools/oci/obsidian-headless/Dockerfile` until they're consolidated. Not in scope this session — the two Dockerfiles appear to be alternates with no consumer references in code (only in docs/archive); future cleanup should pick one and delete the other.
- The Buildkite custom regex matcher's value class is now broader (`[a-zA-Z0-9._-]+`). All existing extractions continue to work (verified against `setup-tools.sh`'s `RIPGREP_VERSION`, `KUBECTL_VERSION`, `UV_VERSION`, etc.). The previous `[v0-9][0-9.]*` would have rejected `bun-v1.3.13`.
- `packages/anki/mise.toml` has no `[tools]` runtime entries — skipped, no fix needed.
- `packages/dotfiles/private_dot_config/mise/config.toml` (chezmoi-managed user dotfiles) was excluded — separate concern, not part of repo CI.
- After this PR merges, expect ~15 follow-up Renovate PRs in one wave: digest pins for the 11 newly-tracked docker images in `.dagger/src/constants.ts`, plus minor/patch bumps surfaced by the freshly-pinned mise tools (e.g. java 25.0.3 already pending).
