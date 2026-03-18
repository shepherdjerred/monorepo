# Plan: `rules_bun` v2 — Link-First Prepared Trees + First-Class Vite/Astro

## Context

The repo is already committed to a Bun-native Bazel stack:

- `MODULE.bazel` uses `bun_modules.install(...)` instead of `rules_js` / `npm_translate_lock`
- `tools/rules_bun/` owns the Bun toolchain, dependency repo, and rule surface
- many packages already use `bun_library`, `bun_test`, `bun_eslint_test`, and `bun_typecheck_test`

The remaining problem is performance and uneven framework support.

Current `materialize_tree()` is correctness-first but expensive: it creates a self-contained package tree by copying sources and npm files into a fresh TreeArtifact. The current phase-3 plan already calls out this bottleneck: materialization does `~80k` per-file copies per workspace and can take `1-5 min` per target.

At the same time, Vite and Astro are not first-class `rules_bun` citizens yet. The current `vite_build`, `astro_build`, and `astro_check` rules run against the real workspace with `local = True` and `no-remote-cache = True`, so they bypass most of Bazel's value.

## Goals

- Keep the repo fully Bun-native
- preserve Bun's real module-resolution semantics
- reduce materialization cost without regressing correctness
- add first-class Bazel support for Vite and Astro in `rules_bun`
- improve CI determinism and cacheability for framework builds

## Non-Goals

- reverting to a Node/npm/pnpm-based Bazel stack
- making every local developer workflow go through Bazel
- solving every Prisma/network/integration-test edge case in the first iteration
- rewriting package dependency modeling from scratch

## Why A New Plan

Two existing docs are relevant but incomplete for the next step:

- `bazel-bun-native-phase3.md` identifies the copy-heavy materialization bottleneck and suggests hardlinks as a likely optimization
- `hermetic-builds-cacheable-oci.md` sketches first-class Vite/Astro rules, but still assumes a copy-heavy writable temp tree and does not spell out Bun-specific filesystem invariants

This plan narrows the next iteration:

1. keep the current Bun-native semantics
2. change the filesystem strategy under those semantics
3. add framework rules only after the prepared-tree primitive is solid

## Hard Constraints

Any `rules_bun` v2 design must preserve these invariants.

### 1. Preserve Bun's `.bun` Store Shape

Bun installs packages into:

```text
node_modules/.bun/<key>/node_modules/<pkg>/
```

That versioned layout is not incidental. The prepared tree must continue to preserve:

- `.bun/<key>/node_modules/<pkg>/...`
- inter-entry dependency symlinks
- top-level hoisted symlinks

Do not collapse the tree into a flat synthetic `node_modules/<pkg>` model.

### 2. Do Not Let Bun Resolve Source Files Outside The Prepared Tree

The older Bun runner already documented the main hazard: Bun resolves from real dereferenced paths, not just the apparent runfiles path. A naive symlink forest can cause Bun to escape the prepared tree and resolve modules from the wrong place.

Implication:

- do not symlink normal source/config files out of the prepared tree
- prefer hardlinks for regular files
- reserve symlinks for Bun's intended `node_modules` topology

### 3. Keep Existing Special Cases Intact

`rules_bun` already encodes several correctness fixes that must survive the rewrite:

- scoped workspace packages require correct `package_name`
- Prisma client layout needs explicit handling
- declaration-file symlinks escaping the tree must be dereferenced selectively
- ancestor `node_modules` links must exist so configs resolve imports correctly

The filesystem strategy can change; these semantic fixes cannot be dropped.

### 4. Build Rules Need A Writable Overlay

Vite and Astro write `.vite/`, `.astro/`, caches, and `dist/` during builds.

Do not run build commands directly inside the immutable prepared tree.

Instead:

- create an immutable prepared dependency tree
- create a writable temp workdir for the build action
- project or link immutable inputs into that workdir
- copy only generated outputs back to Bazel outputs

## Phase 1: Shared Prepared-Tree Primitive

Create one shared prepared-tree primitive for `rules_bun` and make all runtime rules consume it.

This becomes the common substrate for:

- `bun_binary`
- `bun_test`
- `bun_eslint_test`
- `bun_typecheck_test`
- future `bun_build`
- future `bun_astro_check`

The current duplication is acceptable while rules are being proven out, but not as the long-term architecture.

### Prepared Tree Contract

The prepared tree must contain:

- package sources at monorepo-relative paths
- `package.json`
- `tsconfig` and extra config files
- data files needed at runtime/build time
- workspace package sources under `node_modules/<name>/`
- Bun npm package files preserving `.bun/<key>` layout
- recreated hoisted/inter-entry symlinks

## Phase 2: Link-First Materialization

Replace copy-heavy materialization with link-first materialization.

### File Strategy

- regular files: hardlink first
- directories represented by declared directory outputs: copy as needed
- Bun `node_modules` topology: symlink
- mutable/generated outputs: copy

### Fallbacks

Hardlinks are not guaranteed everywhere. The implementation must fall back cleanly:

