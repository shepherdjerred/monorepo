# Homelab Health Audit - 2026-05-02

Runbook: `guides/2026-04-04_homelab-audit-runbook.md`

Audit window: 2026-05-01 22:00-23:00 PDT / 2026-05-02 UTC.

## Summary

- ArgoCD inventory: 60/60 applications `Synced` and `Healthy`.
- Kubernetes node: `torvalds` Ready, Kubernetes v1.35.0, Talos v1.12.0, CPU 25%, memory 45%.
- Talos health: passing. Client/server version mismatch only: client v1.12.5, server v1.12.0.
- Open PagerDuty incidents: 18 triggered.
- Application matrix: 4 Red, 11 Yellow, 45 Green.

## Red / Critical

### 1. R2 Storage Exceeds the 1.5 TB Limit

- **Evidence:** `R2StorageExceedingLimit` critical alert firing; matching PagerDuty incidents 4095 and 4096 triggered since 2026-04-28 23:30 PDT.
- **Impact:** Object writes may fail or incur unexpected cost; this can cascade into backup, static-site, or telemetry storage failures.
- **Action:** Audit the `homelab` bucket, prune retained data, or move the bucket to an explicit paid capacity plan.

### 2. NVMe / Storage Path Under Thermal and IO Stress

- **Evidence:** `SmartDeviceTemperatureCritical`, `SmartDeviceTemperatureHigh`, `HighSystemTemperature`, `HighDiskWriteActivity`, and `NodeDiskIOSaturation` firing. PagerDuty reports `/dev/nvme0` at 63 C, `node_hwmon` sensor `temp3` at 88.85 C, `nvme0n1` writes at 377.1 MB/s, and IO queue at 606.94.
- **Evidence:** `zfspv-pool-nvme` fragmentation is 61%; `ZfsPoolFragmentationHigh` and `ZfsPoolHighFragmentation` are firing.
- **Impact:** Data path is still up, but the storage subsystem is in a critical degraded-risk state.
- **Action:** Reduce write load first, then inspect airflow/cooling. Run ZFS maintenance once IO pressure is controlled.

### 3. `media/qbittorrent-pvc` Is 95.9% Full

- **Evidence:** `kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes > 0.85` reports `media/qbittorrent-pvc` at about 0.959. `PVCStorageHigh` and `KubePersistentVolumeFillingUp` are firing; PagerDuty says the PVC is expected to fill within four days.
- **Impact:** qBittorrent and dependent media workflows can fail writes soon.
- **Action:** Delete or move completed downloads, expand the PVC, and verify qBittorrent free-space settings.

### 4. Temporal Workflows Are Failing Repeatedly

- **Evidence:** Temporal frontend is `SERVING` and namespaces are present, but `golink-sync-workflow-*` is failing every five minutes. Latest observed failures include `golink-sync-workflow-2026-05-02T05:50:00Z`; worker logs show `createOrUpdateGolink` fails with HTTP 403 for `go/temporal`.
- **Evidence:** `deps-summary-weekly-workflow-2026-04-27T16:00:00Z` is still Running after four days with repeated `fatal: error processing shallow info: 4`.
- **Evidence:** Prometheus `up{namespace="temporal"}` shows server metrics and app metrics are up, but `temporal-temporal-worker-metrics-service` is consistently `up=0`; `TemporalWorkerMetricsDown` and `TargetDown` are firing.
- **Action:** Fix golink auth/permissions or pause the schedule, terminate failed/stuck executions once root cause is fixed, and remove or correct the stale worker metrics ServiceMonitor target.

### 5. Scout Production Has Active Riot/API Failures

- **Evidence:** `ScoutRiotApiErrorRateHigh` is firing for prod. Bugsink project `Scout for LoL` has 10 unresolved issues, including active Arena participant validation and unknown queue/map IDs; `Arena participant missing playerSubteamId` was last seen 2026-05-01 22:31 PDT.
- **Impact:** Scout production user flows can degrade on active-game and match validation paths.
- **Action:** Add Riot queue/map coverage for IDs 3100, 3270, and map 35; handle Arena `playerSubteamId` absence safely; rate-limit or de-duplicate expected upstream Riot errors.

## Yellow / Warning

### Infrastructure and Operations

