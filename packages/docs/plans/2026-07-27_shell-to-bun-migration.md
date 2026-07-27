---
id: shell-to-bun-migration
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Shell-to-Bun Migration

## Goal

Classify every tracked `.sh` file outside `sandbox/`, port scripts to Bun where
the runtime is already available or the script is substantial enough to justify
adding it, and retain shell where the execution contract requires it.

## Decision Rules

- Prefer Bun when the execution environment already guarantees Bun.
- Do not add Bun to a bootstrap, CI bootstrap, Xcode, or production image solely
  for a small script.
- Treat 100–200 lines as a gray zone and require clear complexity or maintenance
  benefits; scripts above 200 lines are candidates, not automatic ports.
- Preserve mandatory shell entrypoints and sourced scripts.
- Delete unused vendored wrappers instead of porting them.

## Classification Summary

| Disposition                          |  Count |
| ------------------------------------ | -----: |
| Port to Bun                          |     34 |
| Remove redundant shell wrapper       |      1 |
| Delete or replace without Bun        |     10 |
| Retain as shell                      |     17 |
| **Tracked `.sh` outside `sandbox/`** | **62** |

## Port to Bun

These scripts run only after Bun is available, or are substantial enough to
justify Bun as an explicit dependency.

### Buildkite

These execute in Buildkite images that already include Bun. Preserve the
pipeline's exit-status, artifact, metadata, and fail-open/fail-closed contracts.

- `.buildkite/scripts/annotate-build-summary.sh`
- `.buildkite/scripts/bake-images.sh`
- `.buildkite/scripts/bake-retry.sh`
- `.buildkite/scripts/bake-retry.test.sh`
- `.buildkite/scripts/build-ci-image.sh`
- `.buildkite/scripts/buildkit-env.sh`
- `.buildkite/scripts/ci-changed.sh`
- `.buildkite/scripts/ci-changed.test.sh`
- `.buildkite/scripts/prepare-ci-changed-base.sh`

### Package tooling

- `packages/anki/generate.sh`
- `packages/astro-opengraph-images/generate_readme.sh`
- `packages/discord-plays-mario-kart/scripts/build-wasm.sh`
- `packages/discord-plays-mario-kart/scripts/vendor-n64wasm.sh`
- `packages/discord-plays-pokemon/scripts/build-wasm.sh`
- `packages/dotfiles/bin/executable_git_cleanup.sh`
- `packages/homelab/scripts/helm-set-version.sh`
- `packages/homelab/scripts/lint-helm.sh`
- `packages/homelab/scripts/velero/cleanup-r2-bucket.sh`
- `packages/homelab/scripts/velero/delete-all-backups.sh`
- `packages/llm-observability/test/e2e/run-ci.sh`
- `packages/llm-observability/test/e2e/run.sh`
- `packages/scout-for-lol/packages/desktop/src-tauri/icons/create_minimal_png.sh`
- `packages/scout-for-lol/scripts/dev-web.sh`
- `packages/scout-for-lol/scripts/install_pkgs.sh`
- `packages/tasks-for-obsidian/scripts/clean-ios.sh`
- `packages/tasks-for-obsidian/scripts/ios-logs.sh`
- `packages/toolkit/install.sh`

`executable_git_cleanup.sh` is the one intentional new Bun dependency outside a
normal package/runtime context. At 771 lines with extensive process orchestration
and state handling, it clears the size and maintainability threshold.

### Root repository tooling

- `scripts/check-env-var-names.sh`
- `scripts/check-merge-conflicts.sh`
- `scripts/compliance-check.sh`
- `scripts/new-package.sh`
- `scripts/prettier-staged.sh`
- `scripts/pyright-check.sh`
- `scripts/shellcheck.sh`

## Remove or Replace Without a Bun Port

### Remove redundant wrapper

- `scripts/quality-ratchet.sh` — callers already use
  `bun scripts/quality-ratchet.ts`; delete the three-line wrapper.

### Delete obsolete Buildkite compatibility

- `.buildkite/scripts/docker-env.sh` — no executable caller remains after the
  remote BuildKit cutover. Remove the stale validator and image-selection
  references with it rather than preserving a dead Docker-in-Docker contract.

### Delete unused vendored scripts

Add these paths to
`packages/discord-plays-mario-kart/wasm-src/vendor-excludes.txt` so re-vendoring
does not restore them, then delete them:

