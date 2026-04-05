# Homelab Infrastructure Health Audit — 2026-04-04 (Evening)

## Cluster Overview

| Metric      | Value                    | Metric      | Value               |
| ----------- | ------------------------ | ----------- | ------------------- |
| Node        | torvalds (single)        | Uptime      | ~6.4 days           |
| Talos       | v1.12.0                  | Kubernetes  | v1.35.0             |
| CPU         | 13884m / 43%             | Memory      | 88464Mi / 69%       |
| Disks       | 32 TB (2 NVMe + 6 SATA) | PVs         | 57/57 Bound         |
| Deployments | Running                  | ArgoCD Apps | 62 total            |

## Critical Issues (5)

### 1. ArgoCD App-of-Apps Helm Template Broken

The `apps` application (app-of-apps) fails to render with `bad character U+003D '='` at `apps/templates/apps.k8s.yaml:3504`. All child apps are stuck at last-known state. This is the highest-priority ArgoCD fix.

**Action:** Fix the YAML parse error in the Helm template at line 3504.

### 2. Postal Stack Down

`postal-mariadb-0` stuck in `PodInitializing`. Web and worker pods down. 7 critical/warning alerts firing for Postal components.

**Action:** Investigate MariaDB init failure — likely missing credentials secret.

### 3. Scout Prod Down — Missing RIOT_API_TOKEN

`scout-prod-scout-backend` CrashLoopBackOff: `env-var: "RIOT_API_TOKEN" is a required variable, but it was not set`. Secret injection is failing.

**Action:** Restore the `RIOT_API_TOKEN` secret (check 1Password/ExternalSecret source).

### 4. Scout Beta Down — Broken Image

`scout-beta-scout-backend` CrashLoopBackOff: `Module not found "src/index.ts"`. Image `scout-for-lol:2.0.0-724` has a broken entrypoint.

**Action:** Rebuild and push a fixed image, or roll back to a known-good tag.

### 5. Alertmanager → PagerDuty Broken

Both `AlertmanagerClusterFailedToSendAlerts` (critical) and `AlertmanagerFailedToSendAlerts` (warning) firing. Alert delivery to PagerDuty is failing, undermining the entire alerting pipeline.

**Action:** Check PagerDuty integration key and Alertmanager configuration.

## Warning Issues (14)

| #   | Issue                                     | Details                                                                          |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| W1  | Home Assistant down                       | `HaApplicationDown` critical alert firing; scrape targets down                   |
| W2  | Postgres pod OOM-killed                   | 512MB limit hit with failcnt 20,660; pod repeatedly hitting memory ceiling       |
| W3  | R2 storage over 1TB                       | Both "nearing" and "exceeding" alerts. PD \#3409/3410                            |
| W4  | Talosctl version mismatch                 | Client v1.12.5 vs server v1.12.0 — 5 patch versions behind                      |
| W5  | Loki/Tempo StatefulSet sync errors        | Immutable field changes; need delete + recreate with `--cascade=orphan`          |
| W6  | sentinel/status-page chart versions       | ChartMuseum version constraint matches no tags                                   |
| W7  | golink PostSync Job failed                | `golink-sync` hit backoff limit after 5 retries                                  |
| W8  | better-skill-capped-fetcher CronJob       | All 3 recent runs failed (BackoffLimitExceeded)                                  |
| W9  | Velero 6hourly/weekly backups failing     | Prometheus PVC ZFS snapshot fails; weekly 2/3 partial or full failure             |
| W10 | ZFS pool metrics missing                  | `zfs_pool_health` and `zfs_pool_fragmentation_ratio` return empty — blind spot   |
| W11 | SMART/NVMe exporter missing               | No `smartctl` or `nvme_smart_log` metrics — disk wear unmonitored                |
| W12 | NodeMemoryMajorPagesFaults                | Firing on torvalds                                                               |
| W13 | SustainedDiskWriteActivity                | nvme1n1 sustained writes                                                         |
| W14 | ZfsPoolFragmentationHigh                  | zfspv-pool-nvme on torvalds                                                      |

