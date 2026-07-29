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

## Session Log — 2026-07-28

### Done

- Created the isolated `deps/renovate-1-2-4` worktree from `origin/main`, installed the pinned toolchain and frozen Bun workspace, generated sources, and installed hooks.
- Updated the selected Bun, Astro, React Native, native media, and Helm dependencies and regenerated the root lockfile, CocoaPods lockfile, Astro patches, and target Helm types.
- Migrated all Astro consumers for Astro 7, including Tailwind 4 Vite integrations, `sjer.red`'s Unified Markdown processor, legacy content collections, and explicit HTML compression.
- Added a real `node-av` FFmpeg demux/decode/filter integration test with deterministic frame assertions, cleanup, and missing-input failure coverage.
- Added `07-swipe-actions.yaml` and vault assertions for React Native Gesture Handler 3: left-swipe completion and confirmed right-swipe deletion.
- Verified the Tasks native build and release bundle, 8/8 Maestro flows, five backing-vault assertions, Astro builds/typechecks/examples, 110 Playwright visual snapshots across three browsers and mobile/light/dark variants, node-av's 61 tests, all affected TypeScript consumers, homelab build/typecheck/255 tests, deterministic Helm generation, and live-fetch rendering for all 25 charts.
- Captured `/tmp/tasks-for-obsidian-swipe-actions.mp4` as the pull-request gesture demonstration.
- Restacked the commit onto current `main`, published pull request [#1791](https://github.com/shepherdjerred/monorepo/pull/1791), and attached the simulator recording.
- Traced current-head Buildkite build [6797](https://buildkite.com/sjerred/monorepo/builds/6797) to Unicorn 69: the first executable failure is `sjer.red` lint with 14 new-rule errors, after which the main verify lane was canceled.
- Ran the full repository lint graph with safe fixes as a migration-size diagnostic. It mechanically rewrote 1,359 files and still left 46 lint tasks failing, so every diagnostic rewrite was restored and the committed dependency implementation remains unchanged.
- Decoupled the dependency update from a surprise lint-policy expansion: added an explicit 137-rule reviewed Unicorn policy, mapped all four renamed v69 rules, preserved the prior filename scope, and added invariant tests that reject missing, extra, or unmapped rules.
- Reviewed and retained the behavior-preserving source rewrites required by the existing policy under Unicorn 69, with no lint suppressions or type assertions.
- Removed a full-verification race by replacing the broad package-patch glob with deterministic authored-source traversal that skips generated trees, and gave the subprocess-heavy version-bump Git fixture an explicit 20-second test budget.
- Completed the repository-wide lint graph with all 66 tasks passing, the affected build/typecheck/test graph with all 134 tasks passing, and the exhaustive local verification gate with all 217 tasks passing.
- Traced current-head Buildkite build [6835](https://buildkite.com/sjerred/monorepo/builds/6835) to three clean-workspace prerequisites that local build artifacts had masked: Temporal's rehearsal imported unbuilt outer-workspace Glitter exports, Scout's root test pattern unintentionally selected nested backend tests, and the node-av integration assumed a system FFmpeg binary.
- Declared Temporal's upstream build dependency, anchored Scout's root test path to its owned scripts, and made the node-av fixture use the trusted repo-pinned `ffmpeg-static` binary.
- Re-ran the exact Temporal clean-copy rehearsal, Scout root test, and node-av native suite successfully, then completed the exhaustive local verification gate again with all 217 tasks passing.
- Confirmed Buildkite build [6854](https://buildkite.com/sjerred/monorepo/builds/6854) passed verify, Playwright, resume, observability, Trivy, Semgrep, deployment drift, and image build/smoke on commit `28d55ca60`.
- Addressed and resolved the reviewer’s stale FFmpeg P1 with current-head evidence: the integration test uses the pinned `ffmpeg-static` binary and passed the hosted clean-workspace verify lane.
- Reproduced the required `ci/merge-conflict` result with its exact explicit-merge-base command, restacked with git-spice onto `9be7cdadfc`, and resolved the two mechanical image-validator overlaps by retaining current `main` fixture data and Unicorn-required switch-case braces.
- Verified the restacked head with the focused eight-test image-validator suite, the exact merge-tree oracle, and the exhaustive local verification gate: all 217 tasks passed in 3m50s.
- Accepted a current-head reviewer finding that `ffmpeg-static` was present in the lock package table but absent from the `discord-video-stream` importer, regenerated the root lockfile, and revalidated the frozen install, native integration test, and package typecheck.
- Drove pull request #1791 through green current-head Buildkite build [6873](https://buildkite.com/sjerred/monorepo/builds/6873), resolved all review threads, confirmed a clean merge tree, and observed its merge as `52f25f271`.
- Verified current-main Buildkite build [6874](https://buildkite.com/sjerred/monorepo/builds/6874) passed all selected main, release, deployment, reconciliation, and summary lanes.
- Confirmed postgres-operator v2.0.0 reconciled successfully; all four single-member databases rolled serially to ready `spilo-18:4.1-p2` primaries with zero restarts, and their Bugsink, Plausible, Grafana, and Temporal consumers remained ready.
- Identified four v2 CRD defaults that left the healthy postgres-operator Application perpetually `OutOfSync`, encoded them explicitly in the typed Helm values, and added a synthesis regression test.

### Remaining

- Wait for the serialized pre-migration Velero backup to reach a terminal phase and validate its complete R2 volume data set.
- Remove only the four verified obsolete DCS config Endpoints, retain the database service Endpoints, and revalidate the four databases and their clients.
- Create and validate the post-migration full backup after the first backup releases the ZFS writer.
- Publish the small postgres-operator desired-state follow-up and drive its current-head Buildkite and review gates to green.

### Caveats

- The pre-migration backup was created before merge and is actively uploading full ZFS volume data to R2, but it had not reached a terminal Velero phase when the merge occurred.
- The post-merge DCS cleanup removes only obsolete `*-postgresql-config` Endpoints; service Endpoints remain.
- The active ConfigMap DCS contains each cluster's `-config` and `-leader` keys. The optional `-failover` key is absent because no failover is pending; its absence is not a migration failure.
- The live postgres-operator Application is healthy but remains `OutOfSync` until the four Kubernetes-defaulted v2 fields are made explicit by the follow-up change.
- Unicorn 69's `recommended` preset is not treated as an automatically accepted policy change. The shared config now positively enumerates the 137 previously reviewed rules against the v69 plugin, so future policy additions remain explicit, reviewable changes.
