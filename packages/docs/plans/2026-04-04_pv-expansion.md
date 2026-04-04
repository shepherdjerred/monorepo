# PV Expansion — 2026-04-04

## Motivation

Kubelet stats showed several PVs near capacity:

| Volume | Usage Before | Capacity Before |
|--------|-------------|-----------------|
| `plex-tv-hdd-pvc` (media) | 97.5% (3994/4096 Gi) | 4 Ti |
| Prometheus TSDB | 91.6% (99/108 Gi) | 128 Gi |
| `syncthing-data` | 84.7% (54/64 Gi) | 64 Gi |
| Loki storage | 66.3% (42/64 Gi) | 64 Gi |
| Tempo storage | low | 32 Gi |

Prometheus was at 92% but `retentionSize: "120GB"` was keeping it in check — effectively capping actual retention below the configured 180 days. All others were trending toward their limits.

## Changes Made

### PVC Expansions

All done via `kubectl patch pvc` — OpenEBS ZFS CSI driver expanded online with no downtime.

| PVC | Namespace | Pool | Before | After |
|-----|-----------|------|--------|-------|
| `plex-tv-hdd-pvc` | media | zfspv-pool-hdd | 4 Ti | 6 Ti |
| `syncthing-data` | syncthing | zfspv-pool-nvme | 64 Gi | 96 Gi |
| `prometheus-prometheus-kube-prometheus-prometheus-db-*` | prometheus | zfspv-pool-nvme | 128 Gi | 256 Gi |
| `storage-loki-0` | loki | zfspv-pool-nvme | 64 Gi | 128 Gi |
| `storage-tempo-0` | tempo | zfspv-pool-nvme | 32 Gi | 64 Gi |

### Retention Changes

| Service | Setting | Before | After | Method |
|---------|---------|--------|-------|--------|
| Prometheus | `retention` | 180d | 365d | Patched Prometheus CR (operator reconciled) |
| Prometheus | `retentionSize` | 120GB | 240GB | Patched Prometheus CR |
| Loki | `retention_period` | 30d | 90d | Patched ConfigMap `loki`, restarted StatefulSet |
| Tempo | `block_retention` | 168h | 720h (30d) | Patched ConfigMap `tempo`, restarted StatefulSet |

### Code Changes (cdk8s source)

- `packages/homelab/src/cdk8s/src/cdk8s-charts/media.ts:25` — TV volume 4→6 Ti
- `packages/homelab/src/cdk8s/src/resources/syncthing.ts:34` — Syncthing 64→96 Gi
- `packages/homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts` — PVC 128→256 Gi, retention 180d→365d, retentionSize 120→240 GB
- `packages/homelab/src/cdk8s/src/resources/argo-applications/loki.ts` — PVC 64→128 Gi, retention 30d→90d
- `packages/homelab/src/cdk8s/src/resources/argo-applications/tempo.ts` — PVC 32→64 Gi, retention 168h→720h

### ArgoCD Application Patches

Patched `valuesObject` on ArgoCD Applications for loki, tempo, and prometheus to match live state, so ArgoCD won't revert when it recovers.

## ZFS Pool Headroom After Expansion

| Pool | Free Before | New Allocation | Free After (approx) |
|------|-------------|----------------|---------------------|
| zfspv-pool-hdd | 6.8 Ti | +2 Ti (TV) | ~4.8 Ti |
| zfspv-pool-nvme | 1.1 Ti | +256 Gi (total) | ~0.85 Ti |

## Procedure Notes

- Both `zfs-hdd` and `zfs-ssd` storage classes have `allowVolumeExpansion: true`
- OpenEBS ZFS CSI driver supports online volume expansion (no pod restart for PVC resize)
- For PVC-only changes: `kubectl patch pvc <name> -n <ns> -p '{"spec":{"resources":{"requests":{"storage":"<size>"}}}}'`
- For Prometheus config: patch the Prometheus CR directly — the prometheus-operator handles reconciliation
- For Loki/Tempo config: patch the ConfigMap, then `kubectl rollout restart statefulset`
- ConfigMap backups saved to `/tmp/{loki,tempo}-configmap-backup.yaml` on the local machine

## Not Changed

- **Alertmanager** (8 Gi) — stores only silences/notification state, not a concern
- **Grafana** (10 Gi PVC + 32 Gi PostgreSQL at 1.9%) — dashboards in PG, both nearly empty
- **Movies volume** (`plex-movies-hdd-pvc`, 84.1% of 4 Ti) — not urgent yet
