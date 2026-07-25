---
id: log-2026-05-21-helm-types-publish-pkg-path-fix
type: log
status: complete
board: false
---

# helm-types npm publish — fix `file:` dep resolution in Dagger container

## Context

Build [#2635](https://buildkite.com/sjerred/monorepo/builds/2635) (and #2622 / #2630 / #2632 before it) failed the `:npm: Publish @shepherdjerred/helm-types (dev)` step with:

```
ENOENT: failed opening cache/package/version dir for package @shepherdjerred/eslint-config
355 packages installed [865.00ms]
Failed to install 1 package
```

[2026-05-20_main-ci-five-hard-failures.md](../plans/2026-05-20_main-ci-five-hard-failures.md) and commit `20e230261` fixed the WORKSPACE_DEPS lookup so `--dep-names eslint-config --dep-dirs ./packages/eslint-config` now reaches the dagger call. The remaining failure is a deeper layout bug.

## Root cause

`publishNpmHelper` mounted the package at `/workspace/packages/${pkg}` where `pkg` is the **npm name**. For top-level unscoped packages (`webring`, `astro-opengraph-images`) the npm name matches the on-disk dir, so `file:../eslint-config` resolves to the dep mount. For scoped/nested packages it diverges:

| package                      | on-disk path                      | mount path (old)                                 | `file:` ref                   | resolves to                         | dep mounted at                         |
| ---------------------------- | --------------------------------- | ------------------------------------------------ | ----------------------------- | ----------------------------------- | -------------------------------------- |
| `@shepherdjerred/helm-types` | `packages/homelab/src/helm-types` | `/workspace/packages/@shepherdjerred/helm-types` | `file:../../../eslint-config` | `/workspace/eslint-config`          | `/workspace/packages/eslint-config` ❌ |
| `webring`                    | `packages/webring`                | `/workspace/packages/webring`                    | `file:../eslint-config`       | `/workspace/packages/eslint-config` | `/workspace/packages/eslint-config` ✓  |

`file:` paths are written relative to the source-tree layout, so the mount must mirror the source layout, not the npm-name layout.

## Fix

Add an explicit `pkgPath` arg (on-disk path under `packages/`) to the Dagger function; use it for mount + workdir.

- [.dagger/src/release.ts:232](../../../.dagger/src/release.ts) — `publishNpmHelper(..., pkgPath = "")` mounts at `/workspace/packages/${pkgPath || pkg}`.
- [.dagger/src/index.ts:901](../../../.dagger/src/index.ts) — decorated `publishNpm` passes `pkgPath` through.
- [scripts/ci/src/steps/npm.ts:33](../../../../scripts/ci/src/steps/npm.ts) — derives `pkgPath = pkg.dir.replace(/^packages\//, "")` and adds `--pkg-path` to every dagger call.
- [scripts/ci/src/\_\_tests\_\_/pipeline-builder.test.ts](../../../../scripts/ci/src/__tests__/pipeline-builder.test.ts) — regression test: every dev publish step carries `--pkg-path`, and helm-types specifically gets `homelab/src/helm-types`.

Default of `""` falls back to `pkg`, so legacy callers (none in tree, but harmless) keep working for unscoped top-level packages.

## Verification

| Check                                                                                                     | Result                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun test scripts/ci/src/__tests__/pipeline-builder.test.ts`                                              | 46 pass / 226 expects                                                                                                                                                         |
| `bunx tsc --noEmit` in `.dagger` and `scripts/ci`                                                         | clean                                                                                                                                                                         |
| `dagger call publish-npm --pkg @shepherdjerred/helm-types --pkg-path homelab/src/helm-types ... --dryrun` | passes through `bun install --frozen-lockfile`, file-ref rewrite, version bump, and `bun run build`; `DRYRUN: would publish @shepherdjerred/helm-types to npm with --tag dev` |
| Same dry-run for `webring` (unscoped)                                                                     | passes — no regression                                                                                                                                                        |

## Out of scope

- The `astro-opengraph-images` / `webring` 404s on build 2635 were token-side and addressed separately by the user.
- Release Please, Version Commit-Back, and other unrelated failures noted in the original plan are not addressed here.

## Session Log — 2026-05-21

### Done

- Diagnosed `ENOENT` as mount-path vs `file:`-ref-path mismatch for scoped/nested npm packages.
- Added `pkgPath` arg through `publishNpmHelper` → `publishNpm` → CI step generator (`--pkg-path`).
- Added regression test in `pipeline-builder.test.ts`.
- Verified via local `dagger call ... --dryrun` for both helm-types (scoped) and webring (unscoped).

### Remaining

- Watch the next main build to confirm `@shepherdjerred/helm-types (dev)` goes green end-to-end against the real npm registry.

### Caveats

- `dagger develop` regenerated `.dagger/sdk/` locally (gitignored), so type-checking the Dagger module requires running it after pulling these changes.