- **Velero warnings/deletion failure:** Schedules are fresh, but recent backups have warnings and `VeleroBackupDeletionFailed` is firing. One recent 6-hourly backup on 2026-04-29 was `PartiallyFailed`.
- **Released PV remains:** `pvc-4ada0fa5-5528-43d8-8618-9d51e8079a33` is still `Released` for `better-skill-capped/better-skill-capped-manifest`.
- **PDBs cannot be satisfied:** `KubePdbNotEnoughHealthyPods` is firing for PostgreSQL PDBs in `bugsink`, `plausible`, `prometheus`/Grafana DB, and `temporal`.
- **Home Assistant alerts:** `HomeAssistantEntitiesUnavailable` reports 80 unavailable/unknown entities; `GranaryFeederDesiccantRemainingDays` is overdue by 59 days.
- **Redlib instability:** `redlib-74b4968dd8-bz7d6` is currently Ready, but has 154 restarts.
- **Cloudflare tunnel restarts:** `homelab-tunnel` is Running, but has recent restart history.
- **Buildkite main is not conclusively green:** latest main build 1302 was running during the audit; latest completed main build 1289 failed. Agent pool is active with 10 agents.
- **Open PR health:** PR #635 and Renovate PR #626 have failed checks; several Renovate PRs are pending or have artifact failures.

### Bugsink

- **Temporal:** one unresolved issue, `IllegalStateError: Not running. Current state: DRAINING`, last seen 2026-04-26.
- **Better Skill Capped:** three unresolved Axios issues, latest `Network Error` last seen 2026-05-01.
- **Scout:** high unresolved issue volume and active production alert, covered under Red.
- **Home Assistant workflows, Discord Plays Pokemon, sjer.red:** no unresolved issues in the sampled Bugsink projects.

## Application Health

Row count: 60 rows for 60 live ArgoCD applications.

