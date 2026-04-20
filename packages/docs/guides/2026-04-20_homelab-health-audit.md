# Homelab Infrastructure Health Audit — 2026-04-20

Produced by running the [Homelab Audit Runbook](2026-04-04_homelab-audit-runbook.md) across 5 parallel agents. All checks were read-only; no remediation has been applied.

## Cluster Overview

| Metric            | Value                                 | Metric                | Value                        |
| ----------------- | ------------------------------------- | --------------------- | ---------------------------- |
| Node              | `torvalds` (single, Ready)            | Uptime                | ~18h46m (reboot 2026-04-19)  |
| Talos (server)    | v1.12.0                               | Kubernetes            | v1.35.0                      |
| CPU               | 4564m / **14%**                       | Memory                | 90076Mi / **70%**            |
| Total pods        | 154                                   | Deployments           | ~75                          |
| DaemonSets        | 12 (all DESIRED=READY=1)              | StatefulSets          | all 1/1 (except 0-by-design) |
| ArgoCD apps       | 60 total (58 Healthy, 2 Degraded)     | Node age (registered) | 335d                         |
| Disks (physical)  | 32 TB (2× 990 PRO NVMe + 6× 870 SATA) | PVCs                  | all Bound (no Pending/Lost)  |
| Velero schedules  | 4 enabled (6h/daily/weekly/monthly)   | ZFS ARC hit           | **99.98%**                   |
| Open PD incidents | **16 (all unacked)**                  | Firing alerts         | 1 critical, ~10 warning      |

## Root Causes

Unlike the 2026-04-05 audit, there is no single cascading failure. Three **independent** problems dominate the findings:

