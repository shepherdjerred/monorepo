# Plan: Clean Up Orphaned ZFS Datasets

## Context

During the Dagger engine deployment (Phase 1 of the Bazel-to-Dagger migration), we discovered 19 orphaned ZFS datasets on the NVMe pool. These datasets have no PV, no PVC, no ZFSVolume CRD, are not mounted, and have no snapshots or backups. They are leftovers from the `Retain` reclaim policy keeping data after PVCs were deleted from Kubernetes.

The HDD pool was also checked — all 5 datasets there are actively bound to real PVCs (Plex, qBittorrent, Gickup, Chartmuseum) despite lacking ZFSVolume CRDs.

## Scope

**NVMe pool (`zfspv-pool-nvme`) — 19 orphaned datasets, ~980 GB total:**

| Dataset                                    | Size        | Likely origin           |
| ------------------------------------------ | ----------- | ----------------------- |
| `pvc-487bf9d3-e7f8-4b22-9463-e9bf4fcaf095` | 837 GB      | Old Dagger engine cache |
| `pvc-d2b74a08-3073-4747-9b7a-c0415b72c3a7` | 135 GB      | Old bazel-remote cache  |
| `pvc-62b11b04-ade5-4efa-8342-957045e3ac82` | 3.93 GB     | Unknown                 |
| `pvc-e9008df3-135a-4e2f-a280-521c30951449` | 1.28 GB     | Unknown                 |
| `pvc-ec189531-c617-47b0-960a-cb8f48ff1124` | 1.26 GB     | Unknown                 |
| 14 others                                  | < 1 GB each | Unknown                 |

**HDD pool — no action needed.** All datasets are actively in use.

## Verification performed (2026-03-26)

For each of the 19 NVMe datasets:

- `kubectl get pv <name>` → NotFound
- `kubectl get zfsvolume <name> -n openebs` → NotFound
- `zfs get mounted` → `no`
- `zfs list -t snapshot` → 0 snapshots
- `kubectl get zfsbackup` → no references

## Steps

1. **Snapshot before destroy** — Create a ZFS snapshot of each dataset as a safety net
2. **Destroy datasets** — `zfs destroy` each orphan (snapshots provide rollback)
3. **Verify pool space** — Confirm ~980 GB reclaimed on NVMe pool
4. **Clean up snapshots** — After 1 week, remove the safety snapshots

## Also: revert accidental ZFS tuning

The Dagger ZFS tuning Job (v1) accidentally applied `sync=disabled logbias=throughput atime=off` to `pvc-02d0a6f2-d9ca-4abb-8bb3-b83594f4e308` (an orphan). Revert to defaults as part of cleanup:

```
zfs set sync=standard logbias=latency atime=on zfspv-pool-nvme/pvc-02d0a6f2-d9ca-4abb-8bb3-b83594f4e308
```

Or just destroy it since it's orphaned anyway.
