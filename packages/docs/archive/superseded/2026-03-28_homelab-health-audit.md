# Homelab Infrastructure Health Audit — 2026-03-28

## Cluster Overview

| Metric      | Value             | Metric       | Value              |
| ----------- | ----------------- | ------------ | ------------------ |
| Node        | torvalds (single) | Uptime       | 313 days           |
| Talos       | v1.12.0           | Kubernetes   | v1.35.0            |
| CPU         | 36–46%            | Memory       | 71% (27.6% free)   |
| Load Avg    | 17.72             | Storage      | 32 TB raw (8 SSDs) |
| PVCs        | 57/57 Bound       | API Server   | 34/34 checks pass  |
| Deployments | 73 available      | StatefulSets | 35 healthy         |
| DaemonSets  | 13 healthy        | etcd         | Consistent         |

## Critical Issues (3)

### 1. R2 Storage Over 1TB Limit

Cloudflare R2 bucket `homelab` has exceeded the 1TB storage limit. Both "nearing" and "exceeding" alerts firing. PagerDuty incident #3409/3410.

**Action:** Clean up old backups or upgrade R2 plan.

### 2. Alertmanager Failing to Send to PagerDuty

Alert delivery pipeline is degraded — `AlertmanagerFailedToSendAlerts` firing. Some alerts may silently fail to reach PagerDuty.

**Action:** Check PagerDuty integration key and Alertmanager configuration.

### 3. Node Memory/IO Pressure

27.6% memory free with major page faults firing. Sustained disk writes on both NVMe drives. Load average 17.72. Top consumer: `minecraft-allthemons` at 17 GB RAM + 3 CPU cores.

**Action:** Scale down idle workloads or plan memory expansion.

## Warning Issues (8)

### 4. kubernetes-event-exporter CrashLoopBackOff (295 restarts)

YAML config parse error at line 18 — Go template escaping broken. PagerDuty #3411/3412.

### 5. plex-tv-hdd-pvc at 94.65% Full

HDD PVC for Plex TV nearing capacity. PagerDuty #3403.

### 6. Released PVs Accumulating + Orphaned ZFS Volumes

OpenEBS ZFS CSI driver spamming GRPC errors for deleted ZFS volumes.

### 7. Loki Ruler YAML Parse Error

`dns-audit-rules.yaml` broken at line 48 — alerting rules from Loki not being evaluated.

### 8. 7 Grafana Dashboards Failing to Load

Invalid JSON in sidecar ConfigMaps: ha-workflow, buildkite, smartctl, velero, tasknotes, zfs, scout-for-lol.

### 9. MySQL Exporter Misconfigured

Auth failures every 5–10s — no password set for root user.

### 10. Status Page Service Down

Scrape target returning `up=0` since 3/25. PagerDuty #3398.

### 11. ARC Controller etcd Timeouts

GitHub Actions Runner Controller hitting `context deadline exceeded` on CRD finalizer.

## Informational Issues (4)

| Item                        | Details                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| 30 ArgoCD apps OutOfSync    | All healthy — pending chart changes with manual sync policies. Sync at convenience                      |
| Talosctl version skew       | Client v1.12.5 vs server v1.12.0. Upgrade node to match                                                 |
| Velero backup item errors   | Weekly backup schedule reporting errors                                                                 |
| 11 PagerDuty incidents open | Includes above items plus: cat feeder desiccant (-25d), litter robot (72%), skill-capped-fetcher failed |

## Monitoring Stack Status

| Component    | Status   | Notes                                                     |
| ------------ | -------- | --------------------------------------------------------- |
| Prometheus   | Healthy  | 44/45 targets up (status-page down)                       |
| Grafana      | Degraded | 33/40 dashboards loading — 7 have invalid JSON            |
| Loki         | Degraded | Running but ruler partially broken (dns-audit YAML error) |
| Tempo        | Healthy  | Distributed tracing operational                           |
| Alertmanager | Degraded | Running but PagerDuty delivery failing                    |
| Promtail     | Healthy  | Shipping logs from all pods                               |

## Top Resource Consumers

| Pod                           | Memory    | CPU    |
| ----------------------------- | --------- | ------ |
| minecraft-allthemons-0        | 17,352 Mi | 2,982m |
| plausible-clickhouse          | 3,082 Mi  | 1,357m |
| dagger-engine                 | 2,329 Mi  | 1,148m |
| kube-apiserver                | 2,149 Mi  | 194m   |
| loki-0                        | 1,304 Mi  | —      |
| prometheus                    | 958 Mi    | —      |
| argocd-application-controller | 822 Mi    | 142m   |
| home-homeassistant            | 689 Mi    | —      |

## Firing Alerts (18)

| Severity | Alert                               | Target                         |
| -------- | ----------------------------------- | ------------------------------ |
| Critical | R2StorageExceedingLimit             | R2 bucket `homelab`            |
| Warning  | TargetDown                          | status-page service            |
| Warning  | PVCStorageHigh                      | plex-tv-hdd-pvc (94.65%)       |
| Warning  | KubePersistentVolumeFillingUp       | plex-tv-hdd-pvc                |
| Warning  | ReleasedPVsAccumulating             | Orphaned PVs                   |
| Warning  | KubePodCrashLooping                 | kubernetes-event-exporter      |
| Warning  | KubeDeploymentReplicasMismatch      | kubernetes-event-exporter      |
| Warning  | KubePdbNotEnoughHealthyPods         | bugsink, prometheus, plausible |
| Warning  | NodeMemoryMajorPagesFaults          | torvalds                       |
| Warning  | SustainedDiskWriteActivity          | nvme0n1, nvme1n1               |
| Warning  | VeleroBackupItemErrors              | Weekly schedule                |
| Warning  | AlertmanagerFailedToSendAlerts      | PagerDuty integration          |
| Warning  | R2StorageNearingLimit               | R2 bucket `homelab`            |
| Info     | GranaryFeederDesiccantRemainingDays | Cat feeder (-25 days)          |
| Info     | Watchdog                            | Heartbeat (expected)           |

## What's Working Well

- Core cluster rock solid — 313 days uptime, all health checks pass
- All 57 PVCs bound, no storage provisioning issues
- All 73 deployments available (except intentionally scaled-to-zero)
- All 35 statefulsets and 13 daemonsets healthy
- etcd consistent, API server fully ready
- Kueue properly throttling CI jobs under resource pressure
