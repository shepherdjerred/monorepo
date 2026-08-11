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
- Give each submitted ArgoCD operation a generated internal operation ID. A
  retry adopts that ID from the live operation and accepts status only when the
  same ID appears, so a stable applied result is reusable without confusing it
  with stale status from an earlier attempt that reused the build UUID.
- Poll through absent or stale operation state. Fail on an exact `Failed` or
  `Error` result, and terminate only after every resource in the exact rendered
  revision appears in the result with an applied status, every validated prune
  candidate appears as `Pruned`, and no hook has failed. Accept natural success
  only after its authoritative live operation clears. Partial earlier sync or
  prune waves are not complete.
- After termination, use a fresh timeout, return when the authoritative live
  operation clears even if status lags, and fail if another operation ID
  replaces the exact operation first.
- Retain `finalize-async-sync` only for recovery. Require both the exact request
  ID and revision, discover the internal operation ID from the matching live
  operation, and never treat missing operation state as success. For the
  stranded pre-change operation only, accept a missing internal ID when both
  live and completed state carry the exact request and revision and neither
  carries an internal ID.
- Wire the main Buildkite release to the atomic command with
  `BUILDKITE_BUILD_ID`. First stage every rendered root resource through
  manifest overrides that keep every child Application's auto-sync disabled.
  This makes root-owned prerequisites available before child reconciliation
  without racing an automatic child operation. Bound each override request to
  750 kB because ArgoCD's operation-state update carries both the requested and
  completed operation inside its 2 MiB controller message ceiling. Keep each
  request within one numeric Argo sync wave and submit waves in ascending order,
  so health waiting in one wave cannot leave later-wave prerequisites unapplied.
  Terminate each exact staged wave after all selected resources apply; a
  degraded ordinary resource is deferred to the scoped health gate, while a
  failed resource carrying an actual Argo hook type remains a hard failure.
  Reconcile children with aggregate health deferred, then atomically restore
  and prune the exact root tree before one scoped release-health gate. Reject
  the old split lifecycle, child-only staging, eager duplicate gates,
  shell-wrapped commands, and unsafe ordering in pipeline validation.

## Verification

- Cover delayed visibility, stale state, exact retry adoption, identity and
  revision mismatches, natural success, failed phases, timeouts, applied-result
  termination, partial sync and prune waves, legacy recovery,
  post-termination waiting, and interference.
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
