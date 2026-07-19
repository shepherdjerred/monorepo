---
id: argocd-apps-prune-policy
status: active
origin: packages/docs/logs/2026-07-18_ci-green-verify-hardening.md
---

# ArgoCD `apps` never prunes — orphaned resources accumulate; decide a prune policy

## Problem

`apps` (and every other Application here) has `syncPolicy.automated: {}` —
automated sync without prune — and the CI sync
(`packages/homelab/scripts/argocd.ts sync`) POSTs no `prune` flag (neither
did the old Dagger `argoCdSyncHelper`). Resources removed from manifests are
therefore **never deleted**: they sit live in-cluster with
`requiresPruning: true` forever.

This broke main CI (build 5748): the seaweedfs S3 `TunnelBinding` was removed
from manifests in #1340 (2026-06) with a fail-closed pipeline gate that waits
for its deletion before the Cloudflare tofu apply — but nothing ever pruned
it, so the gate timed out on every main build once the replatformed pipeline
reached it. Resolved 2026-07-19 by manually deleting the binding (finalizer
completed, tunnel route removed; DNS removal was already declared in tofu).

## Current orphan inventory (2026-07-19)

`requiresPruning: true` across apps:

- **apps**: the entire Dagger CI stack — `dagger` Namespace, `dagger-engine`
  Service, `docker-config-builder` ServiceAccount/Role/RoleBinding, `dagger`
  child Application, PrometheusRule, `docker-hub-credentials`
  OnePasswordItem, `zfs-ssd-buildcache` StorageClass. Leftover from the CI
  replatform (#1516 removed the manifests).
- **argocd**: `argocd-redis-secret-init` SA/Role/RoleBinding
- **cert-manager**: `cert-manager-tokenrequest` Role/RoleBinding
- **kyverno**: `kyverno-migrate-resources` Job
- **nfd**: `nfd-node-feature-discovery-prune` SA
- **seaweedfs**: `seaweedfs-db-secret`, `secret-seaweedfs-db` Secrets
- **temporal**: `temporal-namespace-init` Job

## Decision needed

Pick one:

1. **Enable prune** (`automated: { prune: true }` on `apps`, or `{"prune":
true}` in the CI sync POST) — restores real GitOps semantics and makes
   gates like the tunnel one work unattended. MUST be preceded by a
   deliberate review of the inventory above: pruning `apps` deletes the whole
   Dagger stack (incl. the buildcache StorageClass) in one shot.
2. **Keep prune off** and treat removals as operator actions — then remove
   the `wait-deletion` tunnel gate pattern from the pipeline, because it can
   only pass with manual intervention.

Option 1 after a supervised cleanup of the Dagger leftovers is the
recommended path.
