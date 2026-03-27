# Plan: `rules_bun` v2 — Hermetic Framework Rules

## Summary

- Bazel becomes the authoritative build and check path for Bun, Vite, and Astro targets in this repo.
- The steady state is Bazel-native and Bazel-idiomatic: sandboxed, hermetic, reproducible, remotely cacheable, and free of workspace escape hatches.
- The design preserves Bun's real module-resolution semantics while replacing copy-heavy materialization with a shared prepared-tree model and a minimal writable overlay for framework builds.
- This plan is complete only when all current Vite/Astro packages are migrated off `tools/bazel:vite_build.bzl`, `astro_build.bzl`, and `astro_check.bzl`, and their in-scope framework targets are non-`local`, non-`manual`, and compatible with the repo's existing remote cache configuration in `.bazelrc`.

## Principles

- Bazel is the source of truth for framework build and check behavior in CI and release flows.
- No `local = True`, no `execution_requirements = {"local": "1"}`, no `no-remote-cache`, and no `manual` tags used as sandbox escape hatches in the steady state.
- Remote caching is a hard requirement, not an optional optimization.
- Performance improvements must come from better artifact sharing and filesystem strategy, not weaker hermeticity.
- Package-local oddities are fixed explicitly instead of widening the stable rule API to encode them.
- Build, framework validation, and plain TypeScript typechecking remain separate targets where the package contract requires that separation.

## Public API And Rule Contract

- Public framework rules are:
  - `bun_vite_build`
  - `bun_astro_build`
  - `bun_astro_check`
- The generic framework build engine stays private to `tools/rules_bun/bun/private`; package `BUILD.bazel` files do not call `bun_build` directly.
- Public wrapper attrs are limited to:
  - `deps`
  - `extra_files`
  - `data`
  - `env`
  - `node_modules` with default `":node_modules"`
- Public wrappers do not expose arbitrary `build_cmd` or custom `dist_dir`.
- Stable framework behavior is:
  - `bun_vite_build` runs Vite build only
  - `bun_astro_build` runs Astro build only
  - `bun_astro_check` runs Astro check only
- Plain `tsc --noEmit` remains a separate Bazel `typecheck` target where the package's contract still includes standalone TS checking.
- The doc should include one canonical before/after `BUILD.bazel` example showing migration from legacy `tools/bazel:*` loads to the new public wrappers while keeping the usual target names.

## Core Architecture

- Introduce one prepared-tree-producing artifact/provider per package input set.
- All runtime, build, and check rules for that package consume the same prepared tree instead of re-materializing their own TreeArtifacts.
- The prepared tree preserves:
  - package sources at monorepo-relative paths
  - `package.json`
  - `tsconfig` and extra config files
  - runtime/build data files
  - workspace package sources under `node_modules/<name>/`
  - Bun npm package files preserving `.bun/<key>/node_modules/<pkg>/...`
  - recreated hoisted and inter-entry symlinks
- Bun invariants remain mandatory:
  - preserve `.bun/<key>` layout
  - preserve hoisted/inter-entry symlink topology
  - do not flatten Bun store entries
  - do not let Bun resolve normal sources or configs outside the prepared tree
  - retain Prisma handling, scoped workspace package naming, `.d.ts` dereference rules, and ancestor `node_modules` links

## Filesystem Strategy

- Regular files in the prepared tree use hardlink-first with copy fallback.
- Directory artifacts use copy only where linking is not valid.
- Bun `node_modules` topology uses symlinks only where Bun's own layout requires them.
- Any fallback from hardlink to copy is allowed only for expected hardlink failure modes such as cross-device or permission restrictions.
- Any copy, symlink, dereference, or hoisted-link creation failure outside that narrow hardlink fallback path fails the action.
- The implementation must not silently tolerate partial prepared-tree construction, because a bad artifact would poison the remote cache.

## Writable Overlay Contract

- Framework builds run against an immutable prepared tree plus a writable overlay workdir.
- The overlay must reuse immutable inputs from the prepared tree by hardlink or equivalent reuse.
- The overlay must not full-copy the prepared tree before every build.
- The overlay creates only the truly writable areas needed by the framework, such as:
  - `dist`
  - `.vite`
  - `.astro`
  - temp and cache directories