1. try hardlink
2. if hardlink fails, copy

This preserves correctness on filesystems or sandbox modes where hardlinks are unavailable.

### Explicitly Avoid

- symlinking package source files into the prepared tree
- flattening `.bun` entries into a single-level `node_modules`
- depending on undeclared files in the real workspace

## Phase 3: First-Class Framework Rules In `rules_bun`

Move framework support into `tools/rules_bun/` so Vite/Astro builds stop using ad hoc local escape-hatch macros under `tools/bazel/`.

### New Public Rules

- `bun_build`
- `bun_vite_build`
- `bun_astro_build`
- `bun_astro_check`

### `bun_build`

Generic build rule for Bun-driven frameworks.

Required capabilities:

- consumes the shared prepared tree
- supports `extra_files` for config files
- supports `data` for `public/`, content files, and static assets
- supports custom `build_cmd`
- supports custom `dist_dir`
- supports env vars where framework tooling requires them

### `bun_astro_check`

Dedicated Astro rule that runs `astro check`.

Do not treat this as a replacement for plain TS type checking in every package. Some packages will still need both:

- `astro check`
- `tsc --noEmit`

## Phase 4: Package Rollout

Start with proof points, not the hardest packages.

### Vite Pilot

1. `packages/hn-enhancer`
2. `packages/better-skill-capped`

These are simpler than Tauri- or multi-package Vite builds.

### Astro Pilot

1. `packages/cooklang-rich-preview`
2. `packages/status-page/web`

These exercise `astro build` / `astro check` without immediately jumping into the most complex site.

### Harder Follow-Ups

- `packages/sjer.red`
- `packages/scout-for-lol/packages/frontend`
- `packages/clauderon/docs`
- Vite packages with more complex output/layout constraints

Do not migrate these until the pilot packages are stable.

## Framework Migration Requirements

A stricter framework rule will surface undeclared inputs that the current local-only rules mask.

Expect to explicitly declare:

- `vite.config.*`
- `astro.config.*`
- `postcss.config.*`
- `tailwind.config.*`
- `tsconfig.node.json`
- `manifest.json`
- `public/**`
- content files (`.md`, `.mdx`, `.astro`, CSS, images, fonts)
- config-time assets read from disk

This is expected cleanup, not a regression.

## Recommended Scope Boundary

Treat Bazel as the authoritative substrate for:

- CI build/lint/typecheck/test
- framework builds that produce deployable artifacts
- OCI/image production

Keep local Bun commands first-class for day-to-day development:

- `bun run build`
- `bun run test`
- `bun run typecheck`

Do not require every local workflow to go through Bazel before the rule surface is mature.

## Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Bun path-resolution regressions | Bun follows real paths aggressively | hardlink regular files; avoid symlinked source trees |
| Silent partial-tree failures | current materializer tolerates some filesystem failures | tighten error handling while rewriting link/copy logic |
| Hardlink portability | hardlinks may fail across filesystems or sandbox modes | hardlink-first with copy fallback |
| Framework-specific churn in core rules | Vite/Astro behavior changes over time | keep generic `bun_build` small; put only framework-specific launch logic in thin wrappers |
| Migration breaks from undeclared inputs | current local-only rules hide missing inputs | pilot on simple packages first and add explicit attrs for config/data files |
| Split-brain local vs CI behavior | Bazel and direct Bun commands can diverge | use Bazel as CI source of truth; keep package scripts aligned with Bazel rule commands |

## Verification

### Prepared Tree

- `bazel test //packages/tools:typecheck`
- `bazel test //packages/birmel:lint`
- `bazel test //packages/tasknotes-server:test`

Verify link-first materialization preserves current correctness before adding framework rules.

### Vite Pilot

- `bazel build //packages/hn-enhancer:vite_build`
- `bazel build //packages/better-skill-capped:vite_build`

Run twice and confirm the second build is materially faster / cached.

### Astro Pilot

- `bazel build //packages/cooklang-rich-preview:astro_build`
- `bazel test //packages/cooklang-rich-preview:astro_check`
- `bazel build //packages/status-page/web:astro_build`
- `bazel test //packages/status-page/web:astro_check`

### Regression Sweep

- verify no package still loads `tools/bazel:vite_build.bzl`
- verify no package still loads `tools/bazel:astro_build.bzl`
- verify no package still loads `tools/bazel:astro_check.bzl`

## Success Criteria

- prepared-tree creation time drops substantially for Bun targets
- Vite/Astro builds no longer require the real workspace checkout
- framework targets become cacheable where practical
- simple Vite/Astro packages migrate without manual tags
- Bun-native correctness is preserved: same `.bun` layout, same hoisted resolution, no new realpath escapes

## Out Of Scope For This Plan

- fully hermetic Prisma generation
- eliminating every `manual` target in the repo
- fixing all legacy `tools/bazel/*runner.sh` compatibility code
- redesigning CI package selection / target-determinator behavior

This plan is specifically about the next `rules_bun` step: make prepared trees cheaper, then make framework support first-class on top of that foundation.
