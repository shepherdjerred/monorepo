---
id: released-pv-reclamation
type: plan
status: complete
board: false
---

# Reclaim orphaned Released PVs and the expired July quarantine

## Summary

Ten `Released` PersistentVolumes and the expired `quarantine-2026-07-27` root
were destroyed on 2026-08-13, reclaiming ~25.6 GiB on `zfspv-pool-nvme` and
restoring the PV = ZFSVolume = dataset equality. The `ReleasedPVsAccumulating`
alert had been firing on the ten.

## Why they existed

`zfs-ssd`, `zfs-ssd-lz4`, and `zfs-hdd` all set `reclaimPolicy: Retain`
(`packages/homelab/src/cdk8s/src/misc/storage-classes.ts`). Deleting a PVC
therefore only flips its PV to `Released` — the `ZFSVolume` CR and the backing
dataset survive indefinitely. Four retirements each left volumes behind this
way: Jellyfin (#1747), the ebook stack (#2107), Plane (#2069), and the
alert-dashboard PostgreSQL (`0b04081f0`, discarded by owner decision).

Nominal capacity totalled 148.1 GiB but the datasets are thin provisioned; only
5.6 GiB was actually allocated. The quarantine root added 17.0 GiB.

## Decisions

- **Destroy immediately, no quarantine copy.** The house standard from
  `2026-07-27_pvc-backup-policy-zfs-cleanup` is a 7-day ZFS quarantine. The
  operator declined it: all ten were confirmed retired with no rename or
  replacement, seven held ≤0.03 GiB, and the only volume whose loss would
  matter had already been dumped off-cluster during the alert-dashboard
  retirement. Accepted cost: no rollback once a dataset is destroyed.
- **One-time procedure, no tooling.** A `pv:orphans` CLI modelled on
  `r2-orphan-cleanup.ts` was considered and declined. The recurrence answer is
  the wiki how-to `how-to/reclaim-a-released-volume` instead.
- **Delete the `ZFSVolume` CR first, then the PV.** The dataset is destroyed by
  exactly one mechanism — the `zfs.openebs.io/finalizer` on the CR, actioned by
  the node agent. Deleting the PV first orphans the CR and produces the
  objectless-dataset state that the July cleanup had to repair. Patching
  `reclaimPolicy` to `Delete` reaches the same finalizer through an extra
  controller hop, with less observability and a persistent field left armed on
  the object.

## What was destroyed

| PV              | Original claim             | Nominal | Actual   | Pool |
| --------------- | -------------------------- | ------- | -------- | ---- |
| `pvc-626f92b2…` | media/cwa-pvc              | 8Gi     | 0.00 GiB | nvme |
| `pvc-e3b4f60f…` | media/ebooks-hdd-pvc       | 50Gi    | 0.00 GiB | hdd  |
| `pvc-59c160e8…` | plane/…-redis-wl-0         | 1Gi     | 0.00 GiB | nvme |
| `pvc-d9094d93…` | plane/…-rabbitmq-wl-0      | 1Gi     | 0.00 GiB | nvme |
| `pvc-ae9f5ed0…` | plane/…-monitor-wl-0       | 100Mi   | 0.00 GiB | nvme |
| `pvc-cbdc1341…` | media/bindery-pvc          | 8Gi     | 0.01 GiB | nvme |
| `pvc-1ecb5ee0…` | media/jellyfin-cache-pvc   | 32Gi    | 0.03 GiB | nvme |
| `pvc-9fc9038f…` | plane/…-pgdb-wl-0          | 16Gi    | 0.10 GiB | nvme |
| `pvc-e172e7c0…` | alert-dashboard/pgdata-…-0 | 16Gi    | 2.06 GiB | nvme |
| `pvc-36653931…` | media/jellyfin-config-pvc  | 16Gi    | 3.43 GiB | nvme |

Plus `zfspv-pool-nvme/quarantine-2026-07-27` — 28 datasets, 17.0 GiB, hold
expired 2026-08-03T19:30:00Z.

No repository change was required. All ten claims had already been removed from
`pvc-backup-policy.json` by their respective retirement PRs, and neither PVs nor
`ZFSVolume`s appear in any Application's manifests, so the operation was
entirely GitOps-invisible.

## Safety oracles run before any deletion

State was frozen to `/tmp/{pv,zv,pvc,pods}-frozen.json` and every oracle was
written to throw rather than degrade — an empty result means the oracle is
unavailable, not that nothing matched. Per candidate: phase exactly `Released`;
`reclaimPolicy: Retain`; `csi.driver == zfs.csi.openebs.io` and
`volumeHandle == metadata.name`; a known ZFS storage class; no live PVC matching
the claimRef by name **or** uid; no Pod referencing the claim; the claim absent
from `PVC_BACKUP_POLICY` (the declared-desired inventory, and the strongest
static oracle available); exactly one `Ready` `ZFSVolume` of the same name. The
run aborted unless the Released set was exactly the expected ten.

## Execution

`media/cwa-pvc` (0.00 GiB) went first as a canary to prove the mechanism, with a
pause to confirm the dataset was destroyed, the CR was not recreated while its
PV still existed, and no Application flipped OutOfSync. The remaining nine
followed, then the quarantine root. Dataset absence was verified for all ten
before any PV record was removed.

`kubectl delete pv` is blocked by the agent harness — the same guard hit during
the 2026-07-28 Minecraft pass — so the operator deleted the ten PV objects by
hand. That is the one step this procedure cannot self-serve.

## Verification

- 70 PVs, zero in any phase but `Bound`; 70 live PVCs, all `Bound`.
- Set equality across both nodes: 70 PVs = 70 ZFSVolumes = 70 datasets (62 on
  `torvalds`, 8 on `liskov`). Counting datasets on one node only is wrong and
  reports a false 62/70 gap; `zfs list -d 1` is also required so any future
  quarantine children are excluded.
- `zfs_zpool` reports `health=ONLINE`; `zfspv-pool-nvme` available rose from
  2.850 TiB to 2.875 TiB.
- All 62 ArgoCD Applications Synced/Healthy.
- `ReleasedPVsAccumulating` resolves once kube-state-metrics rescrapes; the
  `for: 24h` clause gates firing, not resolution.

## Follow-ups

None. The recurring lesson is documented in the wiki how-to; the underlying
`Retain` policy is deliberate and was left unchanged.