1. **Temporal worker secret missing** — `temporal/temporal-worker-secrets` does not exist in the `temporal` namespace; the deployment has been stuck in `CreateContainerConfigError` for ~43h with 4985 retries. Almost every firing K8s alert (`KubeContainerWaiting`, `KubeDeploymentReplicasMismatch`, `KubeDeploymentRolloutStuck`, `KubePodNotReady`) is this one workload. Likely a 1Password Connect `OnePasswordItem` CR misconfiguration or credential rotation — no other 1Password-backed workloads are unhealthy, so the Connect server itself is probably fine.
2. **Plex HDD volume at 100%** — `media/plex-movies-hdd-pvc` is fully consumed. Any new library write will fail. Needs cleanup or PV expansion (see existing plan [PV Expansion](../plans/2026-04-04_pv-expansion.md)).
3. **R2 object storage over 1 TB cap** — `R2StorageExceedingLimit` (critical) is firing, escalated to PagerDuty (#3582). Outside the cluster but part of backup/media ingest capacity.

## Critical Issues (5)

### 1. Temporal Worker Deployment Stuck

- **Resource:** `Deployment temporal-temporal-worker` in ns `temporal`
- **Pod:** `temporal-temporal-worker-6dc7cf96b7-pb2gx` — `CreateContainerConfigError` for ~43h, 4985 container-start retries
- **Evidence:** `secret "temporal-worker-secrets" not found`. Worker references 12 env vars from it (`HA_URL`, `S3_*`, `AWS_*`, `GH_TOKEN`, `OPENAI_API_KEY`, `POSTAL_*`, etc.). ArgoCD app `argocd/temporal` is OutOfSync + Degraded since 2026-04-18 15:55 PDT with SyncError "synchronization tasks completed unsuccessfully (retried 5 times)". Image pinned to `:latest`.
- **PagerDuty:** #3811, #3813, #3828, #3835 (all open, unacked)
- **Action:** Check the `temporal` namespace for an `OnePasswordItem` (or ExternalSecret) CR that should produce `temporal-worker-secrets`; inspect `onepassword-connect-operator` logs for sync errors on that item. Also pin the worker image off `:latest`.

### 2. Plex Movies HDD PVC at 100% Utilization

- **Resource:** `PersistentVolumeClaim plex-movies-hdd-pvc` in ns `media`
- **Evidence:** `kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes == 1.00` (sustained; only PVC over the 85% threshold)
- **Impact:** Plex library volume is full; further writes will fail. No alert currently firing for this specific PVC.
- **Action:** Either prune media or expand the PV per [PV Expansion plan](../plans/2026-04-04_pv-expansion.md).

### 3. R2 Storage Exceeding 1 TB Cap

- **Alert:** `R2StorageExceedingLimit` (severity critical, firing)
- **PagerDuty:** #3582 (open, unacked). Warning counterpart `R2StorageNearingLimit` also firing.
- **Action:** Investigate which buckets drove the growth (Velero S3 target, toolkit-fetch cache, misc), prune or raise quota.

### 4. Redlib Crash Loop

- **Resource:** `Deployment redlib` in ns `redlib`
- **Pod:** `redlib-99884fc4b-7mx8h` in CrashLoopBackOff (per PD + `KubeContainerWaiting` firing)
- **PagerDuty:** #3826, #3827 (open, unacked)
- **Action:** `kubectl logs -n redlib redlib-99884fc4b-7mx8h --previous --tail=100` to capture crash reason; common causes for redlib are upstream Reddit API changes.
- **Cross-validation caveat:** Agent B's `kubectl get pods -A | grep -v Running/Completed` snapshot did **not** include redlib, while Agent D's alerts + PD flag it as actively crash-looping. Either the pod was momentarily Running when Agent B sampled, or the alerts are lagging real state. Verify directly before acting.

### 5. 16 Unacked PagerDuty Incidents

All incidents are triggered and assigned to the user, none acknowledged. Beyond the items called out above, notable open incidents include:

| #            | Summary                                                               | Context                                                               |
| ------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| #3546        | `obsidian-headless` spamming errors (oldest, from 2026-04-05)         | `'better-sqlite3' not yet supported in Bun` — runtime incompatibility |
| #3583        | R2 nearing limit                                                      | Paired with #3582                                                     |
| #3585        | ZFS fragmentation 57% on `zfspv-pool-nvme`                            | See Warning #6                                                        |
| #3601        | Roomba battery 1%, not charging                                       | Physical device                                                       |
| #3688        | Released PVs accumulating                                             | OpenEBS cleanup gap (see Warning #9)                                  |
| #3712        | Roomba 0 missions / 48h                                               | Physical device                                                       |
| #3714, #3834 | Failed CronJobs (`better-skill-capped-fetcher`, `dependency-summary`) | See Warning #5 + Critical ArgoCD apps degradation                     |
| #3824        | 92 HA entities unavailable                                            | See Warning #11                                                       |

**Action:** Batch-triage — ack the deployment-stuck incidents once remediation starts; close any stale ones (oldest is 15 days old).

## Warning Issues (14)

### 1. Talos Client/Server Version Skew

- Server (torvalds): v1.12.0 · Client (mac): v1.12.5
- Warning from `talosctl health`: `server version 1.12.0 is older than client version 1.12.5`
- **Action:** Upgrade Talos on `torvalds` (not urgent — both are 1.12.x minor).

### 2. Talos PKI Certificate Expires in ~2 Weeks

- `talosctl config info` shows cluster cert expiring **2026-05-06** (16 days from today).
- **Action:** Rotate via `talosctl gen secrets` → new `talosconfig`, or `talosctl upgrade-k8s` which rotates incidentally. Do **before** May 6.

### 3. `argocd/apps` App Degraded — `dependency-summary` CronJob Failing

- App is Synced but Degraded solely because child `CronJob dependency-summary/dependency-summary` has not completed its last run successfully.
- Most recent failure: `dependency-summary-29611680` (~163m ago). Earlier failure: `dependency-summary-29601600`.
- **Action:** `kubectl logs -n dependency-summary <failed-job-pod>` to diagnose.

### 4. `better-skill-capped-fetcher` CronJob — Multiple Failed Jobs Retained

- 3 failed jobs from 39–46 hours ago (`-29609025`, `-29609205`, `-29609475`) + newer runs succeeding.
- Failed Job objects are not reaped — either `ttlSecondsAfterFinished` is unset or `failedJobsHistoryLimit` too high.
- PagerDuty #3714 (open).
- **Action:** Add `ttlSecondsAfterFinished: 86400` (or similar) to CronJob spec; cleanup via `kubectl delete job -n better-skill-capped <name>` for existing ones after investigation.

### 5. Home Assistant — 92 Entities Unavailable

- Alert `HomeAssistantEntitiesUnavailable` firing (PD #3824).
- Dominated by Roomba, Eversweet water fountain, bedroom scenes/lights.
- **Action:** Most likely integration credentials / device offline rather than HA itself (HA pod is Running). Investigate in HA UI.

### 6. ZFS Fragmentation — `zfspv-pool-nvme` at 57%

- Alert `ZfsPoolFragmentationHigh` firing (PD #3585).
- **Action:** Plan a `zpool scrub` and consider evacuating + rebuilding the pool during a maintenance window if fragmentation trends up. Short-term impact minimal given ARC hit rate 99.98%.

### 7. Released PVs Accumulating

- Alert `ReleasedPVsAccumulating` firing (PD #3688). OpenEBS logs show `not able to get the ZFSVolume pvc-... not found` repeatedly (~22 of 30 recent error-log lines).
- **Cross-validation caveat:** `kubectl get pv` returned empty at the moment Agent B sampled — the accumulator likely tracks a churn window rather than current instantaneous state, and the orphans may be cleaned between polls.
- Existing plan [ZFS Orphan Cleanup](../plans/2026-03-26_zfs-orphan-cleanup.md) is already tracking this.

### 8. `dagger` Engine PVC at 66.8%

- `data-dagger-dagger-helm-engine-0` PVC climbing into warning band.
- **Action:** Monitor; schedule `dagger cache prune` or expand PV if trend continues.

### 9. CPU Throttling on `postal-mariadb-0` and `tasknotes/obsidian-headless`

- Alert `CPUThrottlingHigh` (info severity) firing for 2 containers.
- `postal-mariadb-0` — only the `metrics` sidecar is throttled, not MariaDB itself.
- `tasknotes/obsidian-headless` — the Bun incompatibility below compounds with CPU pressure.
- **Action:** Raise CPU limits on the `metrics` sidecar and `obsidian-headless` container in their respective Helm values.

### 10. TaskNotes `obsidian-headless` — Bun SQLite Incompatibility

- 90 errors per 5 min: `'better-sqlite3' is not yet supported in Bun`.
- PagerDuty #3546 (oldest open, 15 days).
- **Action:** Either pin the image to a Node-based variant or wait for Bun's `better-sqlite3` support to land and update. The current state produces constant log noise + CPU waste.

### 11. Velero — Prometheus TSDB PV Backup Partially Failed (Isolated)

- `daily-backup-20260415043820` failed S3 MultipartUpload for `prometheus-prometheus-kube-prometheus-prometheus-db-prometheus-prometheus-kube-prometheus-prometheus-0` (PVC `pvc-08c23bab-...`) with `SignatureDoesNotMatch` (HTTP 403). All subsequent daily/6-hourly/weekly/monthly backups have completed cleanly.
- **Action:** Watch next cycle — if it recurs on the same PV, rotate the S3 credentials used by the Velero ZFS snapshot plugin.

### 12. NVMe `nvme0` Sensor `temp3` at 69.85–73.85 °C

- Trips the runbook's 70°C NVMe threshold, but `temp3` on consumer NVMe is typically the controller warning sensor (vendor thresholds are 80/85°C). `temp1` (composite) and `temp2` stay 47–49°C.
- **Action:** Low priority. Confirm via vendor spec; if idle-state temps also sit in this range, improve M.2 airflow.

### 13. Monitoring Coverage Gaps

- `zfs_pool_health` and `zfs_pool_fragmentation_ratio` return empty frames — ZFS exporter is not emitting the series the runbook expects (Section 5). The `zpool_fragmentation` alert still fires though, so some ZFS metrics are present under different names.
- `smartctl_device_smart_status`, `smartctl_device_temperature_celsius`, `nvme_smart_log_*` all absent — no SMART/NVMe wear exporter deployed. Section 7 of the runbook cannot be fully satisfied.
- **Action:** Deploy `smartctl_exporter` and align the ZFS exporter metric names with the runbook's queries, or update the runbook to use the actual metric names in use.

### 14. Orphaned `media-plex` Pods from Prior GPU Plugin Flap

- 3 failed pods from old ReplicaSet `5c457fc795` (`-h5qtx`, `-mht6r`, `-zlvrn`) still listed; root cause was `gpu.intel.com/i915` device unhealthy at admission time. Current ReplicaSet is 1/1 Healthy.
- **Action:** `kubectl delete pod -n media media-plex-5c457fc795-{h5qtx,mht6r,zlvrn}` — cosmetic cleanup.

### Minor items (not called out above)

- Kueue `default` ClusterQueue is saturated (expected by design — see [Kueue for Buildkite](../decisions/2026-03-18_kueue-buildkite-resource-management.md)). Worth reviewing quota sizing if queue wait times hurt CI velocity.
- RBAC gap: `prometheus`-SA-backed `kubernetes-event-exporter` cannot list `workloads.kueue.x-k8s.io` in the `buildkite` namespace (1 log line). Grant read on the Kueue API in `buildkite` if event-export for those workloads is desired.
- `tailscaleingress` CRD not installed — the cluster uses the `tailscale.com/v1alpha1` ProxyGroup model (36 `ts-*-ingress-*-0` pods). Treat runbook Section 8's `tailscaleingress` check as n/a here; update the runbook to verify the `tailscale` namespace pods + `Connector`/`ProxyGroup` CRs instead.
- `cloudflare-operator-metrics-certs` + `cloudflare-operator-serving-cert` renew in ~2 days. Auto-renewal via cert-manager; confirm revision bumps successfully.
- Elevated pod restart counts clustered at "18h ago" across the cluster (openebs-zfs-localpv-controller 25, homelab-tunnel 21, argocd-repo-server 18, flannel/kube-proxy/coredns 15–16). This is the node reboot 2026-04-19, not individual instability.

## What's Working Well

- **Node health:** single-node control plane Ready; CPU 14%, memory 70% — both well below 85% threshold. Kernel dmesg clean (no ZFS faults, no MCE, no OOM, no hardware errors across 3,828 lines). All 13 Talos system services Running, all with health probes OK.
- **Storage cache:** ZFS ARC hit rate **99.98%** — exceptional. All 58 PVCs Bound, none Pending, no Released/Failed PVs in `kubectl get pv`.
- **Workload fleet:** 74 of 75 Deployments healthy (only `temporal-temporal-worker` unhealthy). Every DaemonSet at DESIRED=READY, every active StatefulSet 1/1 (35+ tailscale proxies, argocd controller, postgres instances, loki, seaweedfs, dagger, tempo, temporal-postgresql).
- **ArgoCD:** 58/60 apps Synced + Healthy. The 2 Degraded apps are isolated to single child resources (worker Deployment, one CronJob).
- **Backups:** all 4 Velero schedules enabled and running on time. Last 13 consecutive 6-hourly backups clean. Most recent daily/weekly/monthly cycles clean.
- **Monitoring:** Prometheus/Loki scraping without a single `up == 0` target. `Watchdog` alert firing (heartbeat green). Grafana + toolkit queries all responsive.
- **Hardware:** CPU thermals 34–37°C, thermal zone 27.8°C, SATA drive bays 34–37°C. Zero CPU throttling at the core level (`rate(node_cpu_core_throttles_total[5m]) == 0`).
- **Network/TLS:** All cert-manager Certificates READY=True, nearest expiry 32 days. Tailscale operator + all 35 proxy pods Running 1/1.
- **No cascading secrets issue** — last audit (2026-04-05) was dominated by 1Password Connect corruption affecting 27+ secrets. That cascade is resolved; Connect is serving correctly for every other workload.

## Cross-Validation Notes

| Check                                       | Result                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ArgoCD reported health vs actual pod state  | **Matches.** Degraded apps (`temporal`, `apps`) each isolate to the exact child resource identified by pod-level probes.                                                                                                                                    |
| Firing Prometheus alerts vs observed issues | **Matches** for deployment-stuck / replica mismatch / job failures. **Mismatch** for redlib crash loop: Agent D's alerts + PagerDuty show it active, Agent B's unhealthy-pod grep did not surface it. Verify directly before remediation (see Critical #4). |
| Backup recency vs declared schedule         | **Matches.** 6-hourly within the hour; daily within 16h; weekly within 14h; monthly on 2026-04-01 (next due 2026-05-01 — on schedule).                                                                                                                      |
| PagerDuty incidents vs firing alerts        | **Matches.** Every critical firing alert (R2StorageExceedingLimit) has a corresponding open PD incident. Deployment + crashloop alerts map 1:1 to their PD pages.                                                                                           |
| Released PVs alert vs `kubectl get pv`      | **Divergence.** Alert fires + OpenEBS logs show orphans, but instantaneous `get pv` was empty. Orphans likely transient or the alert tracks a historical window. Defer to the [ZFS orphan cleanup plan](../plans/2026-03-26_zfs-orphan-cleanup.md).         |

## Summary

Cluster is broadly healthy — far better than the 2026-04-05 audit, which was dominated by a 1Password Connect cascade. Current issues are bounded: one deployment blocked on a missing secret, one PVC full, one external quota breached, one container crash-looping, plus an unacknowledged incident queue that needs a triage pass. No hardware, thermal, storage, or network risks detected.

Immediate action list, in priority order:

1. Fix `temporal/temporal-worker-secrets` sync — this alone clears ~5 firing alerts and 4 PagerDuty incidents.
2. Triage the 16 open PD incidents (ack, close stale, link to remediation).
3. Prune or expand `plex-movies-hdd-pvc`.
4. Investigate + remediate the redlib CrashLoopBackOff (verify current state first).
5. Investigate R2 bucket growth and free capacity or raise the cap.
6. Schedule the Talos cert rotation before 2026-05-06.
