---
title: Share a ZFS volume between pods
description: Let a second pod on the same node mount an existing OpenEBS ZFS volume, and avoid the read-only mount that ZFS rejects.
sidebar:
  order: 13
---

A second pod can mount a ZFS LocalPV volume only when its `ZFSVolume` has
`spec.shared: "yes"` and both pods mount it with the same ro/rw flag.

Without `shared`, the second pod sticks in `ContainerCreating` and its events
report `verifyMount: device already mounted`. Both pods must also run on the
node that holds the dataset.

## 1. Check `spec.shared` on the volume

Every ZFS StorageClass sets `shared: "yes"`
([`storage-classes.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/misc/storage/storage-classes.ts)).
The driver copies that parameter into the `ZFSVolume` only when it provisions
the volume. A volume created or imported before the parameter existed does not
have it.

Find the PersistentVolume behind the claim, then read the field:

```bash
PV=$(kubectl -n <namespace> get pvc <claim> -o jsonpath='{.spec.volumeName}')
kubectl -n openebs get zfsvolume "$PV" -o jsonpath='{.spec.shared}{"\n"}'
```

The output must be `yes`. Empty output means the volume is not shared.

## 2. Set it

```bash
kubectl -n openebs patch zfsvolume "$PV" --type merge -p '{"spec":{"shared":"yes"}}'
```

Run step 1 again to confirm. Then delete the stuck pod so the kubelet retries
the mount.

:::caution[A re-apply can drop the field]
An imported `ZFSVolume` can carry a stale
`kubectl.kubernetes.io/last-applied-configuration` annotation that predates
`shared`. A later `kubectl apply` of that old configuration removes the field
again. Check the annotation after patching, and re-run step 1 after any apply.
:::

## 3. Mount read-write at the pod, read-only at the container

OpenZFS on Linux returns `EBUSY` for a second mount of a mounted dataset whose
read-only flag differs
([`zpl_super.c`](https://github.com/openzfs/zfs/blob/master/module/os/linux/zfs/zpl_super.c)).
A `readOnly` PersistentVolumeClaim volume makes the CSI driver mount with `ro`.
Beside a writer's `rw` mount, that fails even when the volume is shared.

To give a reader pod read-only access:

- leave `readOnly` off the pod's `persistentVolumeClaim` volume;
- set `readOnly: true` on the container's `volumeMount`.

The container runtime then bind-mounts the directory read-only into the
container. The Scout beta gateway does this
([`gateway.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/scout/gateway.ts)).

:::note[Scout prod]
The scout-prod lake volume, whose name begins `pvc-5cada7da`, lacks
`spec.shared`. Patch it with steps 1 and 2 before prod runs a gateway pod
beside its backend.
:::

## Related

- [Reclaim a released volume](/how-to/reclaim-a-released-volume/)
- [How the homelab is put together](/explanation/homelab/overview/)
