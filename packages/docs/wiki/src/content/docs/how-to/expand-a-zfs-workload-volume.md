---
title: Expand a ZFS workload volume
description: Increase a workload quota through GitOps while preserving existing claims, datasets, and backup retention.
---

Increase the declared quota through GitOps and verify the original claim remains bound to the original dataset.

## 1. Record the existing binding

Read the workload's owning chart, StorageClass, PVC, PV, and ZFS dataset before preparing a change.
Record the claim UID, volume handle, requested capacity, actual quota, referenced bytes, and snapshot-retained bytes.

Confirm the StorageClass permits expansion and the pool has sufficient physical headroom.
Preserve the workload's backup labels and current retention policy.
ZFS quota includes snapshots; filesystem usage alone does not describe available capacity.

## 2. Expand through the owning resource

For directly declared claims, increase the repository's requested storage.
For operator-managed PostgreSQL, increase the owning database resource's volume size.
Release the change through the [homelab release path](/how-to/cut-a-homelab-release/).

SeaweedFS claim templates are immutable.
The [owning chart](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/argo-applications/storage/seaweedfs.ts) declares its existing filer and data claims separately.
Expand those declarations first, preserving their names, StorageClass, access modes, and pruning protection.
Keep the Helm claim-template sizes unchanged in that release.

## 3. Verify expansion before changing templates

Require the PVC and PV to report the new capacity and ZFS to report the new quota.
Compare claim UID and volume handle with the recorded binding; both must be unchanged.
Stop if resizing remains pending, the binding changes, or application probes fail.

For SeaweedFS, independently verify that both StatefulSets retain claims on deletion and scaling.
Require their data claims to have no StatefulSet deletion owner reference.

## 4. Reconcile immutable SeaweedFS templates

In a subsequent reviewed release, align the filer and volume Helm sizes with the expanded claims.
Declare both resource-scoped replacement options through `filer.annotations` and `volume.annotations`:

```yaml
argocd.argoproj.io/sync-options: Force=true,Replace=true
```

Render the exact chart and review every resource carrying those options before approving the release.
The chart's component annotations also reach headless Services and ServiceMonitors.
Do not infer the replacement set from the two StatefulSet names.

Use the existing exact-revision release workflow and its [apply-safety preflight](/explanation/homelab/release-safety/).
The declared replacements interrupt the single-replica service briefly; the existing claims and datasets must survive.
Do not substitute manual controller deletion, application-wide replacement, or ignored immutable fields.

Verify the recreated controllers use the original claims and the updated template sizes.
Verify every reviewed Service and ServiceMonitor has reconciled before proceeding.
Check filer, master, volume, and S3 health, authenticated object reads, and an existing public asset.

## 5. Remove one-time replacement intent

Remove the replacement annotations in a cleanup release after acceptance.
Verify an ordinary subsequent sync preserves the StatefulSet identities.
Keep the explicit claim declarations and their pruning protection.

## Related

- [SeaweedFS off-site backups](/reference/seaweedfs-backups/)
- [Reclaim a released volume](/how-to/reclaim-a-released-volume/)