| App                            | Namespace                      | Status | Evidence                                                                                                     | Notes                                               |
| ------------------------------ | ------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `1password`                    | `1password`                    | Green  | ArgoCD Synced/Healthy; no secret-sync pod failures observed.                                                 | Secret-dependent apps are not blocked.              |
| `apps`                         | `argocd`                       | Green  | App-of-apps Synced/Healthy; 60 child apps accounted.                                                         | Inventory complete.                                 |
| `argocd`                       | `argocd`                       | Green  | ArgoCD Synced/Healthy; controllers running.                                                                  | Repo-server has restart history, currently Ready.   |
| `birmel`                       | `birmel`                       | Green  | ArgoCD Synced/Healthy; Bugsink has 0 events.                                                                 | Error telemetry may be sparse, but no active issue. |
| `blackbox-exporter`            | `prometheus`                   | Green  | ArgoCD Synced/Healthy; no static-site probe alerts firing.                                                   | None.                                               |
| `bugsink`                      | `bugsink`                      | Yellow | App Synced/Healthy; PostgreSQL PDB alert firing.                                                             | Functional, but disruption budget needs correction. |
| `buildkite`                    | `buildkite`                    | Yellow | Controller Running; 10 agents connected; latest completed main build failed.                                 | CI capacity exists; main needs follow-up.           |
| `cert-manager`                 | `cert-manager`                 | Green  | Certificates sampled are `Ready=True`.                                                                       | None.                                               |
| `chartmuseum`                  | `chartmuseum`                  | Green  | ArgoCD Synced/Healthy; ingress proxy present.                                                                | None.                                               |
| `cloudflare-operator`          | `cloudflare-operator-system`   | Green  | Controller app Synced/Healthy; webhook/metrics certs Ready.                                                  | None.                                               |
| `cloudflare-tunnel`            | `cloudflare-tunnel`            | Yellow | Tunnel workload Running, but restart history present.                                                        | Watch for repeated cloudflared restarts.            |
| `dagger`                       | `dagger`                       | Green  | ArgoCD Synced/Healthy; Buildkite jobs are starting Dagger work.                                              | None.                                               |
| `ddns`                         | `ddns`                         | Green  | ArgoCD Synced/Healthy; no scoped firing alert found.                                                         | None.                                               |
| `freshrss`                     | `freshrss`                     | Green  | ArgoCD Synced/Healthy; ingress proxy present.                                                                | None.                                               |
| `gickup`                       | `gickup`                       | Green  | ArgoCD Synced/Healthy; no Gitckup alert found.                                                               | None.                                               |
| `golink`                       | `golink`                       | Yellow | App Synced/Healthy, but Temporal `syncGolinks` fails every five minutes with HTTP 403.                       | Service may serve existing links; sync is degraded. |
| `grafana`                      | `prometheus`                   | Green  | Grafana stack usable; Prometheus queries and alert reads succeeded.                                          | None.                                               |
| `grafana-db`                   | `prometheus`                   | Yellow | Grafana DB Ready; PostgreSQL PDB alert firing.                                                               | Single-replica PDB likely misfit.                   |
| `home`                         | `home`                         | Yellow | App Synced/Healthy; HA entity and desiccant alerts firing.                                                   | Automations likely partially degraded.              |
| `intel-device-plugin-operator` | `intel-device-plugin-operator` | Green  | ArgoCD Synced/Healthy; cert Ready.                                                                           | None.                                               |
| `intel-gpu-device-plugin`      | `intel-device-plugin-operator` | Green  | ArgoCD Synced/Healthy.                                                                                       | GPU consumers can be evaluated when scaled up.      |
| `kueue`                        | `kueue-system`                 | Green  | Controller app Synced/Healthy; Buildkite queue events normal.                                                | None.                                               |
| `kyverno`                      | `kyverno`                      | Green  | ArgoCD Synced/Healthy; no policy admission outage observed.                                                  | None.                                               |
| `kyverno-policies`             | `kyverno-policies`             | Green  | Policy app Synced/Healthy.                                                                                   | None.                                               |
| `loki`                         | `loki`                         | Green  | ArgoCD Synced/Healthy; log queries succeeded.                                                                | None.                                               |
| `mc-router`                    | `mc-router`                    | Green  | ArgoCD Synced/Healthy.                                                                                       | Minecraft workloads are idle unless scaled.         |
| `mcp-gateway`                  | `mcp-gateway`                  | Green  | ArgoCD Synced/Healthy; ingress proxy present.                                                                | None.                                               |
| `media`                        | `media`                        | Red    | ArgoCD Healthy, but `qbittorrent-pvc` is about 95.9% full.                                                   | Immediate storage cleanup or expansion needed.      |
| `minecraft-allofcreate`        | `minecraft-allofcreate`        | Green  | Synced/Healthy; desired replicas 0.                                                                          | Expected idle state.                                |
| `minecraft-allthemons`         | `minecraft-allthemons`         | Green  | Synced/Healthy; desired replicas 0.                                                                          | Expected idle state.                                |
| `minecraft-bettermc`           | `minecraft-bettermc`           | Green  | Synced/Healthy; desired replicas 0.                                                                          | Expected idle state.                                |
| `minecraft-ftbskies2`          | `minecraft-ftbskies2`          | Green  | Synced/Healthy; desired replicas 0.                                                                          | Expected idle state.                                |
| `minecraft-shuxin`             | `minecraft-shuxin`             | Green  | Synced/Healthy; desired replicas 0.                                                                          | Expected idle state.                                |
| `minecraft-sjerred`            | `minecraft-sjerred`            | Green  | Synced/Healthy; desired replicas 0.                                                                          | Expected idle state.                                |
| `minecraft-stoneblock4`        | `minecraft-stoneblock4`        | Green  | Synced/Healthy; desired replicas 0.                                                                          | Expected idle state.                                |
| `minecraft-tsmc`               | `minecraft-tsmc`               | Green  | Synced/Healthy; desired replicas 0.                                                                          | Expected idle state.                                |
| `nfd`                          | `node-feature-discovery`       | Green  | ArgoCD Synced/Healthy.                                                                                       | None.                                               |
| `openebs`                      | `openebs`                      | Red    | App Synced/Healthy, but storage alerts are critical: NVMe heat/IO, ZFS fragmentation, released PV.           | Storage subsystem needs immediate attention.        |
| `plausible`                    | `plausible`                    | Yellow | App Synced/Healthy; PostgreSQL PDB alert firing.                                                             | Functional, but disruption budget needs correction. |
| `pokemon`                      | `pokemon`                      | Green  | Synced/Healthy; desired replicas 0.                                                                          | Expected idle state.                                |
| `postal`                       | `postal`                       | Green  | ArgoCD Synced/Healthy; no Postal alert found.                                                                | None.                                               |
| `postal-mariadb`               | `postal`                       | Green  | MariaDB app Synced/Healthy; no storage alert scoped to it.                                                   | None.                                               |
| `postgres-operator`            | `postgres-operator`            | Green  | Operator Synced/Healthy.                                                                                     | Managed DBs need PDB review.                        |
| `prometheus`                   | `prometheus`                   | Yellow | Monitoring stack works, but many alerts are firing and Grafana DB PDB alert is active.                       | Stack is functional; alert backlog is high.         |
| `prometheus-adapter`           | `prometheus`                   | Green  | ArgoCD Synced/Healthy.                                                                                       | None.                                               |
| `promtail`                     | `promtail`                     | Green  | ArgoCD Synced/Healthy; Loki receives logs.                                                                   | None.                                               |
| `redlib`                       | `redlib`                       | Yellow | Pod Ready, but 154 restarts.                                                                                 | Review logs and upstream Reddit behavior.           |
| `s3-static-sites`              | `s3-static-sites`              | Yellow | App Synced/Healthy; no static-site probe alert, but R2 bucket critical alert may affect object-backed sites. | Validate public probes after R2 fix.                |
| `scout-beta`                   | `scout-beta`                   | Green  | ArgoCD Synced/Healthy; active Scout alert is prod-scoped.                                                    | None.                                               |
| `scout-prod`                   | `scout-prod`                   | Red    | ArgoCD Healthy, but `ScoutRiotApiErrorRateHigh` is firing and Bugsink has active Scout issues.               | Production user flows may be degraded.              |
| `seaweedfs`                    | `seaweedfs`                    | Green  | ArgoCD Synced/Healthy; no SeaweedFS alert observed.                                                          | None.                                               |
| `starlight-karma-bot-beta`     | `starlight-karma-bot-beta`     | Green  | ArgoCD Synced/Healthy; Bugsink Starlight has 0 events.                                                       | None.                                               |
| `starlight-karma-bot-prod`     | `starlight-karma-bot-prod`     | Green  | ArgoCD Synced/Healthy; Bugsink Starlight has 0 events.                                                       | None.                                               |
| `status-page`                  | `status-page`                  | Green  | ArgoCD Synced/Healthy; no scoped alert found.                                                                | None.                                               |
| `syncthing`                    | `syncthing`                    | Green  | ArgoCD Synced/Healthy; ingress proxy present.                                                                | None.                                               |
| `tailscale`                    | `tailscale`                    | Green  | Operator and generated ingress proxy pods Running.                                                           | None.                                               |
| `tasknotes`                    | `tasknotes`                    | Green  | ArgoCD Synced/Healthy; Bugsink TaskNotes projects have 0 events.                                             | None.                                               |
| `tempo`                        | `tempo`                        | Green  | ArgoCD Synced/Healthy; no Tempo alert observed.                                                              | None.                                               |
| `temporal`                     | `temporal`                     | Red    | Server `SERVING`, but workflow failures and stale worker metrics target are active.                          | Runtime is up; workflow health is not.              |
| `velero`                       | `velero`                       | Yellow | Schedules fresh, but backup warnings and deletion failure alert active.                                      | Review latest backup warnings and stuck deletion.   |

