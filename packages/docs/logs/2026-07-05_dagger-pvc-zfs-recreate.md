# Dagger PV/PVC and ZFS recreation

## Status

Complete.

## Summary

Recreated the Dagger engine cache storage on `torvalds` after the node reboot. The old
PVC/PV/ZFSVolume were removed and the Dagger application was resynced through ArgoCD so
the StatefulSet recreated its claim from desired state.

## Resources

- Old PVC UID / PV / ZFSVolume: `pvc-7c91fe19-8994-48a1-9ae9-d154b5d6177e`
- New PVC UID / PV / ZFSVolume: `pvc-057d969b-f7e9-4e0e-871f-38fa3aaf8f01`
- PVC: `dagger/data-dagger-dagger-helm-engine-0`
- StorageClass: `zfs-ssd-buildcache`
- Pool: `zfspv-pool-nvme`
- Dataset: `zfspv-pool-nvme/pvc-057d969b-f7e9-4e0e-871f-38fa3aaf8f01`

## Verification

- `kubectl get nodes -o wide`: `torvalds` was `Ready` after reboot.
- `talosctl -n 100.102.88.88 get disks`: both Samsung 990 PRO devices reappeared.
- New PVC is `Bound`, capacity `2Ti`, storage class `zfs-ssd-buildcache`.
- New PV is `Bound`, capacity `2Ti`, reclaim policy `Retain`.
- New ZFSVolume is `Ready`, capacity `2199023255552`, compression `lz4`, pool `zfspv-pool-nvme`.
- Dagger pod `dagger-dagger-helm-engine-0` is `Running` and ready with `/var/lib/dagger` mounted as a 2.0T filesystem.
- Old PV and ZFSVolume return `NotFound`.
- `dagger-zfs-tuning` re-ran and applied:
  - `sync=disabled`
  - `logbias=throughput`
  - `atime=off`

## Workflow Friction

- The child `dagger` ArgoCD app only owns the Helm-rendered ConfigMap and StatefulSet. The
  `dagger-zfs-tuning` hook is owned by the parent `apps` app, so syncing `dagger` does not
  rerun storage tuning after a PVC recreation.
- A resource-filtered sync of `apps` did not match the hook after the completed Job was
  deleted. A normal `argocd app sync apps` recreated and ran it.

## Session Log — 2026-07-05

### Done

- Verified `torvalds` was reachable after reboot over Tailscale, Kubernetes, and Talos.
- Scaled down and deleted `dagger/dagger-dagger-helm-engine`.
- Deleted old `dagger/data-dagger-dagger-helm-engine-0`, PV
  `pvc-7c91fe19-8994-48a1-9ae9-d154b5d6177e`, and matching OpenEBS ZFSVolume.
- Synced the `dagger` ArgoCD app to recreate the StatefulSet/PVC/PV/ZFSVolume from the
  rendered 2 TiB desired manifest.
- Deleted and reran the `dagger-zfs-tuning` Job through the parent `apps` ArgoCD app.
- Verified the new 2 TiB mount and ZFS tuning on
  `zfspv-pool-nvme/pvc-057d969b-f7e9-4e0e-871f-38fa3aaf8f01`.

### Remaining

- None for the requested Dagger PV/PVC/ZFS recreation.

### Caveats

- The Dagger cache was intentionally wiped; subsequent CI/Dagger work will rebuild cache.
- The parent `apps` sync touched many resources with server-side apply while reconciling the
  missing hook Job; the final `apps` and `dagger` Application statuses were `Synced` and
  `Healthy`.
