---
id: overseerr-prune-after-migration
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/logs/2026-07-03_finish-seerr-migration.md
---

# Prune orphaned Overseerr resources after Seerr migration

**Blocked on:** PR #1385 (`feat(homelab): complete Overseerr → Seerr migration`)
merging to `main`.

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

The `overseerr.sjer.red → seerr.sjer.red` redirect ruleset was already applied to
prod from PR #1385's branch. Once #1385 is merged, `main` and prod Cloudflare
state are consistent again. Do **not** `tofu apply` the cloudflare stack from
`main` until #1385 is merged (it would destroy the ruleset).

## Remaining

- [ ] All five `media`-namespace Overseerr resources are gone and the Tailscale proxy
      is cleaned up.
- [ ] The Retain PV + ZFS dataset are either deleted or intentionally kept as backup
      (note which).
- [ ] This file is deleted in the same commit that records completion.