## CI and PR State

- Buildkite `main`: build 1302 was running; build 1289 failed within the last 24 hours.
- Buildkite agents: 10 connected, 9 running and 1 idle at sample time.
- Open PRs sampled: #638 pending, #635 failing, #626 failing, #624 passing, #623/#621/#617/#596 pending, #619/#611/#608 artifact failures or pending, #591 passing.

## What's Working Well

- The Kubernetes control plane, kubelet, and Talos health checks pass.
- All 60 ArgoCD applications are Synced/Healthy at the GitOps layer.
- All active PVCs are Bound; no Pending or Lost PVCs found.
- SMART health is passing for all enumerated disks; NVMe spare is 100%, wear is 7% and 14%.
- Tailscale operator and generated ingress proxy pods are Running.
- Cert-manager certificates sampled are Ready.
- Temporal core service is reachable from inside the server pod and reports `SERVING`.
- Velero schedules are enabled and recent backups exist, despite warning cleanup work.

## Priority Action List

| P   | Item                                               | Action                                                               |
| --- | -------------------------------------------------- | -------------------------------------------------------------------- |
| P1  | R2 bucket over limit                               | Prune or expand object storage immediately.                          |
| P1  | NVMe heat, IO saturation, ZFS fragmentation        | Reduce write load, inspect cooling, then run ZFS maintenance.        |
| P1  | `media/qbittorrent-pvc` 95.9% full                 | Clean up or expand the PVC.                                          |
| P1  | Temporal `golink-sync` and `deps-summary` failures | Fix 403/git failures; terminate or pause bad executions.             |
| P1  | Scout prod Riot/API errors                         | Patch queue/map/Arena handling and verify prod.                      |
| P2  | Velero warnings and deletion failure               | Inspect latest backup warnings and failed deletion.                  |
| P2  | PostgreSQL PDB alerts                              | Adjust PDBs or replica counts for single-replica clusters.           |
| P2  | Released PV                                        | Delete or archive stale `pvc-4ada0fa5-...` after data confirmation.  |
| P2  | Home Assistant entity alerts                       | Resolve unavailable entities and replace desiccant.                  |
| P2  | Buildkite main failure                             | Inspect build 1289 and wait for or fix build 1302.                   |
| P3  | Redlib restart history                             | Review logs and update/configure Redlib if Reddit blocking persists. |
| P3  | Talos version mismatch                             | Upgrade server from v1.12.0 to current pinned patch.                 |