- Only declared final outputs are copied back to Bazel outputs.
- Overlay caches and temp state are never included in declared outputs.
- Each framework action sets private per-action paths for:
  - `HOME`
  - `TMPDIR`
  - `XDG_CACHE_HOME`
- Framework actions do not inherit arbitrary host env beyond explicit rule attrs.
- Telemetry and analytics are disabled where supported so outputs and action behavior remain reproducible.

## Input Declaration Contract

- `extra_files` must include all config and discovery inputs required by the framework action:
  - `vite.config.*`
  - `astro.config.*`
  - `postcss.config.*`
  - `tailwind.config.*`
  - `tsconfig.json`
  - `tsconfig.node.json` where used
  - every `extends` or `references` target in the tsconfig chain, including shared configs such as `//:tsconfig.base.json`
  - Vite HTML entrypoints, including root and nested entry files such as `index.html` and `src/popup/index.html`
  - manifests and config-time assets read by plugins, such as `manifest.json`
- `data` must include whole non-code trees where needed, not just narrow extension lists:
  - `public/**`
  - `src/content/**`
  - `src/assets/**`
  - `src/images/**`
  - `src/styles/**`
  - fonts, media, and other assets read at build time
- The rule contract should explicitly call out that framework packages often need whole source subtrees rather than a hand-picked file-type list.

## Migration Tasks

### 1. Prepared Tree Refactor

- Refactor `materialize_tree` into a shared prepared-tree-producing substrate consumed by tests, lint, typecheck, and future framework rules.
- Make shared prepared tree mean shared produced artifact/provider, not merely shared implementation logic.
- Replace copy-heavy regular-file materialization with hardlink-first logic.
- Tighten failure handling so incomplete prepared trees fail immediately.

### 2. Private Framework Engine

- Add a private framework build implementation in `tools/rules_bun/bun/private`.
- Add public wrapper macros in `tools/rules_bun/bun/defs.bzl` for Vite and Astro.
- Keep the public wrapper surface narrow and framework-specific.
- Add one canonical before/after `BUILD.bazel` migration example to the doc.

### 3. Vite Migration

- Migrate all current Vite packages:
  - `packages/hn-enhancer`
  - `packages/better-skill-capped`
  - `packages/discord-plays-pokemon/packages/frontend`
  - `packages/sentinel/web`
  - `packages/clauderon/web/frontend`
  - `packages/scout-for-lol/packages/desktop`
- Explicit package requirements:
  - `hn-enhancer`: `vite.config.ts`, `manifest.json`, `src/popup/index.html`, `public/**`
  - `better-skill-capped`: `vite.config.ts`, root `index.html`, `public/**`
  - `discord-plays-pokemon/packages/frontend`: `vite.config.ts`, root `index.html`, full `public/**`
  - `scout-for-lol/packages/desktop`: `vite.config.ts`, root `index.html`, `postcss.config.js`, `tailwind.config.ts`
  - `sentinel/web`: `vite.config.ts`, `postcss.config.ts`, root `index.html`
  - `clauderon/web/frontend`: `vite.config.ts`, root `index.html`, `postcss.config.js`, `tailwind.config.js`, frontend asset/style files

### 4. Astro Migration

- Migrate all current Astro packages:
  - `packages/cooklang-rich-preview`
  - `packages/status-page/web`
  - `packages/clauderon/docs`
  - `packages/scout-for-lol/packages/frontend`
  - `packages/sjer.red`
- Explicit package requirements:
  - `cooklang-rich-preview`: `astro.config.mjs`, `postcss.config.ts`, `public/**`
  - `status-page/web`: `astro.config.mjs`, `postcss.config.ts`
  - `clauderon/docs`: `astro.config.mjs`, `public/**`, `src/content/**`, `src/assets/**`, `src/styles/**`
  - `scout-for-lol/packages/frontend`: `astro.config.mjs`, `postcss.config.ts`, `tailwind.config.cjs`, `public/**`
  - `sjer.red`: `astro.config.ts`, `public/**`, `src/content/**`, `src/images/**`, `src/styles/**`

