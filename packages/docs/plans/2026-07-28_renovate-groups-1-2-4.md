---
id: renovate-groups-1-2-4-2026-07-28
type: plan
status: in-progress
board: false
---

# Consolidated Renovate Groups 1, 2, and 4

## Goal

Land the selected Renovate dependency updates in one git-spice pull request while preserving current application behavior and completing the PostgreSQL operator v2 migration as one controlled maintenance event.

## Scope

- Root dependency resolutions:
  - `fast-uri` 4.1.1
  - `postcss` 8.5.24
- Tasks for Obsidian:
  - `react-native-gesture-handler` 3.1.0
- Astro:
  - `astro` 7.1.5
  - `@astrojs/mdx` 7.0.5
  - `@astrojs/react` 6.0.2
  - `@astrojs/markdown-remark` 7.2.2
- Shared linting:
  - `eslint-plugin-unicorn` 69.0.0
- Discord video:
  - `node-av` 6.1.1
- Helm:
  - `kube-prometheus-stack` 87.21.0
  - `prometheus-blackbox-exporter` 11.16.0
  - `postgres-operator` 2.0.0

Scout and Starlight production image promotions are excluded. The Scout Astro frontend remains in scope as an Astro consumer.

## Implementation

### Dependency and native lockfiles

- Update root overrides for `fast-uri` and `postcss`.
- Update direct example declarations of `fast-uri`.
- Update Tasks for Obsidian and regenerate its CocoaPods lockfile.
- Regenerate the single root `bun.lock`.

### Astro 7 migration

- Upgrade all eight active Astro manifests and the corresponding integrations.
- Set `compressHTML: true` in every Astro config to preserve Astro 6 whitespace behavior.
- Configure `sjer.red` with `markdown.processor: unified()` because it uses custom remark and rehype plugins.
- Remove Scout's unused, incompatible `@astrojs/tailwind`.
- Rebase the Astro and `@astrojs/internal-helpers` Bun patches onto the installed versions.
- Build and test every active Astro consumer, including Playwright coverage and rendered parity captures.

### ESLint Unicorn 69

- Upgrade the shared config and direct consumers.
- Preserve the explicitly reviewed Unicorn 64 policy as a positive allowlist while running the Unicorn 69 rule implementations.
- Map the four renamed rules and preserve the prior file-only filename behavior instead of implicitly adopting Unicorn 69's new directory checks.
- Apply and review the safe rewrites required by retained-rule behavior changes without suppressions or type assertions.
- Run the repository-wide lint graph and full verification.

### node-av 6

- Upgrade `@shepherdjerred/discord-video-stream`.
- Preserve its public exports and consumer signatures.
- Add a deterministic native FFmpeg integration test covering real demux, decode, filter, assertions, cleanup, and failure behavior.
- Verify every direct consumer plus the existing stream and Mario Kart media paths.

### Helm updates

- Update the three chart versions in `versions.ts`.
- Regenerate committed Helm types, retain only target-chart drift, and prove a second generator run is clean.
- Configure postgres-operator v2 with ConfigMap DCS and a single worker while retaining SCRAM, cross-namespace secrets, PDB, Patroni failsafe, and backup-label behavior.
- Render every updated chart and validate the full homelab package.

### PostgreSQL operator maintenance event

Before merge:

- Confirm all four PostgreSQL resources are `Running`.
- Create and validate an on-demand Velero backup, including the complete R2 volume data set.

After merge and GitOps reconciliation:

- Confirm postgres-operator v2 is healthy and all four databases and clients are healthy.
- Confirm each cluster has the expected `-config`, `-failover`, and `-leader` ConfigMaps.
- Remove only the four obsolete `*-postgresql-config` Endpoint DCS objects, retaining master and replica Endpoints.
- Create and validate another full backup.
- If rollback is required, downgrade only the operator to 1.15.1 while retaining ConfigMap DCS; do not revert the consolidated dependency pull request or move DCS back to Endpoints.

## Verification

- Fresh worktree bootstrap: pinned toolchain, frozen root install, generated sources, and git hooks.
- `bun pm why` confirms the selected root resolutions.
- Tasks for Obsidian: unit, contract, typecheck, lint, Release Metro bundle, CocoaPods, and simulator swipe behavior in both directions.
- Astro: build, typecheck, lint, and tests for every active consumer; `sjer.red` Playwright; before/after production render captures.
- Unicorn: repository-wide lint with zero errors.
- node-av: package and consumer build/typecheck/tests, native FFmpeg integration, Streambot local e2e, and Mario Kart synthetic audio.
- Homelab: build, typecheck, lint, tests, deterministic Helm type generation, and live-fetch Helm rendering.
- Explicit-path staging and the complete pre-commit hook.
- Full local `bun run verify`.
- Current-head Buildkite, review-thread, and merge-tree checks before marking the pull request ready.

## Remaining

- [x] Bootstrap the isolated worktree and install dependencies.
- [x] Implement dependency, migration, patch, test, and generated-type changes.
- [x] Complete focused and repository-wide verification.
- [x] Publish the consolidated draft git-spice pull request.
- [x] Drive the pull request to ready for human review.
- [ ] Complete pre-merge PostgreSQL and backup gates.
- [ ] After human merge, verify current main CI and complete the PostgreSQL maintenance event.
