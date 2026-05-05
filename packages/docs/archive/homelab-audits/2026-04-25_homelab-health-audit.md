# Homelab Health Audit — 2026-04-25

Runbook: `guides/2026-04-04_homelab-audit-runbook.md`

---

## Red / Critical

### 1. R2 Storage Exceeding 1.5TB Free-Tier Limit

- **PD incident:** Q3TYXQB19SACSA (triggered 2026-04-21, 4 days old, no notes, unacknowledged)
- **Alert:** `R2StorageExceedingLimit` (severity=critical) continuously firing; `R2StorageNearingLimit` also firing
- R2's free-tier hard cap is 1.5 TB; writes past this may be rejected or billed unexpectedly
- **Action:** Audit the `homelab` bucket — likely Loki/Tempo/Thanos object storage. Prune old data or add paid R2 capacity. This is the highest-urgency storage issue and is probably driving the `nvme1n1` 1.4 TB/day write rate (see Yellow #4 below).

### 2. NVMe `/dev/nvme0` Temperature at 62°C

- **PD incident:** Q2JAPCEKQ5UX21 (triggered 2026-04-25 ~14:38, <1 hour old, no notes)
- **Alert:** `SmartDeviceTemperatureHigh` — instance `100.102.88.89:9100`, SMART ID 194, threshold 60°C
- **Action:** Check chassis airflow and ambient temperature. Monitor closely; if temperature exceeds 70°C, throttle workloads. Likely correlated with the high write load from the R2 overflow.

### 3. Scout for LoL — 18,963 Events from Riot API 502s

- **Bugsink issue:** `0fd96737-5188-4f43-8c81-810059e58821`
- Highest-volume issue in the entire system. First seen 2026-04-07; last seen 2026-04-20 (5-day gap — Riot's upstream may have recovered)
- **Action:** Verify Riot API stability since Apr 20. If recovered, resolve in Bugsink. Add circuit breaker / dead-letter queue for upstream 502s in Scout's `twisted` client.

---

## Yellow / Warning

### Infrastructure

**4. `nvme1n1` Writing 1.4 TB/day — Extreme Write Amplification**

- PD incident Q14TEMDDQZRWP6 (triggered 2026-04-20, 5 days old, no notes)
- Device `nvme1n1` on `100.102.88.89:9100` wrote 1.401 TB in 24 hours. Almost certainly caused by R2 overflow (#1 above) — data that should go to R2 is being written locally.
- **Action:** Resolve R2 overflow first. Identify the writing process with `iotop` / node-exporter disk stats if the write rate doesn't drop after R2 is fixed.

**5. ZFS NVMe Pool Fragmentation at 60%**

- PD incident Q111MT15K7ETVO (triggered 2026-04-22, 3 days old, no notes). Also confirmed by Agent C Prometheus query.
- Alert threshold is >50%. Degrades random I/O and worsens write amplification.
- **Action:** `zpool scrub zfspv-pool-nvme` and `zpool set autotrim=on zfspv-pool-nvme` if not already enabled.

**6. Talos Server v1.12.0 vs Client v1.12.5**

- `talosctl version` shows: server v1.12.0 (node) vs client v1.12.5 — 5 patch versions behind.
- **Action:** `talosctl upgrade` to v1.12.5. Renovate PR #591 (Talos v1.12.7) is already open with passing CI — merge it instead to go directly to the latest patch.

**7. `argocd/apps` Parent App-of-Apps OutOfSync**

- 57 of 58 child apps are Synced/Healthy. The `apps` parent shows stale OutOfSync for `minecraft-sjerred`, `minecraft-shuxin`, `minecraft-tsmc` (all actually Synced when queried directly).
- **Action:** `argocd app get argocd/apps --hard-refresh` to clear stale reconciliation state.

**8. Velero `weekly-backup-20260330034504` PartiallyFailed**

- Plugin panic (`index out of range [-1]`) while snapshotting the Prometheus TSDB PVC (`/prometheus-prometheus-kube-prometheus-prometheus-db-...`). All subsequent backups (4 weekly, all daily, all 6-hourly) completed successfully — isolated incident.
- **Action:** Check Velero / ZFS CSI snapshot plugin versions for known `index out of range` bugs on high-churn PVCs. Consider adding a pre-backup hook to quiesce Prometheus writes, or excluding the TSDB PVC (data is reconstructable from retention). Monitor the next weekly backup (Mon Apr 27).

**9. Home Assistant Scrape Target Down — Cascading Alerts**

- `home-homeassistant-service.home:8123` (job=hass) is down; Prometheus shows consistent `up=0`.
- Downstream: `HaGoodMorningWorkflowMissing` (PD Q0XKTOEKAFLNCI, 2 days), `HaVacuumWorkflowMissing`, `HomeAssistantEntitiesUnavailable`, Roomba not running (PD Q0MPCKAU4IHVUR, 16 days), desiccant alert.
- All Tailscale ingress pods are Running — HA is reachable at the network level, but Prometheus cannot scrape the metrics endpoint.
- **Action:** Check HA pod logs and confirm the metrics endpoint is up. The Tailscale ingress pod for HA (`ts-home-homeassistant-tailscale-ingress-ingres-r9ltb-0`) is Running, so investigate HA itself.

**10. Released PVs Accumulating**

- PD incident Q3WPA20ROHKNBO (triggered 2026-04-08, **17 days old**, no notes)
- Confirmed: PV `pvc-4ada0fa5-5528-43d8-8618-9d51e8079a33` (1Gi, `better-skill-capped/better-skill-capped-manifest`) is Released. Underlying ZFS dataset still exists.
- **Action:** `kubectl get pv | grep Released` and manually delete or re-bind stale PVs after confirming data is not needed.

**11. 4 PostgreSQL PDBs Cannot Be Satisfied**

- `KubePdbNotEnoughHealthyPods` firing across: `bugsink`, `plausible`, `prometheus`, `temporal`
  - `postgres-bugsink-postgresql-critical-op-pdb`
  - `postgres-plausible-postgresql-critical-op-pdb`
  - `postgres-grafana-postgresql-critical-op-pdb`
  - `postgres-temporal-postgresql-critical-op-pdb`
- **Action:** Check if these are single-replica deployments with `minAvailable: 1` PDBs (misconfiguration) or if a pod is actually unhealthy. If pods are all Running, adjust PDB `minAvailable` to reflect single-replica reality.

**12. `better-skill-capped-fetcher` CronJob Failed**

- PD incident Q1JM4AKOSF7M8K (triggered 2026-04-14, **11 days old**, no notes)
- **Action:** `kubectl describe job better-skill-capped-fetcher-29603790 -n better-skill-capped` to determine failure reason, then delete the failed job object.

**13. Tempo Metrics-Generator "Empty Ring" — RED Metrics Broken**

- Tempo's querier returns HTTP 500 (`empty ring`) every ~15 seconds. Metrics-generator component has no members in its hash ring.
- Impact: `rate()`, `histogram_over_time()`, and RED metric queries in Grafana return empty/error. Service graph and RED dashboards are broken. Trace search still works.
- **Action:** Check if `tempo-metrics-generator` deployment/pod exists and is Running. Scale it up if at 0 replicas.

**14. `golink-sync` Schedule Stuck for 3 Days — 1,424 Skipped Firings**

- Workflow `golink-sync-workflow-2026-04-22T00:10:00Z` has been Running since Apr 22 with a pending activity (`createOrUpdateGolink`, attempt 2173) continuously failing with HTTP 403 for the `go/temporal` alias. `MaximumAttempts: 0` means it retries forever.
- `OverlapPolicy: Skip` means all subsequent schedule firings are silently skipped. Golink sync has not run for 3 days.
- **Action:** Investigate why golink returns 403 for `go/temporal`. Fix credentials/permissions, or terminate the stuck execution (`temporal workflow terminate --workflow-id golink-sync-workflow-2026-04-22T00:10:00Z`) to unblock the schedule. Add `MaximumAttempts` or `ScheduleToCloseTimeout` to prevent indefinite blocking.

**15. CPU Core 20 Hit Saturation-Level Thermal Throttling**

- `rate(node_cpu_core_throttles_total[5m])` peaked at 1.0 on core 20 (saturation). Cores 8, 12, 28 also throttled. Currently at 0 — transient burst.
- **Action:** Identify which workload caused the burst. Add a Grafana alert for `rate(node_cpu_core_throttles_total[5m]) > 0.5` on any single core.

**16. `ext-tailscale` and `ext-zfs-service` Health Unknown**

- Talos services are Running but health check reports `?` (no health probe configured).
- **Action:** `talosctl logs ext-zfs-service` and `talosctl logs ext-tailscale` to confirm normal operation.

**17. USB ZFS vdev on `sdg` (23 GB)**

- `sdg1` has a ZFS label (`zfs-e4d9436a43018737`). USB-attached storage is unreliable for production ZFS pools.
- **Action:** Identify which pool uses `sdg1`. If it holds production data, migrate to SATA or NVMe.

**18. Redlib — 51 Restarts in 40 Hours (Reddit 403)**

- Pod `redlib/redlib-74b4968dd8-bz7d6` exits after startup probe fails due to `403 Forbidden` from Reddit. Currently `Ready: True` but unstable.
- **Action:** Update Redlib to v0.36.x latest; check if Reddit is blocking this instance specifically. Add exponential backoff rather than a tight crash loop.

**19. `deps-summary-weekly` Schedule — No Last Run Time**

- Created 4 days ago; first fire is Monday Apr 27 at 9am PT. Not a problem — listed here for awareness.

### Bugsink Error Tracking

**20. Scout: ZodError Riot ID Format Validation — 642 Events (Active)**

- Last seen 2026-04-24. Fires when users submit Riot IDs with characters not matching the current regex. Some regions allow special characters — the pattern may be too strict.
- **Action:** Audit failing inputs; consider relaxing the regex or providing a user-facing validation error instead of a server exception.

**21. Scout: Spectator API Circuit Breaker Errors — New Since Apr 22**

- 148 events, first seen 2026-04-22, last seen 2026-04-25. `spectatorCircuit` in `active-game-detection.ts:167` recording failures. Circuit breaker is working correctly but Riot Spectator API is unreliable right now.
- **Action:** Verify Scout degrades gracefully when circuit is open. Consider rate-limiting Bugsink reporting for this specific error class.

**22. Scout: Data Dragon Cache Misses — 7 Champion Image Issues**

- FiddleSticks, Reksai, Ksante, RenataGlasc, Champion904 image issues still unresolved. `FiddleSticks` has a known capitalization inconsistency (`FiddleSticks` vs `Fiddlesticks`).
- **Action:** Run `bun run update-data-dragon` in `packages/data`. Fix the FiddleSticks capitalization separately at the code level.

**23. Scout: Unknown Queue IDs 3100 and 2400, Unknown Map ID 35**

- Queue 3100 (last seen today), queue 2400, map ID 35 — new Riot game modes/maps not in Scout's data mapping.
- **Action:** Add these to Scout's queue/map config data.

**24. `better-skill-capped`: AxiosError 404 — Resumed Daily Cadence**

- 19 events; last seen 2026-04-25 05:47 AM. Burst on Apr 5, quiet period, then resumed daily from Apr 22.
- Last release in Bugsink was 2026-02-19 (blank tag) — 2 months ago. Source maps unavailable for minified stack.
- **Action:** Identify which endpoint returns 404. Update Bugsink SDK to emit proper version strings on release.

**25. Birmel: 0 Bugsink Events Despite Live Deployment**

- Birmel is a running Discord bot (recent commits) with 0 events and no releases in Bugsink. SDK likely not configured or DSN missing from environment.
- **Action:** Verify Bugsink DSN is in Birmel's K8s secret / 1Password config.

**26. HA Workflows: 2 Lamp Unavailability Events (Low)**

- `bludot_stilt_lamp` and `signe_lamp` reported `unavailable` on 2026-04-21 19:09. 1 event each. Likely a brief Zigbee outage or HA restart. Downstream of HA scrape target being down (#9 above).
- **Action:** Verify lamps are reachable after HA is restored.

### CI / Pull Requests

**27. PR #594 Failing — Transient Tempo Chart 502**

- `chore: bump image versions to 2.0.0-1100` — `test-tube-test` failed because `tempo-1.24.4.tgz` returned 502 from GitHub CDN during `helm template`. Transient; all other 70 tests passed.
- **Action:** Retry the build on PR #594.

### Incident Hygiene

**28. 9 Open PD Incidents — None Acknowledged, None With Notes**

| Incident       | Title                            | Age         |
| -------------- | -------------------------------- | ----------- |
| Q3WPA20ROHKNBO | Released PVs accumulating        | **17 days** |
| Q0MPCKAU4IHVUR | Roomba not running               | **16 days** |
| Q1JM4AKOSF7M8K | Job failed (better-skill-capped) | **11 days** |
| Q14TEMDDQZRWP6 | SSD wear concern                 | **5 days**  |
| Q09WCGO2HV84UQ | R2 storage approaching limit     | **4 days**  |
| Q3TYXQB19SACSA | R2 storage exceeding limit       | **4 days**  |
| Q111MT15K7ETVO | ZFS fragmentation                | **3 days**  |
| Q0XKTOEKAFLNCI | HA Good Morning missing          | **2 days**  |
| Q2JAPCEKQ5UX21 | High NVMe temperature            | **<1 hour** |

**Action:** Acknowledge all incidents and add investigation notes. Oldest two (17d, 16d) indicate alert fatigue.

---

## Informational

- **`nvme_composite_temperature_celsius` metric empty** — `nvme-metrics-collector` DaemonSet not emitting this metric. NVMe temps are available via `node_hwmon_temp_celsius` as fallback, but the dedicated metric should be investigated.
- **`toolkit bugsink stacktrace <event-uuid>` returns 500** — Bug in Bugsink API or toolkit wrapper. Workaround: use `toolkit bugsink issue <uuid>` which shows inline stacktraces.
- **Granary feeder desiccant low** — `GranaryFeederDesiccantRemainingDays` alert firing. Replace desiccant pack.
- **`deps-summary-weekly` Temporal schedule** — Created 4 days ago; fires first on Mon Apr 27. No action needed.

---

## What's Working Well

- **Kubernetes cluster stable** — Single node `torvalds` Running, v1.35.0; 73% memory / 16% CPU. All 73 deployments, 57 StatefulSets, 13 DaemonSets healthy.
- **All 8 drives SMART-healthy** — 2 NVMe + 6 SATA; zero reallocated sectors; NVMe wear at 7% and 14%.
- **ZFS HDD pool healthy** — 21% fragmentation, within normal range.
- **ZFS ARC hit rate 99.7%** — Excellent cache efficiency.
- **All 35 Tailscale ingress pods Ready** — Full network access layer operational.
- **TLS certificates healthy** — All 3 cert-manager certs valid; 49–87 days to expiry.
- **57 of 58 ArgoCD apps Synced/Healthy** — Strong GitOps discipline.
- **Velero backup cadence reliable** — 25/26 backups completed; all 4 schedules (6-hourly, daily, weekly, monthly) on time.
- **No PVs above 85% utilization** — No storage pressure.
- **Prometheus/Alertmanager pipeline working** — Watchdog healthy; alerts reaching PagerDuty correctly.
- **Loki healthy** — Ingesting logs, ruler evaluating on schedule.
- **Main branch CI green** — Build #1100 passed; no stuck builds; agent controller healthy.
- **Temporal mostly healthy** — SERVING; 13 of 14 schedules firing on time; no failed workflows in 24h.
- **Renovate PR #591** (Talos v1.12.7) ready to merge with passing CI.

---

## Priority Action List

| P   | Item                                                    | Owner / Action                                       |
| --- | ------------------------------------------------------- | ---------------------------------------------------- |
| P1  | R2 storage exceeding 1.5TB — writes may be rejected     | Audit bucket, prune or expand                        |
| P1  | NVMe temp 62°C                                          | Check airflow; monitor closely                       |
| P1  | Acknowledge all 9 PD incidents, add notes               | Incident hygiene                                     |
| P2  | `nvme1n1` writing 1.4 TB/day                            | Fix R2 overflow first; then identify process         |
| P2  | ZFS NVMe fragmentation 60%                              | `zpool scrub` + `autotrim`                           |
| P2  | Home Assistant scrape target down                       | Check HA pod / metrics endpoint                      |
| P2  | `golink-sync` stuck 3 days (1,424 skipped firings)      | Fix 403 or terminate stuck workflow                  |
| P2  | PR #594 failing (transient)                             | Retry build                                          |
| P3  | Talos server v1.12.0 — merge Renovate PR #591 (v1.12.7) | Merge PR #591                                        |
| P3  | `argocd/apps` stale OutOfSync                           | `argocd app get argocd/apps --hard-refresh`          |
| P3  | Velero PartiallyFailed weekly backup                    | Check plugin version; add Prometheus pre-backup hook |
| P3  | Released PV in `better-skill-capped`                    | `kubectl delete pv pvc-4ada0fa5-...`                 |
| P3  | 4 PostgreSQL PDBs misconfigured                         | Adjust `minAvailable` or fix pods                    |
| P3  | `better-skill-capped-fetcher` failed job (11d)          | Investigate + delete job                             |
| P3  | Tempo metrics-generator empty ring                      | Check deployment, scale up if 0                      |
| P3  | Scout: data dragon cache misses                         | `bun run update-data-dragon`                         |
| P3  | Scout: unknown queue/map IDs                            | Add 3100, 2400, map 35 to config                     |
| P3  | Birmel: 0 Bugsink events                                | Verify DSN config                                    |
| P4  | USB ZFS vdev on `sdg`                                   | Identify pool; migrate if production                 |
| P4  | `ext-tailscale`/`ext-zfs-service` health unknown        | Review logs                                          |
| P4  | CPU core 20 throttling (transient)                      | Add Grafana alert for future events                  |
| P4  | `toolkit bugsink stacktrace` 500 error                  | Fix toolkit or Bugsink API                           |
| P4  | Granary desiccant low                                   | Replace desiccant pack                               |