### 5. Astro Check / Typecheck Matrix

- The doc must include this explicit target matrix:

| Package                           | Keep `astro_build` | Keep `astro_check` | Keep `typecheck` | Completion State                             |
| --------------------------------- | ------------------ | ------------------ | ---------------- | -------------------------------------------- |
| `cooklang-rich-preview`           | yes                | yes                | yes              | all three non-`manual`                       |
| `status-page/web`                 | yes                | yes                | yes              | all three non-`manual`                       |
| `clauderon/docs`                  | yes                | yes                | no               | `astro_build` and `astro_check` non-`manual` |
| `scout-for-lol/packages/frontend` | yes                | yes                | yes              | all three non-`manual`                       |
| `sjer.red`                        | yes                | yes                | yes              | all three non-`manual`                       |

- Every Astro target that remains part of CI coverage after migration must be non-`manual`.
- If any exception exists, it must be named explicitly with a blocking reason and exit criterion.

### 6. Downstream Integration Blockers

- `packages/sentinel/web` must stop using `../dist/web` as its build output contract.
- The package or its consumer integration must be refactored so the stable framework rule contract remains package-local `dist/`.
- `packages/clauderon` must stop relying on source-tree `dist/.gitkeep` placeholders and source-tree `web/frontend/dist` / `docs/dist` assumptions as the integration contract.
- Clauderon's Bazel integration must explicitly consume Bazel-produced frontend and docs artifacts instead of assuming source-tree dist directories.
- These package-local refactors are in scope because they block a clean hermetic framework-rule design.

### 7. Cleanup

- Remove legacy framework macro usage from all package `BUILD.bazel` files.
- Delete `tools/bazel/vite_build.bzl`, `tools/bazel/astro_build.bzl`, and `tools/bazel/astro_check.bzl` after migration is complete.
- Verify no package still loads those macros.

## Rollout And Exit Criteria

- Replace vague "harder follow-ups" wording with a complete package inventory and an explicit rollout phase for each package.
- Pilot packages are:
  - Vite: `hn-enhancer`, `better-skill-capped`
  - Astro: `cooklang-rich-preview`, `status-page/web`
- Pilot exit criteria are:
  - sandboxed build or check succeeds
  - all required inputs are explicitly declared
  - no `local`, `manual`, or `no-remote-cache` escape hatches remain
  - CI second-run remote cache hit is observed on a clean executor
  - any package-local output-layout blockers for that package are resolved
- Full plan completion requires:
  - all current Vite/Astro packages in scope migrated to `rules_bun`
  - no package `BUILD.bazel` still loads legacy framework macros
  - all in-scope framework targets in CI coverage are non-`manual`, non-`local`, and remote-cache-compatible

## Test Plan

- Prepared tree correctness:
  - run representative existing Bun lint, test, and typecheck targets against the shared prepared tree and verify no Bun semantic regressions
  - verify `.bun` layout, hoisted links, and workspace resolution remain correct
- Framework correctness:
  - for each migrated Vite package, run its build target in the sandbox
  - for each migrated Astro package, run every target required by the matrix, not just `astro_build`
- Remote-cache validation:
  - build migrated targets in CI with `--config=ci` on a clean executor and confirm upload
  - rerun the same targets on a second clean executor and require remote cache hits
  - after CI upload, verify local read-only cache download works with the default local config
- Determinism:
  - compare output digests from two clean builds of representative Vite and Astro targets
  - verify new framework rules do not set `local`, `no-remote-cache`, or similar escape-hatch execution requirements
- Performance:
  - collect baseline and post-change measurements for both prepared-tree time and end-to-end action time
  - measure at least one small and one large package per framework
  - require warm-cache hits on clean executors, not just same-machine reruns

## Assumptions

- The existing remote cache configuration in `.bazelrc` remains the source of truth.
- Remote execution is not required by this plan, but remote cache compatibility is required.
- Developer-facing package scripts may remain for convenience, but Bazel does not depend on them for framework build correctness.
- If a package needs additional explicit inputs beyond the common contract, the package declares them; the rule does not add fallback behavior that weakens hermeticity.
