---
id: ci-release-correctness
type: plan
status: in-progress
board: false
---

# CI release correctness

Make CI affected ranges cumulative from the last green build, publish only
deployable-content changes, and keep early Helm and qualified Scout releases
internally consistent.

## Decisions

- The recorded last-green commit is the sole affected-range authority; invalid
  or unavailable bases fail open.
- Application images are promoted only after exact-digest smoke tests and a
  runtime fingerprint that includes rootfs plus runtime OCI configuration.
- `ci-base` and `ci-playwright` use independent immutable digest pins and
  candidate-to-pin-PR promotion. Playwright package, browser image, and resolved
  browser revisions stay in lockstep.
- Helm compares canonical chart content against ChartMuseum, publishes changed
  leaves first, and publishes the coordinating `apps` chart last with exact
  child revisions.
- Helm may deploy before overall CI is green. Scout may mint a promotable
  release after Scout-specific prerequisites pass, while live beta waits for
  its matching backend.
- Version commit-back merges exact pin keys monotonically and cannot downgrade
  newer main or pending state.
- Argo reconciliation verifies every expected child and all managed
  Applications declare safe cascade or explicit retain behavior.

## Remaining

- [x] Implement exact affected ranges, image selection, runtime fingerprints,
      exact-digest smoke tests, and content-only promotion.
- [x] Migrate Playwright and CI base to tested immutable digest pins.
- [x] Implement selective coordinated Helm publication and child-aware Argo
      reconciliation.
- [x] Make Scout release/reconcile inputs exact and version commit-back
      monotonic.
- [x] Fix Cooklang manifest comparison, selectors, and build summary coverage.
- [x] Run full local verification and publish the git-spice PR.
- [ ] Merge the PR and observe the first post-merge promotion cycle.

## Session Log — 2026-07-28

### Done

- Validated the CI history and preserved the intended pre-green Helm and
  Scout-specific release behavior.
- Made affected selections cumulative from the latest green build and made
  image, chart, package, and site promotion content-aware.
- Added immutable CI image pins, exact-digest application smoke tests,
  monotonic pin arbitration, coordinated Helm/Argo reconciliation, and strict
  Scout and Cooklang release-state verification.
- Added an atomic Playwright upgrade path coupling the tested image digest,
  package versions, and lockfile.
- Passed `bun run verify`: 217 of 217 repository tasks succeeded.
- Passed `bun run verify -- --affected` after moving the Mario Kart runtime
  image's non-root boundary into the shared runtime stage.
- Fixed the automated review's P2 by forcing mutable Scout beta entrypoints to
  upload when deploying immutable archived bytes.
- Fixed three amended-SHA review P2s: selector/execution changes now reconcile
  affected images, yt-dlp verifies the pinned release's checksum manifest, and
  Renovate-managed image pins use structural rather than exact-value tests.
- Fixed the restored all-target hosted smoke's shared-network collision by
  assigning unique application listener ports and extending the uniqueness
  validator across application and infrastructure smokes.
- Passed the post-review `bun run verify -- --affected`: 211 of 211 tasks
  succeeded after correcting the lint and formatting issues it surfaced.
- Restacked onto current main, retained its stale generated-branch regression
  test through the new monotonic arbitration path, and passed the then-current
  affected verification: 70 of 70 tasks.
- Closed the remaining selector-closure review gaps for image orchestration,
  the Helm planner, and both CI-image cores; focused selector/pipeline tests and
  the replacement affected verification passed 75 of 75 tasks.
- Closed the final review P2 by making CI base promotion, pipeline upload, and
  the Buildkite UV-cache CronJob share one immutable digest file; the rendered
  CronJob manifest is now tested against the exact promoted digest.
- Preserved the latest main fixed-corpus work while restoring the Helm planner
  and shared image-smoke PR-gate inputs and splitting CI-image/runtime helpers
  along their existing ownership boundaries; the final affected verification
  passed 70 of 70 tasks, with the moved Homelab consumer separately passing
  lint, typecheck, and tests.
- Published PR #1776 and marked it ready after local and hosted mechanical
  verification completed.
- Resolved the next current-head review findings: shared BuildKit helper changes
  now select both CI image lanes, Homelab reads the promoted CI digest through
  Bun, and deduplicated Scout archives receive a current-build version alias
  without changing or duplicating their certified bytes. Legacy archive records
  remain readable and content mismatches fail closed.
- Passed the replacement focused tests, package lint/typecheck, Buildkite
  validators, Homelab cdk8s checks, and `bun run verify -- --affected`: 70 of 70
  tasks succeeded.
- Passed exact-head Buildkite build #6913, including verify, image build and
  smoke, deployment dry-run, Playwright, observability, security, and automated
  review. All review threads are resolved, and the PR is conflict-free against
  the latest `origin/main`.

### Remaining

- Merge PR #1776 and verify the first main-branch candidate/pin and no-op
  promotion behavior against live GHCR, ChartMuseum, S3, and Argo state.

### Caveats

- Live registry, object-store, and Argo conditional-write behavior can only be
  proven by hosted main CI after merge; local dry runs do not mutate them.
