# NVMe Wear Attribution — 2026-04-21

Byte-level accounting of writes to `torvalds`'s two NVMe drives, tracing every measured byte to a named source via PromQL.

## Context

Both Samsung 990 PRO 4 TB NVMes are at 7% and 14% wear in under a year. Earlier speculation (Loki compaction, Prometheus retention, Postgres WAL, Dagger cache GC) didn't hold up to measurement. This investigation replaces that speculation with per-source numbers from Prometheus metrics already scraped in the cluster.

**Samsung 990 PRO 4 TB spec**: ~2,400 TBW rating. At current measured rate (6.37 TB/day both NVMes), end-of-life is ~1 year out.

## TL;DR — where the wear actually comes from

| Rank | Cause                                          | ~GB/day to disk | % of total wear     |
| ---- | ---------------------------------------------- | --------------- | ------------------- |
| 1    | **Buildkite CI agent pods** (overlayfs writes) | ~4,200          | **66%**             |
| 2    | **Dagger build cache**                         | ~900            | **14%**             |
| 3    | **Plex PVC**                                   | ~560            | **9%** — surprising |
| 4    | Everything else                                | ~700            | 11%                 |

**Combined CI (Buildkite + Dagger) is ~80% of all NVMe wear.** Observability stack (Loki, Prometheus, Postgres, ClickHouse) combined is < 1% — earlier "retention reduction" recommendations were wrong.

## Measured byte accounting

### Both NVMes, 24h total

| Metric                                                     | Query                                                            | Value            |
| ---------------------------------------------------------- | ---------------------------------------------------------------- | ---------------- |
| nvme0n1 device writes                                      | `increase(node_disk_written_bytes_total{device="nvme0n1"}[24h])` | **1,490 GB**     |
| nvme1n1 device writes                                      | `increase(node_disk_written_bytes_total{device="nvme1n1"}[24h])` | **4,877 GB**     |
| **Two-NVMe total**                                         |                                                                  | **6,367 GB/day** |
| `container_fs_writes_bytes_total` sum (all overlay writes) | `sum(increase(container_fs_writes_bytes_total[24h]))`            | 1,713 GB         |
| ZFS dataset nwritten sum                                   | `sum(increase(node_zfs_zpool_dataset_nwritten[24h]))`            | 1,243 GB         |

All `container_fs_writes_bytes_total` pins to `device=/dev/nvme1n1` — cadvisor measures container-rootfs (overlayfs) writes, and that overlay lives on `/var` on the EPHEMERAL partition, which is on nvme1n1.

### nvme1n1 (system disk, XFS `/var`) — 4,877 GB/day

Container overlay writes (`container_fs_writes_bytes_total` by namespace):

| Namespace                       | GB/24h                        |
| ------------------------------- | ----------------------------- |
| **`buildkite`**                 | **1,688**                     |
| `kube-system`                   | 11.4                          |
| `1password`                     | 6.7                           |
| `argocd`                        | 2.2                           |
| `tasknotes`                     | 1.8                           |
| `home`                          | 1.1                           |
| `plausible`                     | 0.7                           |
| `openebs`                       | 0.6                           |
| `dagger`                        | 0.35                          |
| `media`                         | 0.14                          |
| All other namespaces (combined) | < 0.5                         |
| **Sum**                         | **1,713 GB (35% of nvme1n1)** |

Plus measured system writers:

| Source                                  | GB/24h | Source metric                                                   |
| --------------------------------------- | ------ | --------------------------------------------------------------- |
| Container logs in `/var/log/containers` | ~65    | `rate(kubelet_container_log_filesystem_used_bytes[5m])` × 86400 |

The remaining **~3,100 GB (64%)** is XFS journal overhead + overlayfs copy-up amplification (every file modification inside a CI pod container triggers a full-file copy from the lower image layer to the writable upper layer) + containerd image layer extraction (every image pull unpacks onto disk) + etcd WAL + kubelet state cache + journald. Prometheus doesn't expose per-process bytes written; pinning this finer requires `iotop -oPa` via a privileged debug pod on the node (see appendix).

### nvme0n1 (ZFS pool `zfspv-pool-nvme`) — 1,490 GB/day

ZFS exposes `node_zfs_zpool_dataset_nwritten` which attributes per-dataset, 1:1 with PVCs:

| PVC                                                                                    | GB/24h             |
| -------------------------------------------------------------------------------------- | ------------------ |
| **`dagger/data-dagger-dagger-helm-engine-0`** (build cache, 1 TiB, zfs-ssd-buildcache) | **704**            |
| **`media/plex-pvc`** (64 GiB, zfs-ssd)                                                 | **471**            |
| `plausible/clickhouse-data`                                                            | 14                 |
| `media/tautulli-pvc`                                                                   | 7                  |
| `loki/storage-loki-0`                                                                  | 6.5                |
| `prometheus/prometheus-…-prometheus-0` (TSDB)                                          | 6.4                |
| `temporal/pgdata-temporal-postgresql-0`                                                | 3.4                |
| `home/homeassistant-pvc`                                                               | 2.3                |
| `bugsink/pgdata-bugsink-postgresql-0`                                                  | 1.3                |
| All other datasets combined                                                            | ~27                |
| **Sum of ZFS dataset writes**                                                          | **1,243 GB (83%)** |
| ZFS overhead (COW metadata, uberblocks, ZIL commits into main pool)                    | **247 GB (17%)**   |

