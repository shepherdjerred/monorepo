# Homelab Infrastructure Health Audit — 2026-04-05

## Cluster Overview

| Metric | Value | Metric | Value |
|--------|-------|--------|-------|
| Node | torvalds (single) | Uptime | 6.4 days |
| Talos | v1.12.0 | Kubernetes | v1.35.0 |
| CPU | 4817m / 15% | Memory | 59% (40% available) |
| Disks | 32 TB (2 NVMe + 6 SATA) | PVs | 58/58 Bound |
| Deployments | 73 total | ArgoCD Apps | 63 total |

## Root Cause — 1Password Connect Corrupted

The 1Password Connect server's credentials file is corrupted (`invalid character 'e' looking for beginning of value`). Every secret retrieval returns HTTP 500. This cascades into **every application that depends on 1Password secrets** — the single biggest issue affecting the cluster.

**Affected services (27+ secrets):** Postal (MariaDB, web, worker), Scout (beta + prod), Windmill (app + workers), Home Assistant, Birmel, BugSink, DDNS, Cloudflare Tunnel, Plausible, Minecraft servers, Alertmanager PagerDuty routing key, and more.

**Fix:** Recreate the 1Password Connect credentials file (`1password-credentials` secret in namespace `1password`). Re-run `op connect server create` or restore from backup.

## Critical Issues (6)

### 1. 1Password Connect Credentials Corrupted

See root cause above. Every API call returns 500. This is blocking secret injection for 27+ Kubernetes secrets across all namespaces.

### 2. Postal Stack Down (7+ hours)

`postal-mariadb-0` stuck in `Init:0/1` — secret `postal-mariadb-credentials` missing key `mariadb-password`. Web and worker pods CrashLoopBackOff. Will auto-resolve when 1Password is fixed.

### 3. Scout Beta + Prod Down

Both backends: `CreateContainerConfigError` — `RIOT_API_TOKEN` not set. Secret injection failing due to 1Password.

### 4. Home Assistant Down

CrashLoopBackOff — `HaApplicationDown` critical alert firing. Likely missing secrets from 1Password.

### 5. Windmill Down

App + both worker pools (default, native) CrashLoopBackOff. 3 deployment replica mismatches.

### 6. NVMe1 Critical Temperature

`SmartDeviceTemperatureCritical` alert firing. Composite sensor at **71.85°C** — NVMe drives throttle at 70–85°C. I/O saturation and sustained write alerts also firing.

**Action:** Check airflow around second M.2 slot; add heatsink if absent.

## Warning Issues (16)

| # | Issue | Details |
|---|-------|---------|
| W1 | Alertmanager → PagerDuty broken | Cannot send alerts; PD routing key likely from 1Password |
| W2 | R2 storage over 1TB | Both "nearing" and "exceeding" alerts. PD #3409/3410 |
| W3 | kubernetes-event-exporter | 1384 restarts in 5 days; currently running but fragile |
| W4 | Loki/Tempo StatefulSet sync errors | Immutable field changes; need delete + recreate |
| W5 | App-of-apps Helm template broken | Undefined `$value` at line 419 of `apps.k8s.yaml` |
| W6 | Velero weekly backups failing | ZFS CSI plugin panic: `index out of range [-1]` |
| W7 | NVMe1 disk I/O saturation | `NodeDiskIOSaturation` + `SustainedDiskWriteActivity` |
| W8 | ZFS hash collisions high | `ZfsHashCollisionsHigh` alert firing |
| W9 | ZFS NVMe pool fragmentation | `ZfsPoolFragmentationHigh` alert firing |
| W10 | better-skill-capped-fetcher | 2 of last 3 CronJob runs failed |
| W11 | s3-static-sites Caddy | 2 pods CrashLoopBackOff |
| W12 | Memory page faults | `NodeMemoryMajorPagesFaults` on torvalds |
| W13 | SMART metrics not in Prometheus | Collectors running but textfile path misconfigured |
| W14 | sentinel/status-page chart versions | ChartMuseum `~2.0.0-0` constraint matches no tags |
| W15 | CPUThrottlingHigh | Plausible ClickHouse container |
| W16 | 11 stale PagerDuty incidents | All 10+ days old, unacknowledged |

## ArgoCD Status

63 total apps: 54 Synced, 5 OutOfSync, 3 Unknown. 41 Healthy, **18 Degraded**, 1 Progressing.

Most degraded apps trace back to 1Password failure. Independent ArgoCD issues:
- `apps` (app-of-apps): Helm template error (`undefined $value` at line 419)
- `loki` / `tempo`: Immutable StatefulSet field — need manual delete + recreate
- `sentinel` / `status-page`: Chart version `~2.0.0-0` matches no ChartMuseum tags

## Monitoring Stack Status

