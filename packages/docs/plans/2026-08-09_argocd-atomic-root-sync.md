---
id: plan-2026-08-09-argocd-atomic-root-sync
type: plan
status: in-progress
board: false
---

# ArgoCD atomic root sync

## Summary

The main-only homelab release split the root Application lifecycle across an
asynchronous sync process and a separate finalizer. ArgoCD could accept the
sync immediately but publish its operation state after the finalizer's first
read. Treating that missing state as success stranded a fully applied operation
in `Running`, and the next release failed before publishing charts because
ArgoCD permits only one operation per Application.

Replace the split lifecycle with one identity-bound command. It must retain the
Buildkite build UUID through submission, application, and termination; adopt
only an exact retry; and keep the scoped release-health gate authoritative.

## Implementation

- Add `sync --terminate-after-applied --request-id <uuid>`. Keep ordinary
  synchronous and explicitly asynchronous sync behavior unchanged.
- Before submission, adopt only an active operation with the exact request ID
  and revision. Refuse any unrelated active operation.
- Poll through absent or stale operation state. Fail on an exact `Failed` or
  `Error` result, accept natural success, and terminate only after every
  resource reports an applied status with no failed hook.
- After termination, use a fresh timeout and fail if another operation replaces
  the exact operation before it clears.
- Retain `finalize-async-sync` only for recovery. Require both the exact request
  ID and revision, and never treat missing operation state as success.
- Wire the main Buildkite release to the atomic command with
  `BUILDKITE_BUILD_ID`; reject the old split lifecycle in pipeline validation.

## Verification

- Cover delayed visibility, stale state, exact retry adoption, identity and
  revision mismatches, natural success, failed phases, timeouts, applied-result
  termination, post-termination waiting, and interference.
- Exercise the live result shape: 255 synced resources, two pruned resources,
  and five child Applications still in a running health phase.
- Run focused Bun tests, homelab typecheck and lint, pipeline validation, staged
  pre-commit checks, and the complete root verification graph.
- Recover the stranded operation only after its live identity and complete
  applied result are revalidated.
- Require an exact-head PR build and then a fresh successful build of the
  current remote `main` SHA.

## Remaining

- [ ] Complete local verification and publish the exact-head pull request.
- [ ] Recover the stranded operation, merge, and confirm current `main` is green.