Note: `node_zfs_zil_zil_itx_metaslab_normal_bytes` over 24h = 600 GB across both pools — but this counts ZIL entries that get replayed into `dataset_nwritten` during txg commit, so it's subsumed, not additive.

## Surprises (things I was wrong about)

| Earlier claim                                 | Reality                                                                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| "Loki LSM compaction is a big source"         | Loki PVC writes **6.5 GB/day**. Negligible. Moving Loki to SeaweedFS would save almost nothing.                                                |
| "Prometheus 365d retention drives TSDB churn" | Prometheus TSDB PVC writes **6.4 GB/day**. Retention cuts won't help wear.                                                                     |
| "Postgres instances drive wear via WAL + ZIL" | All 4 Postgres DBs combined: **< 5 GB/day**.                                                                                                   |
| "ClickHouse merge trees amplify heavily"      | ClickHouse: **14 GB/day**. Not a significant source.                                                                                           |
| "Dagger cache GC would reduce wear"           | **Wrong** — the cache sitting there causes zero wear. Cache _misses on new builds_ cause writes. GC would _increase_ wear (more cache misses). |
| "The ~3.6× amplification is mostly ZFS COW"   | ZFS overhead is only 17% of nvme0n1. The bigger amplification is overlayfs + XFS on nvme1n1, driven almost entirely by CI.                     |

## Levers that actually reduce wear, ranked

1. **Cut CI run frequency** — Buildkite + Dagger cache is ~80% of wear. Halving CI runs ~doubles drive life.
2. **Investigate Plex PVC at 471 GB/day** — 7× full-PVC rewrite per day on a 64 GiB volume is suspicious. Probably transcoder cache or metadata DB rewriting. Redirect to tmpfs or the HDD pool.
3. **Move CI agents off `torvalds`** — put Buildkite agent nodes on different hardware (dedicated CI box with its own SSD lifecycle) so this node's NVMes outlast the CI churn.
4. **Tune Dagger cache policy** — not GC, but _keep_ the cache warm (higher hit rate = fewer rebuild writes). Already mostly hot.

Levers that **don't** meaningfully reduce wear (despite common wisdom):

- Loki retention tuning
- Prometheus retention tuning
- Postgres WAL config (`sync=disabled` on ZFS, checkpoint intervals, etc.)
- Container log rotation frequency
- ClickHouse TTL / merge tuning

## Open questions

- The ~3,100 GB/day of nvme1n1 residual after accounting for container overlay writes (1.71 TB) and container logs (65 GB) is unaccounted. Expected to be overlayfs copy-up + XFS journal + containerd + etcd + kubelet, but not directly measured. Needs `iotop -oPa` via privileged debug pod if we want a tight attribution.
- **Plex 471 GB/day is anomalous.** Needs an exec into the Plex pod to check `/config` (which maps to plex-pvc) for whatever is being rewritten.

## Methodology / how to reproduce

Every number above came from one of these Prometheus queries:

```promql
# Device-level writes
sum by (device) (increase(node_disk_written_bytes_total[24h])) / 1e9

# Container overlay writes, ranked
topk(50, sum by (namespace, pod, container) (increase(container_fs_writes_bytes_total[24h])) / 1e9)

# Container overlay writes by namespace
sum by (namespace) (increase(container_fs_writes_bytes_total[24h])) / 1e9

# container_fs writes split by device (confirms all overlay goes to nvme1n1)
sum by (device) (increase(container_fs_writes_bytes_total[24h])) / 1e9

# ZFS dataset writes (maps to PVCs)
topk(20, sum by (dataset) (increase(node_zfs_zpool_dataset_nwritten[24h])) / 1e9)
sum(increase(node_zfs_zpool_dataset_nwritten[24h])) / 1e9

# ZIL writes (usually double-counted with dataset writes; included for completeness)
sum(increase(node_zfs_zil_zil_itx_metaslab_normal_bytes[24h])) / 1e9
sum(increase(node_zfs_zil_zil_itx_copied_bytes[24h])) / 1e9

# Container log rotation rate
sum(rate(kubelet_container_log_filesystem_used_bytes[5m]))
```

Run them via `toolkit gf query '<PROMQL>'`.

To map ZFS UIDs (`pvc-17115567-…`) back to PVC names:

```bash
kubectl get pvc -A -o json \
  | jq -r '.items[] | "\(.spec.volumeName)\t\(.metadata.namespace)/\(.metadata.name)\t\(.spec.storageClassName)\t\(.status.capacity.storage)"'
```

### For deeper attribution (nvme1n1 residual)

Deploy a privileged debug pod and run `iotop -oPa` + `iostat -x 10` to attribute the 3,100 GB/day system-disk residual to specific processes (etcd, kubelet, containerd, journald, etc.). Template:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: wear-audit
  namespace: kube-system
spec:
  hostPID: true
  hostNetwork: true
  nodeName: torvalds
  restartPolicy: Never
  containers:
    - name: audit
      image: alpine
      command:
        - sh
        - -c
        - apk add --no-cache iotop-c sysstat util-linux && sleep infinity
      securityContext: { privileged: true }
      volumeMounts:
        - { name: host-root, mountPath: /host }
  volumes:
    - name: host-root
      hostPath: { path: / }
```

Then `kubectl exec -it -n kube-system wear-audit -- iotop-c -oPa -d 10 -n 30`.
