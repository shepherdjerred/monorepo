---
id: scout-prod-webapp-version-skew-2026-07-27
type: log
status: complete
board: false
---

# Scout production webapp version skew

Investigating the reported Scout UI/API version mismatch in production.

## Session Log — 2026-07-27

### Done

- Confirmed the production backend is healthy and deployed as
  `ghcr.io/shepherdjerred/scout-for-lol:2.0.0-6529` (`ec51d6f`).
- Confirmed the public and in-cluster `/app/` entrypoint still references
  `index-oXqOHrAU.js`, whose embedded identity is app `2.0.0-6365` at
  `6c0029c`.
- Confirmed `/.release-version` reports `2.0.0-6529`, so the marker is ahead
  of the actual webapp bundle.
- Traced the divergence to Buildkite build 6576's successful
  `scout-prod-reconcile` job: it downloaded the `2.0.0-6529` archive and wrote
  the marker, but the S3 synchronization did not upload the mutable
  `app/index.html`. It only uploaded a subset of new immutable asset keys.
- Added a forced mutable-file copy for archive-to-production reconciliations,
  preserving immutable bundles and the release marker.
- Added byte-for-byte verification of `index.html` and `app/index.html` against
  the selected release archive before the production marker can advance.
- Extended reconciliation to verify those entrypoints even when the marker
  already equals the image pin; a stale entrypoint now triggers repair instead
  of an unsafe no-op.
- Treats a missing live entrypoint as repairable drift, while continuing to
  fail on every other S3 read error before attempting a repair.
- Added regression coverage for the forced copy command, restored the
  Buildkite validator to its configured file-size budget, and passed all 27
  affected verification tasks.
- Opened PR #1731 for the production reconciliation fix.

### Remaining

- Merge and run the next main Buildkite reconciliation, then verify the live
  production entrypoint resolves to app `2.0.0-6529` before closing the
  incident.

### Caveats

- The marker stays last. The reconciliation now force-copies mutable entrypoints
  and proves their bytes match the release archive before it advances or accepts
  an existing matching marker.