- `packages/discord-plays-mario-kart/wasm-src/code/build.sh`
- `packages/discord-plays-mario-kart/wasm-src/code/start_emc.sh`
- `packages/discord-plays-mario-kart/wasm-src/code/src/mupen64plus-core/tools/build_bundle_bin.sh`
- `packages/discord-plays-mario-kart/wasm-src/code/src/mupen64plus-core/tools/build_bundle_src.sh`
- `packages/discord-plays-mario-kart/wasm-src/code/src/mupen64plus-core/tools/build_modules_src.sh`
- `packages/discord-plays-mario-kart/wasm-src/code/src/mupen64plus-core/tools/install_binary_bundle.sh`
- `packages/discord-plays-mario-kart/wasm-src/code/src/mupen64plus-core/tools/uninstall_binary_bundle.sh`

The owned build invokes the N64Wasm Makefile directly; none of these upstream
convenience wrappers is called by repository automation.

### Delete or replace stale utilities

- `packages/homelab/src/cdk8s/src/resources/monitoring/scripts/node_os_info.sh`
  — no live caller; delete it.
- `packages/dotfiles/dot_agents/skills/apple-hig-helper/scrape.sh` — the wrapper
  points at a missing `/workspace/scripts/scrape-apple-hig.py` and documents
  removed repository paths. Delete it and repair the skill README, or restore a
  Python scraper with a direct `uv run` entrypoint. Adding Bun would introduce a
  second runtime to a Python/Playwright workflow without simplifying it.

## Retain as Shell

### Shell or platform contract

- `.buildkite/scripts/toolchain.sh` — sourced into each step, installs Bun via
  mise, and exports environment into the parent shell.
- `.buildkite/scripts/upload-pipeline.sh` — runs during Buildkite pipeline
  bootstrap before the repository toolchain or CI image is guaranteed.
- `.buildkite/scripts/upload-pipeline.test.sh` — tests that bootstrap contract in
  the same minimal shell environment.
- `.claude/hooks/trust-mise.sh` — lifecycle hook that must work before the
  repository runtime is available.
- `.claude/hooks/worktree-reminder.sh` — lifecycle hook that must work before the
  repository runtime is available.
- `packages/homelab/mac-ci/bootstrap.sh` — machine bootstrap.
- `packages/tasks-for-obsidian/ios/ci_scripts/ci_post_clone.sh` — Xcode Cloud's
  required shell entrypoint; it installs Bun itself.

### Dotfiles bootstrap and small user utilities

- `packages/dotfiles/install.sh` — 320-line bootstrap that installs the
  toolchain; port only if Bun becomes the explicitly supported first bootstrap
  dependency.
- `packages/dotfiles/install_macos.sh` — 197-line platform bootstrap with the
  same dependency ordering.
- `packages/dotfiles/claude-managed/install-managed-settings.sh` — 62-line
  macOS/sudo installer; adding Bun is disproportionate.
- `packages/dotfiles/bin/executable_chezmoi_watchman.sh` — 5-line command shim.
- `packages/dotfiles/bin/executable_sync-theme.sh` — 76-line macOS utility
  invoked during chezmoi apply, before Bun is guaranteed.
- `packages/dotfiles/bin/executable_write_brewfile.sh` — 11-line command shim.

### Minimal production containers

- `packages/homelab/src/cdk8s/src/resources/configs/qbittorrent/check-config-drift.sh`
  — 118 lines in a minimal init container.
- `packages/homelab/src/cdk8s/src/resources/configs/qbittorrent/hitandrun-share-limit.sh`
  — 148-line qBittorrent process hook whose configured contract explicitly
  invokes `/bin/bash`.
- `packages/homelab/src/cdk8s/src/resources/monitoring/scripts/zfs_zpool.sh` —
  132-line collector copied into a minimal node container.
- `packages/homelab/src/cdk8s/src/resources/monitoring/smartmon.sh` — 246 lines,
  but upstream-derived and embedded in a minimal smartmontools collector image.
  Its size clears the threshold; runtime weight and upstream divergence still
  make a Bun port worse.

## Quality Gates for Bun Ports

A Bun port is not complete merely because `bun path/to/script.ts` runs. Every
replacement must be owned by a workspace whose standard Turbo tasks make the
script part of `bun run verify`.

