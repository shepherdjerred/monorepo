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
