---
id: overseerr-prune-after-migration
type: todo
status: in-progress
board: true
verification: operator
disposition: blocked
origin: packages/docs/logs/2026-07-03_finish-seerr-migration.md
---

# Prune orphaned Overseerr resources after Seerr migration

PR #1385 (`feat(homelab): complete Overseerr → Seerr migration`) is merged; the
remaining work is live cleanup only.

## Why this todo exists

PR #1385 removes the Overseerr deployment from the `media` cdk8s chart, but the
`media` ArgoCD Application has **`automated: {}` with prune OFF**. So after the PR
merges and ArgoCD syncs, the live Overseerr resources are **not** auto-deleted —
they linger as OutOfSync/extra resources and must be pruned manually.

The users + 156 requests were already migrated into Seerr, `overseerr.sjer.red`
301-redirects to Seerr, and Maintainerr was repointed to Seerr (all done
2026-07-03, see origin log), so Overseerr is safe to delete.

## Pre-prune acceptance checks

Do these before deleting anything:

1. Confirm at least one non-owner user can log into `seerr.sjer.red` (or that the
   8 imported users appear under Seerr → Users).
2. Confirm the redirect still works:
   `curl -sI https://overseerr.sjer.red/ | grep -i location` → `https://seerr.sjer.red/`.
3. Confirm Maintainerr still points at Seerr (Settings → its `overseerr_url` should
   be `http://media-seerr-service:5055`) and its collection/rule runs succeed.
4. Confirm PR #1385 is merged and the `media` app has synced (Overseerr no longer
   in the rendered manifests).

## Prune commands (run after merge + sync)

Orphaned resources (exact names as of 2026-07-03):

```bash
# media namespace
kubectl delete deployment/media-overseerr -n media
kubectl delete service/media-overseerr-service -n media
kubectl delete ingress/media-overseerr-tailscale-ingress-ingress -n media
kubectl delete tunnelbinding/media-overseerr-cf-tunnel -n media
kubectl delete pvc/overseerr-pvc -n media
```

Deleting the Ingress cascades the Tailscale operator's proxy
(`ts-media-overseerr-tailscale-ingress-ingress-*` StatefulSet + pod in the
`tailscale` namespace) automatically.

Alternatively, do it in one shot via an ArgoCD prune sync of the `media` app
(`argocd app sync media --prune`) — but the explicit `kubectl delete` above is
safer/clearer for a one-off.

## Data / storage notes

- `overseerr-pvc` → PV `pvc-e83bd195-dbe0-4cc9-9612-1b1ac82a6487`, storage class
  `zfs-ssd`, **reclaimPolicy: Retain**. Deleting the PVC leaves the PV `Released`
  and the underlying ZFS dataset **intact** — data is not immediately destroyed.
- To reclaim the space after you're confident the migration is good, also delete
  the PV and its ZFS dataset:
  `kubectl delete pv pvc-e83bd195-dbe0-4cc9-9612-1b1ac82a6487` (then remove the
  ZFS dataset on the node if it isn't auto-removed).
- Keep a copy of Overseerr's DB (it lives on that PV / was snapshotted during the
  cutover) until the PV is deleted, as a final rollback.

## Cloudflare note

The `overseerr.sjer.red → seerr.sjer.red` redirect is deployed. PR #1385 is
merged, so `main` and production Cloudflare state are consistent.

## Remaining

- [x] Inventory the live Kubernetes state: no Overseerr workload, Service, PVC, Application, PV, or ZFSVolume remains.
- [x] Remove all remaining Overseerr Kubernetes and Tailscale resources without changing Seerr resources.
- [ ] Decide whether to delete or intentionally retain the PV/ZFS dataset, and record the operator's decision and evidence.
- [ ] Verify Seerr and the `overseerr.sjer.red` redirect remain healthy, then mark this record complete and archive it.

## Comment Log

- 2026-07-27 — Board audit confirmed PR #1385 merged and Overseerr is absent
  from current manifests. The 2026-07-08 health log still observed `overseerr-pvc`,
  so privileged live-state cleanup remains and verification is operator-owned.

### 2026-08-02 — Kubernetes cleanup confirmed

- Live inventory found no matching Overseerr workload, Service, PVC, Application, PV, or OpenEBS ZFSVolume.
- The only unresolved storage question is whether a backing host dataset persists outside the Kubernetes API and should be retained or deleted.

## Session Log — 2026-08-02

### Done

- Cleared the stale Kubernetes cleanup tasks and moved this partially completed operator card to In Progress.

### Remaining

- Verify host-dataset absence or record an explicit retention decision, then recheck Seerr/redirect health and archive.

### Caveats

- Absence from the Kubernetes API does not independently prove a retained host dataset was removed.
