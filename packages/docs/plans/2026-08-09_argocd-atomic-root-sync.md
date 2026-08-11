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
  `BUILDKITE_BUILD_ID`. First stage every unchanged root resource with an
  exact-revision, source-selective sync. Use local manifest overrides only for
  child Applications whose auto-sync policy is deliberately rewritten to stay
  disabled. This makes root-owned prerequisites available before child
  reconciliation without racing an automatic child operation, while preserving
  Argo's normal source-apply behavior for cluster-scoped prerequisites. Bound
  each override request to 750 kB because ArgoCD's operation-state update
  carries both the requested and completed operation inside its 2 MiB controller
  message ceiling. Keep each source or override request within one numeric Argo
  sync wave and submit waves in ascending order, so health waiting in one wave
  cannot leave later-wave prerequisites unapplied. Terminate each exact staged
  batch after all selected resources apply; a degraded ordinary resource is
  deferred to the scoped health gate, while a failed resource carrying an
  actual Argo hook type remains a hard failure. Persist the exact revision in
  operation info alongside both UUIDs because Argo omits
  `operation.sync.revision` for manifest-override operations; when both
  representations exist, require them to agree.
  Reconcile children with aggregate health deferred, then atomically restore
  and prune the exact root tree before one scoped release-health gate. The
  finalizer reapplies the exact desired tree in the same isolated wave batches
  before starting the full-source prune. Unchanged resources use source-selective
  syncs; only the self-managed root Application uses a manifest override so it
  stays auto-sync suspended across every batch. Restoring it early could start
  an unowned full-source operation between batches. The final prune restores
  that policy and therefore still requires the root Application's applied
  result alongside every validated prune candidate. The separate batch proof is
  necessary
  because Argo can withhold later-wave results forever while a self-referential
  or degraded ordinary Application remains unhealthy in an earlier wave. Once
  every desired batch is applied, the prune operation needs to prove every
  validated prune candidate rather than repeat desired-resource coverage that
  Argo cannot publish across the blocked wave. A retry adopts only the exact
  active desired batch or final prune selected by the same request and revision
  and carrying the finalizer's explicit `batch` or `prune` operation marker.
  Prune adoption also requires `operation.sync.prune: true`; a matching but
  unmarked full-source operation is not evidence that the desired batches ran.
  Reject the old full-source final sync, split lifecycle, child-only staging,
  eager duplicate gates, shell-wrapped commands, and unsafe ordering in
  pipeline validation.
  Serialize every desired automated sync policy with an explicit `enabled`
  boolean. Restoring `enabled: false` to an empty object makes Argo's patch
  encode `automated: null`, which the Application CRD rejects; validate the
  synthesized chart corpus so that implicit policy cannot return.
- Override cert-manager Certificate health so the normal initial
  `Ready=False` / `DoesNotExist` transition remains `Progressing` while the
  controller creates its target Secret. Keep other false Ready conditions and
  a simultaneous `Issuing=False` failure `Degraded`, and retain the operation
  timeout as the upper bound. This lets certificate sync waves wait for actual
  readiness without ignoring their health or weakening terminal failure
  handling.
- Treat anonymous image access as part of the release handoff. Every
  application image links its GHCR package to the public monorepo through the
  OCI source label. A new package still requires an explicit one-time public
  visibility bootstrap because repository association does not change its
  private default. After pushing an exact candidate, resolve its digest, poll
  for an anonymous token, and fetch that immutable digest without publisher
  credentials. Inspect the effective OCI configuration at that digest and
  require the exact monorepo source label before recording any pin candidate.
  A private or incorrectly labeled package must fail image publication before
  its digest can reach GitOps. Resolve the current comparison digest and
  commit-back key from the structured `version-catalog.json` source of truth,
  not from the generated `versions.ts` runtime projection. Validate the real
  catalog against every bake target so a catalog representation change fails
  before an expensive production push.

## Verification

- Cover delayed visibility, stale state, exact retry adoption, identity and
  revision mismatches, natural success, failed phases, timeouts, applied-result
  termination, partial sync and prune waves, active desired-batch and final
  prune adoption, legacy recovery, post-termination waiting, and interference.
- Exercise the live result shape: 255 synced resources, two pruned resources,
  and five child Applications still in a running health phase.
- Run focused Bun tests, homelab typecheck and lint, pipeline validation, staged
  pre-commit checks, and the complete root verification graph.
- Cover delayed GHCR visibility and manifest propagation, a package that stays
  private, static and effective-image source-label completeness, and Turbo
  invalidation for Buildkite script inputs. Prove every image bake target
  resolves its exact pin from the real structured version catalog.
- Cover the cert-manager health override in the synthesized ArgoCD Application
  and prove initial Secret issuance is distinct from terminal Certificate
  failure.
- Recover the stranded operation only after its live identity and complete
  applied result are revalidated.
- Require an exact-head PR build and then a fresh successful build of the
  current remote `main` SHA.

## Remaining

- [x] Implement and verify the atomic root lifecycle, recover the stranded
      operation, and merge its exact validated head.
- [ ] Publish the anonymous-image handoff fix and confirm the current `main`
      build plus its scoped release health gate are green.