## ArgoCD Status

62 total apps: 41 Synced/Healthy. Issues:

| App                         | Status    | Health      | Issue                                        |
| --------------------------- | --------- | ----------- | -------------------------------------------- |
| apps (app-of-apps)          | Unknown   | Degraded    | Helm template YAML parse error at line 3504  |
| better-skill-capped-fetcher | OutOfSync | Degraded    | CronJob failing                              |
| scout-beta                  | Synced    | Progressing | Deployment stuck in Progressing              |
| scout-prod                  | OutOfSync | Progressing | Missing secret, rollout stuck                |
| sentinel                    | Unknown   | Healthy     | Chart version not found in ChartMuseum       |
| status-page                 | Unknown   | Healthy     | Chart version not found in ChartMuseum       |
| loki                        | OutOfSync | Healthy     | Immutable StatefulSet field (SyncError)      |
| tempo                       | OutOfSync | Healthy     | Immutable StatefulSet field (SyncError)      |
| golink                      | OutOfSync | Healthy     | PostSync Job backoff limit exceeded          |

~18 additional apps OutOfSync but Healthy (pending chart changes, manual sync policy — normal).

## Monitoring Stack Status

| Component    | Status   | Notes                                                     |
| ------------ | -------- | --------------------------------------------------------- |
| Prometheus   | Healthy  | Scraping and evaluating rules; Watchdog confirms pipeline |
| Grafana      | Healthy  | API responding for Prometheus and Loki datasources        |
| Loki         | Healthy  | Log ingestion and queries working                         |
| Alertmanager | Degraded | PagerDuty delivery failing (critical + warning alerts)    |

### Firing Alerts (26 distinct rules)

**Critical (7):** AlertmanagerClusterFailedToSendAlerts, HaApplicationDown, PostalMariaDBDown, PostalWebDown, PostalWorkerDown, R2StorageExceedingLimit, SmartDeviceTemperatureCritical (NVMe1)

**Warning (13):** AlertmanagerFailedToSendAlerts, KubeContainerWaiting, KubeDeploymentReplicasMismatch (5 deployments), KubeDeploymentRolloutStuck, KubeStatefulSetReplicasMismatch, NodeMemoryMajorPagesFaults, PostalPodRestarting, R2StorageNearingLimit, ReleasedPVsAccumulating, SmartDeviceTemperatureHigh, SustainedDiskWriteActivity, TargetDown (5 targets), ZfsPoolFragmentationHigh

**Info (3):** CPUThrottlingHigh, InfoInhibitor, Watchdog

### Scrape Targets Down

ha-service, hass, scout-service-beta, scout-service-prod, postal-postal-worker-service, status-page-status-page-service

## Backup Status

| Schedule | Recent     | Status                      | Issue                                 |
| -------- | ---------- | --------------------------- | ------------------------------------- |
| 6-hourly | 4h ago     | PartiallyFailed             | Prometheus PVC ZFS snapshot failing   |
| Daily    | 2h ago     | Completed                   | 113 warnings, no errors               |
| Weekly   | 6d ago     | PartiallyFailed (2 of 3)   | Mar 16 full failure, Mar 30 partial   |
| Monthly  | 3d ago     | Completed                   | 169 warnings, no errors               |

## Hardware Status

| Component      | Status    | Details                                                |
| -------------- | --------- | ------------------------------------------------------ |
| CPU            | Green     | 43% utilization, no active thermal throttling          |
| NVMe0          | Green     | 43–47°C (via node\_hwmon)                              |
| NVMe1          | Yellow    | SmartDeviceTemperatureCritical alert firing, sustained writes |
| SATA SSDs (6x) | Unknown   | No SMART exporter producing metrics                    |
| Memory         | Yellow    | 69% used, major page faults firing, postgres OOM       |
| ZFS ARC        | Green     | 99.78% hit rate                                        |
| ZFS NVMe pool  | Yellow    | Fragmentation alert firing                             |