### TypeScript

- Every script, helper, and test must be included by an owning workspace
  `tsconfig.json`; free-floating TypeScript entrypoints are not allowed.
- Script configs must extend the root `tsconfig.base.json`, add Bun types where
  needed, and preserve `noEmit: true`. They may not weaken strictness locally.
- The existing strict settings remain mandatory, including
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`,
  `noPropertyAccessFromIndexSignature`, and
  `useUnknownInCatchVariables`.
- Follow the repository-wide ban on `any`, type assertions, TypeScript
  suppressions, and defensive fallbacks. Parse untrusted process output,
  environment variables, and file contents at their boundaries.

### ESLint and formatting

- Each owner must use the shared `@shepherdjerred/eslint-config` recommended
  preset with type information from its script tsconfig.
- Migrated script directories may not be ignored by ESLint. A package must
  remove an existing ignore or add an explicit script lint target before its
  first port.
- Keep the shared complexity, file-length, function-length, parameter-count,
  Bun-API preference, async/await, and no-type-assertion rules enabled. Split
  large ports into focused modules rather than adding exemptions.
- Operator-facing entrypoints may permit `console` for intentional stdout and
  stderr output; core modules do not need that exception.
- Prettier remains the formatting authority and is enforced through the normal
  repository verification path.

### Tests and behavioral parity

- Separate command planning and domain logic from the thin CLI entrypoint.
  Inject process execution, filesystem access, environment, clocks, and other
  nondeterministic boundaries where doing so makes behavior testable.
- Add focused Bun unit tests for parsing, planning, validation, and error paths,
  plus integration tests using temporary directories and controlled fake
  executables for filesystem and process behavior.
- Add a black-box entrypoint test for exit status, stdout, stderr, and observable
  side effects. Destructive scripts must test dry-run behavior and refusal/error
  paths.
- During migration, compare the Bun implementation with the shell original on
  representative fixtures whenever both can run safely. Remove the shell
  implementation only after parity is demonstrated.
- Use exact assertions; do not skip tests or replace precise expectations with
  truthiness checks.
- Run Bun's built-in coverage for migrated modules and require at least 90%
  line, function, and statement coverage. Every migrated entrypoint must be
  loaded by a smoke or black-box test so an unimported file cannot disappear
  from the coverage result.

### Workspace ownership

| Script surface                            | Quality-gate owner                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root `scripts/` and `.buildkite/scripts/` | Existing `@shepherdjerred/root-scripts`; replace the remaining Bash test invocations with `*.test.ts` under its strict typecheck, ESLint, and Bun test tasks. |
| Ordinary package-local scripts            | The package that owns the behavior; update its tsconfig includes and standard `typecheck`, `lint`, and `test` tasks in the same phase.                        |
| Discord Plays top-level scripts           | Add verified parent tooling workspaces for Pokémon and Mario Kart; the repository already supports parent and nested workspaces where ownership is distinct.  |
| Homelab operational scripts               | Add a strict top-level homelab script config and standard tasks; remove the current ESLint ignore for owned operational scripts.                              |
| Tasks for Obsidian scripts                | Add a strict Bun-oriented script tsconfig alongside the app tsconfig and run both from the package typecheck task.                                            |
| Astro OpenGraph script                    | Add a strict script tsconfig, or move reusable logic into `src/` and retain only a tested thin entrypoint.                                                    |
| Toolkit installer                         | Put reusable logic under the existing typed source tree or explicitly include `scripts/` in the package quality gates.                                        |
| Anki generator                            | Own the small generator from `@shepherdjerred/root-scripts` rather than creating a new package dependency surface.                                            |
| Dotfiles git cleanup                      | Create a dedicated verified dotfiles-script workspace; split the 771-line implementation into typed modules that remain within shared lint limits.            |

Before the first port, add a repository check that maps each migrated script
entrypoint to its workspace and verifies that it is included by that workspace's
typecheck, lint, and test surfaces. This prevents later ports from silently
escaping the quality gates.

## Porting Conventions

- Use Bun Shell for bounded command pipelines and its escaping/error behavior.
- Use `Bun.spawn` when output must be streamed, a child is long-lived, or exit
  handling needs explicit control.
- Use `Bun.file`, `Bun.write`, and `import.meta.dir` for file/path operations.
- Rename tests with their implementation (`*.test.sh` to `*.test.ts`) and keep
  caller changes in the same commit.
- Preserve exit codes, stdout/stderr routing, signal behavior, dry-run modes,
  and fail-fast semantics before removing the shell original.

## Public Interface Changes

### Dotfiles Git cleanup

`git_cleanup [directory]` becomes report-only by default. Mutations require
`--apply`; non-interactive mutation additionally requires `--yes`. Preserve
`--no-prs`, `--include-closed-prs`, `--remove-clean-worktrees`,
`--stale-pr-days`, `--summary`, `--verbose`, and `--no-color`.

- Never clear stashes implicitly.
- Do not provide an override that force-deletes unpushed branches.
- Never fall back to direct recursive deletion when `git worktree remove`
  refuses.
- Exit nonzero when any requested operation fails.

### Velero backup operations

Consolidate the two shell entrypoints under:

```text
bun run velero:backups -- inspect
bun run velero:backups -- delete-r2 --target backups|zfs|all --apply
bun run velero:backups -- delete-all --apply
```

Destructive operations require `--apply` plus an exact interactive
confirmation, or an explicit non-interactive confirmation flag. Verify the
postcondition and exit nonzero if any backup or object remains unexpectedly.

### Package scaffolding

`scripts/new-package.ts <kebab-name>` creates a strict workspace, updates the
sorted root workspace list, and refreshes the single root lockfile.

## Migration Phases

All phases land in the existing single draft PR, with a verified commit pushed
after each coherent phase:

1. Add the manifest/schema/ownership/coverage guard and strict workspace
   ownership.
2. Port root and small package utilities.
3. Port operational scripts and process supervisors.
4. Port WASM vendoring/build workflows with language-neutral upstream pin JSON.
5. Port Buildkite helpers and replace shell-parsing tests with independent
   fixtures/oracles.
6. Port and harden dotfiles Git cleanup.
7. Delete stale/vendored shell, update all callers/docs, and prove the final
   inventory.
8. Run full verification, attach terminal recordings for visible CLI behavior,
   update the draft PR, and confirm current-head Buildkite is green.

## Git Attribute Cleanup

The inventory exposed several ineffective or missing GitHub Linguist rules.

- Fixed both EmulatorJS patterns to recurse with `/**`.
- Marked committed Pokémon and Scout generator outputs as
  `linguist-generated=true`.
- Marked the maintained `discord-video-stream` fork as
  `linguist-vendored=true`.
- Re-verified the existing N64Wasm, cdk8s-generated, and snapshot attributes.

## Remaining

- [ ] Establish workspace ownership, strict script tsconfigs, shared ESLint
      coverage, test/coverage commands, and the migrated-script ownership check
      before landing the first port.
- [ ] Implement the port/delete/retain classification in reviewable phases.
- [ ] Verify each replacement against the original script's observable behavior
      before deleting the shell implementation.
- [ ] Update every package, Buildkite, documentation, and test caller alongside
      its migrated entrypoint.

## Session Log — 2026-07-27

### Done

- Inventoried and classified all 62 tracked `.sh` files outside `sandbox/`.
- Established the runtime-availability and script-size decision rules.
- Added and verified effective Linguist attributes for the discovered generated
  and vendored paths.
- Made strict TypeScript, shared type-aware ESLint, Prettier, behavior tests, and
  90% coverage mandatory deletion gates for every Bun replacement.
- Assigned each planned port surface to a verified workspace and identified the
  package configurations that must be expanded before those ports land.
- Published the attribute cleanup and migration design in draft PR #1710.

### Remaining

- [ ] Add the common script-quality scaffolding and ownership check.
- [ ] Implement the port/delete/retain classification in reviewable phases.
- [ ] Harden the dotfiles cleanup and Velero destructive interfaces.
- [ ] Record and attach terminal demonstrations for changed CLI behavior.

### Caveats

- Bootstrap scripts may remain shell even when large because they install or
  precede Bun itself.
- `docker-env.sh` has no executable caller and will be deleted with its stale
  validator/image-selection references.
- The Apple HIG scraper wrapper is already stale; its replacement depends on
  whether scraper maintenance is still desired.
- Several package script directories are not currently covered by their
  package's tsconfig or ESLint configuration; their ports cannot begin until the
  ownership changes above are in place.
