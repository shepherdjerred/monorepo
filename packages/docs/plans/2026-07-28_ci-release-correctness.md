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

- [ ] Implement exact affected ranges, image selection, runtime fingerprints,
      exact-digest smoke tests, and content-only promotion.
- [ ] Migrate Playwright and CI base to tested immutable digest pins.
- [ ] Implement selective coordinated Helm publication and child-aware Argo
      reconciliation.
- [ ] Make Scout release/reconcile inputs exact and version commit-back
      monotonic.
- [ ] Fix Cooklang manifest comparison, selectors, and build summary coverage.
- [ ] Run full verification, publish the git-spice PR, and resolve current-head
      CI and review findings.

## Session Log — 2026-07-28

### Done

- Validated the CI history, release-path gaps, and intended pre-green release
  behavior.
- Approved one comprehensive implementation PR.

### Remaining

- Complete every implementation and verification item above.

### Caveats

- The main checkout contains unrelated untracked documentation files that must
  remain untouched.
- Post-merge no-op and coordinated-release behavior cannot be observed until
  the implementation PR lands.