## Network & Ingress

| Component        | Status  | Details                                        |
| ---------------- | ------- | ---------------------------------------------- |
| Tailscale        | Green   | Operator + 37 proxy pods all healthy, 0 restarts |
| Certificates     | Green   | 3 certs, all Ready=True                        |

## PagerDuty Incidents (11 triggered, all ~10 days old)

| #    | Incident                             | Severity |
| ---- | ------------------------------------ | -------- |
| 3398 | status-page targets down             | High     |
| 3402 | Cat feeder desiccant overdue (-25d)  | Medium   |
| 3403 | plex-tv-hdd-pvc 94.65% full         | High     |
| 3404 | Released PVs accumulating            | Medium   |
| 3408 | better-skill-capped-fetcher failed   | Low      |
| 3409 | R2 storage exceeding 1TB             | High     |
| 3410 | R2 storage approaching 1TB           | Medium   |
| 3411 | kubernetes-event-exporter CrashLoop  | Medium   |
| 3412 | event-exporter replica mismatch      | Medium   |
| 3413 | Velero backup item errors            | Medium   |
| 3426 | Litter Robot waste drawer high (72%) | Low      |

All 11 unacknowledged. Alert delivery to PagerDuty is broken, so no new incidents are being created.

## Cross-Validation

- **ArgoCD ↔ Pods:** Consistent. scout-beta/prod Progressing in ArgoCD matches CrashLoopBackOff pods. Postal Degraded matches MariaDB init failure.
- **Alerts ↔ Observed:** Consistent. All critical alerts correspond to confirmed pod failures.
- **Backups ↔ Schedules:** Consistent. All 4 schedules running on time, but 6hourly and weekly have recurring errors.
- **PagerDuty ↔ Alerts:** Stale. 11 incidents are 10 days old; no new incidents due to Alertmanager → PD delivery failure.

## Notable Loki Findings

1. **1Password Connect** still referencing removed Windmill secrets (`windmill-credentials`, `windmill-api-keys`, `cloud-credentials`)
2. **kubernetes-event-exporter** missing RBAC for `pods` in `buildkite` namespace
3. **Dagger CI** typecheck failures: ESLint config `exactOptionalPropertyTypes` mismatch between packages

## Recommended Actions (Priority Order)

1. **Fix app-of-apps Helm template** — YAML parse error at line 3504 blocks all child app syncs
2. **Fix Alertmanager → PagerDuty** — Restore alert delivery pipeline
3. **Restore scout-prod RIOT_API_TOKEN** — Secret injection failing
4. **Fix scout-beta image** — Rebuild `scout-for-lol:2.0.0-724` or roll back
5. **Investigate Postal MariaDB** — Init container stuck, likely missing credentials
6. **Investigate Home Assistant** — Down per critical alert
7. **Fix Postgres pod memory limit** — OOM with 20,660 failcnt; needs higher limit or workload tuning
8. **Upgrade Talos** — v1.12.0 → v1.12.5 to match client
9. **Recreate Loki & Tempo StatefulSets** — `--cascade=orphan` to fix immutable field sync errors
10. **Fix Velero ZFS snapshot** — Prometheus PVC consistently failing backup
11. **Deploy disk health exporters** — SMART and NVMe metrics are blind spots
12. **Clean up R2 storage** — Exceeding 1TB limit
13. **Triage 11 stale PagerDuty incidents**

## What's Working Well

- Core cluster healthy — all Talos health checks pass, etcd consistent, API server ready
- All 57 PVs bound, no orphans or pending PVCs
- All 13 DaemonSets fully healthy
- ZFS ARC excellent at 99.78% hit rate
- Tailscale network solid — 37 proxies all healthy with 0 restarts
- All certificates valid and auto-renewing
- CPU at 43% with no thermal throttling
- Daily and monthly backups completing cleanly
- Monitoring stack (Prometheus, Grafana, Loki) all healthy
- Kueue properly managing CI job scheduling