| Component | Status | Notes |
|-----------|--------|-------|
| Prometheus | Healthy | 33/40 scrape targets up (7 down are crashed apps) |
| Grafana | Healthy | Running with PostgreSQL backend |
| Loki | Healthy | Running, 90-day retention |
| Tempo | Healthy | Distributed tracing operational |
| Alertmanager | Degraded | Running but PagerDuty delivery failing (1Password) |
| Event Exporter | Fragile | 1384 restarts in 5 days, currently up |

**29 alert types firing:** 6 critical + 20+ warning. Most caused by 1Password cascade.

## Backup Status

| Schedule | Recent | Status | Issue |
|----------|--------|--------|-------|
| 6-hourly | 12 backups | 11 OK / 1 partial | Prometheus PV snapshot failed |
| Daily | 7 backups | 7 OK | Clean |
| Weekly | 4 backups | 1 OK / 2 partial / 1 failed | ZFS CSI plugin panic bug |
| Monthly | 3 backups | 3 OK | Clean |

## Hardware Status

| Component | Status | Details |
|-----------|--------|---------|
| CPU package | Green | 75°C; 2/24 cores with negligible sporadic throttling |
| NVMe0 | Green | 44°C / 58°C composite |
| NVMe1 | **Red** | 53°C / **72°C composite**; I/O saturated |
| SATA SSDs (6x) | Green | 37–43°C |
| Memory | Green | 40% available (54 GB free of 125 GiB) |
| ZFS ARC | Green | 99.78% hit rate |
| ZFS NVMe pool | Yellow | High fragmentation alert |

## Firing Alerts (29)

### Critical
| Alert | Target |
|-------|--------|
| HaApplicationDown | Home Assistant |
| PostalMariaDBDown | Postal MariaDB |
| PostalWebDown | Postal web |
| PostalWorkerDown | Postal worker |
| R2StorageExceedingLimit | R2 bucket "homelab" |
| SmartDeviceTemperatureCritical | NVMe1 on torvalds |

### Warning (selected)
| Alert | Target |
|-------|--------|
| AlertmanagerFailedToSendAlerts | PagerDuty integration |
| KubePodCrashLooping | 10 pods across 6 namespaces |
| KubeDeploymentReplicasMismatch | 8 deployments |
| KubeDeploymentRolloutStuck | scout-beta, scout-prod, windmill-app |
| NodeDiskIOSaturation | nvme1n1 |
| SustainedDiskWriteActivity | nvme1n1 |
| VeleroBackupItemErrors | 6hourly + weekly |
| ZfsHashCollisionsHigh | torvalds |
| ZfsPoolFragmentationHigh | zfspv-pool-nvme |
| TargetDown | 5 targets (ha, postal, scout x2, status-page) |
| ReleasedPVsAccumulating | Orphan PVs |

## PagerDuty Incidents (11 triggered)

| # | Incident | Severity | Age |
|---|----------|----------|-----|
| 3398 | status-page targets down | High | 10d |
| 3402 | Cat feeder desiccant overdue (-25d) | Medium | 10d |
| 3403 | plex-tv-hdd-pvc 94.65% full | High | 10d |
| 3404 | Released PVs accumulating | Medium | 10d |
| 3408 | better-skill-capped-fetcher failed | Low | 10d |
| 3409 | R2 storage exceeding 1TB | High | 10d |
| 3410 | R2 storage approaching 1TB | Medium | 10d |
| 3411 | event-exporter CrashLoopBackOff | Medium | 10d |
| 3412 | event-exporter replica mismatch | Medium | 10d |
| 3413 | Velero backup item errors | Medium | 10d |
| 3426 | Litter Robot waste drawer high (72%) | Low | 10d |

## Recommended Actions (Priority Order)

1. **Fix 1Password Connect** — Recreate credentials. Cascading fix for Postal, Scout, Windmill, HA, Alertmanager PD, and 18+ degraded apps.
2. **Investigate NVMe1 temperature** — 72°C with I/O saturation. Check M.2 slot airflow; add heatsink.
3. **Fix app-of-apps Helm template** — Undefined `$value` at line 419.
4. **Recreate Loki & Tempo StatefulSets** — Immutable field changes (PV data preserved).
5. **Fix ZFS CSI snapshot plugin** — Panic bug breaking weekly backups. Upgrade OpenEBS.
6. **Fix SMART metrics pipeline** — Collectors running but textfile path not configured.
7. **Clean up R2 storage** — Exceeding 1TB limit.
8. **Fix sentinel/status-page chart versions** — Update `~2.0.0-0` constraint.
9. **Triage 11 stale PagerDuty incidents** — All 10+ days unacknowledged.
10. **Upgrade Talos** — v1.12.0 → v1.12.5.

## What's Working Well

- Core cluster rock solid — all 16 Talos health checks pass
- Storage pristine — all 58 PVs bound, no orphans
- ZFS ARC excellent — 99.78% hit rate
- Monitoring stack healthy — Prometheus, Grafana, Loki, Tempo all running
- Network solid — all 38 Tailscale ingress proxies healthy
- Daily + monthly backups clean
- Memory comfortable — 40% available (54 GB free)
- CPU headroom — only 15% utilized
