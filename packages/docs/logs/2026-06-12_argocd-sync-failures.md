---
id: log-2026-06-12-argocd-sync-failures
type: log
status: complete
board: false
---

# ArgoCD Sync Failure Check

## Summary

Checked the `admin@torvalds` cluster after many ArgoCD sync failures were reported. The failures were not caused by repo-server manifest generation or broad cluster unavailability. All 64 ArgoCD Applications were currently `Synced`; 10 Applications had their latest operation marked `Failed`.

At `2026-06-13T02:04Z`, ArgoCD received sync requests for all 64 apps with:

- `prune:true`
- `syncOptions:<items:"ServerSideApply=true">`
- `initiatedBy: username admin`

Result:

- 54 sync operations succeeded.
- 9 failed on immutable `StatefulSet` spec updates:
  - `dagger`
  - `minecraft-allofcreate`
  - `minecraft-allthemons`
  - `minecraft-bettermc`
  - `minecraft-ftbskies2`
  - `minecraft-shuxin`
  - `minecraft-sjerred`
  - `minecraft-stoneblock4`
  - `minecraft-tsmc`
- 1 failed on an immutable bound PVC spec update:
  - `golink`

The common failure message for the StatefulSets was Kubernetes rejecting changes outside the mutable StatefulSet fields. The `golink` PVC failure was Kubernetes rejecting a desired spec where `volumeName` was empty while the live bound PVC has `volumeName: pvc-21a3e914-e8c2-4002-af7f-6a5be9754188`.

## Current State

- `kubectl get applications.argoproj.io -n argocd -o json` showed:
  - `total: 64`
  - sync status: `Synced: 64`
  - operation phase: `Succeeded: 54`, `Failed: 10`
  - health: `Healthy: 61`, `Progressing: 2`, `Degraded: 1`
- The failed StatefulSets are long-lived resources:
  - Dagger StatefulSet age: 68d
  - Minecraft StatefulSet ages: 76d or 131d
- `golink-pvc` is bound and immutable except for allowed resize-related fields.

## Caveat

The failed operation status is noisy but does not mean those apps are currently OutOfSync. ArgoCD reconciliation after the failures reported `Skipping auto-sync: application status is Synced` for the affected apps.

## Workflow Friction

- `toolkit recall search "argocd sync failed homelab"` returned results but left a stuck process running. I killed the stuck search process by PID. A bounded timeout wrapper around recall searches would avoid leaving cleanup work behind during live ops checks.

## Session Log — 2026-06-12

### Done

- Loaded `argocd-helper` and `kubectl-helper`.
- Checked live ArgoCD Applications on `admin@torvalds`.
- Verified the failures were a bulk `admin`-initiated server-side sync across all 64 apps.
- Identified the failing apps and grouped the root causes as immutable StatefulSet specs and immutable PVC spec.
- Confirmed no cluster mutation was performed during this investigation.

### Remaining

- Decide whether to avoid `ServerSideApply=true` for bulk/manual syncs against long-lived StatefulSet/PVC-heavy apps, or add app-specific sync handling for those resources.
- If a true stateful workload change is intended, plan a controlled recreate/migration path per app instead of relying on normal apply.

### Caveats

- Server logs identify the ArgoCD user as `admin` and peer as localhost behind ArgoCD server; they do not identify the human/operator beyond that account.
- The failed operation phase may remain visible in ArgoCD even though the apps are currently `Synced`.

## Session Log — 2026-06-12 Remediation

### Done

- Cleared the remaining stale failed ArgoCD operation states for `dagger`, `golink`, `minecraft-allofcreate`, `minecraft-allthemons`, `minecraft-bettermc`, `minecraft-ftbskies2`, and `minecraft-stoneblock4` with zero-task `argocd app sync --apply-out-of-sync-only --dry-run` operations.
- Verified live ArgoCD now reports `operationPhase: Succeeded` for all 64 Applications.
- Patched source to omit the empty core API `group` in `packages/homelab/src/cdk8s/src/misc/modded-minecraft.ts`, matching the existing hand-written Minecraft app pattern and preventing parent `apps` drift on those child Applications after the next chart publish.
- Added `ApplyOutOfSyncOnly=true` to stateful/noisy app sync options:
  - `packages/homelab/src/cdk8s/src/misc/modded-minecraft.ts`
  - `packages/homelab/src/cdk8s/src/resources/argo-applications/minecraft-sjerred.ts`
  - `packages/homelab/src/cdk8s/src/resources/argo-applications/minecraft-shuxin.ts`
  - `packages/homelab/src/cdk8s/src/resources/argo-applications/minecraft-tsmc.ts`
  - `packages/homelab/src/cdk8s/src/resources/argo-applications/dagger.ts`
  - `packages/homelab/src/cdk8s/src/resources/argo-applications/golink.ts`
- Verified `packages/homelab/src/cdk8s` with `bun run typecheck`, `bun run lint`, and `bun run build`.
- Verified generated `packages/homelab/src/cdk8s/dist/apps.k8s.yaml` no longer renders `group: ""` for the modded Minecraft Service ignore-differences entries and does render `ApplyOutOfSyncOnly=true`.

### Remaining

- Publish/deploy the homelab chart update through the normal pipeline. Until then, the live parent `apps` Application can remain `OutOfSync` on the already-fixed generated diff.
- Separately investigate non-sync health states if desired: `birmel` and `redlib` are `Progressing`, and `mcp-gateway` is `Degraded`.

### Caveats

- The no-op ArgoCD syncs did not apply the immutable StatefulSets/PVCs, but they did update ArgoCD operation history from stale `Failed` to `Succeeded`.
- The source fix is local and uncommitted in this checkout.

## Root Cause and Prevention

The original failures were caused by an `admin`-initiated bulk sync of all Applications with `prune:true` and `ServerSideApply=true`. ArgoCD submitted sync operations even for Applications that were already `Synced`. For long-lived stateful resources, that meant Kubernetes received apply attempts against existing StatefulSets and a bound PVC whose live specs include immutable/defaulted fields that cannot be changed through apply.

The failures were expected Kubernetes protection, not a broken cluster:

- StatefulSet specs cannot be updated for most fields after creation.
- Bound PVC specs cannot be updated except for allowed resize-related fields.
- ArgoCD then retained the failed operation phase even though later comparison still considered those Applications `Synced`.

Prevention added in source:

- `ApplyOutOfSyncOnly=true` on the stateful/noisy Applications so normal syncs do not reapply already-synced immutable StatefulSet/PVC resources.
- Removed explicit `group: ""` from the shared modded Minecraft Service ignore-differences entry because ArgoCD omits empty core API groups from live Application specs, causing parent `apps` drift.

Operational prevention:

- Avoid bulk-syncing all apps with ad hoc `ServerSideApply=true` unless `ApplyOutOfSyncOnly` is also set.
- Prefer syncing the parent `apps` Application and letting child Applications auto-sync their own actual drift.
- Treat intended StatefulSet/PVC spec changes as migrations/recreates, not ordinary apply operations.
- Do not use the shared `admin` account for routine syncs if auditability matters; use a named account with narrower permissions.
