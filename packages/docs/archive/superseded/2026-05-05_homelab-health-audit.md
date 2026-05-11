# Homelab Infrastructure Health Audit — 2026-05-05

Produced by running the [Homelab Audit Runbook](../../guides/2026-04-04_homelab-audit-runbook.md) across 8 parallel agents (Sections 1–13). All checks were read-only; no remediation has been applied.

## Cluster Overview

| Metric                | Value                                                                | Metric                  | Value                                                    |
| --------------------- | -------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------- |
| Node                  | `torvalds` (single, Ready, 350d age)                                 | Uptime                  | core services Running ~14h since last bounce             |
| Talos (server)        | v1.12.0                                                              | Talos client            | v1.12.5 (skew, same as 2026-04-26)                       |
| Kubernetes            | v1.35.0                                                              | Kernel                  | 6.18.1                                                   |
| CPU                   | ~10% (3350m used)                                                    | Memory                  | ~64% (~82.5 GiB used)                                    |
| Pods                  | ~80 active workloads                                                 | Deployments             | 80 (1 WIP: `home-zwave-js-ui`)                           |
| StatefulSets          | 26 (8 Minecraft idle 0/0, all reconciled)                            | DaemonSets              | 12 (all DESIRED=READY)                                   |
| ArgoCD apps           | 60 (58 Synced+Healthy, 1 OOS, 1 Degraded WIP)                        | PV / PVC                | 57 PV (1 Released), 57 PVC (1 Pending)                   |
| Velero schedules      | 4 enabled, current cadence                                           | Last weekly backup      | **PartiallyFailed** (qbittorrent-pvc S3 sig)             |
| Open PD incidents     | 19 (most mirror Prom alerts; 2 non-Prom: Velero items, Released PVs) | Distinct firing alerts  | 20 (excl. Watchdog)                                      |
| Kubeconfig admin cert | **expires 2026-05-10 (5 days)** — `talosctl kubeconfig --force`      | Talos admin client cert | 2027-04-26 (rotated recently)                            |
| NVMe wear             | `nvme0n1`: 14% used, 100% spare, 46–49 °C                            | SMART exporter          | **no series** (regression vs. 2026-04-26)                |
| Tailscale proxies     | 36/36 Ready (operator + 35 ingress proxies)                          | Cert-manager            | 3/3 Ready, none expiring within 14d                      |
| Bugsink               | **API offline** (Postgres PVC 100% full)                             | Open PRs                | 10 (0 conflicts; 6 Renovate fail; PR #621 TS6 broad red) |
| `main` CI             | green (build #1528 passed ~17m ago)                                  | Temporal failures (24h) | **12 failed + 1 timed-out workflow runs**                |

## Root Causes

Three independent issues dominate today's findings, plus a long tail of structural noise:

1. **Bugsink Postgres PVC is full → entire error-tracking pipeline is offline.** The `pgdata-bugsink-postgresql-0` PVC reads `1.0` (100%) on `kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes`. Five storage alerts are firing for the same volume (`BugsinkPVCStorageCritical`, `BugsinkPVCStorageHigh`, `PVCStorageHigh`, `KubePersistentVolumeFillingUp`, `KubePersistentVolumeInodesFillingUp`). The Bugsink web tier is reachable but every API call returns HTTP 500 with `connection to server at "10.108.116.175", port 5432 failed: Connection refused` — Postgres has stopped accepting connections because the data volume cannot accept writes. The Temporal `runBugsinkHousekeepingWorkflow` has been failing for the same reason. Until the volume is expanded (or events are pruned and Postgres recovers), every SDK in the homelab is dropping events silently.
2. **Kubeconfig admin client cert expires 2026-05-10 (5 days out).** The kubeconfig file's `O=system:masters/CN=admin` user was issued by the cluster's Kubernetes CA (`/O=kubernetes`) on 2025-05-10 with 1-year validity. `notAfter=May 10 21:03:02 2026 GMT`. Talos doesn't auto-rotate this; you have to re-pull kubeconfig with `talosctl kubeconfig --force`. The Talos admin client cert (`~/.talos/config`) is a separate cert and is fine until 2027-04-26. There is **no Prometheus alert** defined for kubeconfig client cert expiry — observability gap to backfill.
3. **Five `runDocsGroomTask` activities + three `runDocsGroomAudit` activities failing on Claude/git tooling regressions.** Five distinct `runDocsGroomTask` runs in the last 24h failed at `parseImplementResult` in `packages/temporal/src/activities/docs-groom-claude.ts:203` because the Claude CLI output had no JSON envelope. Three `runDocsGroomAudit` runs failed at `git commit exit 1` despite the `412d4d56c` "skip push cleanly when nothing is staged" fix — a different shellquoting failure on the commit message. None of these reach PagerDuty (no namespace-scoped alert exists), so they are only visible via the Temporal UI and the workflow listing.

## Critical Issues (2)

Bugsink Postgres is the active outage; kubeconfig cert is the time-pressured one.

### 1. Bugsink Postgres PVC at 100% — Error Tracking Offline

- **Resource:** PVC `bugsink/pgdata-bugsink-postgresql-0`, used by StatefulSet `bugsink-postgresql`.
- **Evidence:**
  - `kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes` = `1.0`.
  - `velero` backup of the volume succeeded 4h ago at 749,338,624 / 749,338,624 bytes (~715 MiB) — the volume is sized at 715 MiB total.
  - Every `toolkit bugsink projects|issues|releases|teams` call returns HTTP 500: `connection to server at "10.108.116.175", port 5432 failed: Connection refused`.
  - PD incidents 4284, 4285, 4286, 4288, 4289 — `BugsinkPVCStorageCritical`, `BugsinkPVCStorageHigh`, `PVCStorageHigh`, `KubePersistentVolumeFillingUp`, `KubePersistentVolumeInodesFillingUp`.
  - Temporal workflow `bugsink-housekeeping-workflow-2026-05-05T10:00:00Z` failed with the same Postgres error.
- **Impact:** Every SDK that ships to Bugsink is failing or queuing locally with no operator visibility. The audit could not enumerate projects, issues, regressions, or release tracking gaps. Section 9 substantive checks must be re-run after remediation.
- **Action:**
  1. Inspect the StatefulSet PVC and the underlying ZFS volume; expand `pgdata-bugsink-postgresql-0` (the StorageClass `zfs-ssd` should support online resize).
  2. Once Postgres comes back, run `toolkit bugsink projects` and on success kick off `runBugsinkHousekeepingWorkflow` manually to drain the backlog.
  3. Add (or verify) a Grafana/PagerDuty alert on Bugsink HTTP 5xx rate and on Postgres pod readiness so the next outage pages instead of waiting for the next manual audit. The current PVC alerts paged but nothing alerted on the API itself going hard-500.
  4. Pick a target retention policy in Bugsink rather than only growing the volume — this PVC was healthy at the 2026-04-26 audit, so growth is recent and structural.

### 2. Kubeconfig Admin Client Cert Expires 2026-05-10 (5 Days Out)

- **Resource:** Kubeconfig user `O=system:masters/CN=admin` in `~/.kube/config`, used by every `kubectl` invocation against the `torvalds` cluster.
- **Evidence:**
  - `kubectl config view --raw --minify -o jsonpath='{.users[0].user.client-certificate-data}' | base64 -d | openssl x509 -noout -subject -issuer -dates` →
    - `subject= /O=system:masters/CN=admin`
    - `issuer= /O=kubernetes`
    - `notBefore=May 10 21:02:52 2025 GMT`
    - `notAfter=May 10 21:03:02 2026 GMT`
  - The Talos admin client cert (`~/.talos/config`) is a separate cert and is fine: `talosctl config info` reports expiry 2027-04-26.
  - The kube-apiserver serving cert is also fine: `openssl s_client -connect torvalds.tailnet-1a49.ts.net:6443` reports `notAfter=May 5 02:30:05 2027 GMT`.
  - Zero firing/defined Prometheus alerts cover this cert: `toolkit gf alerts | grep -iE 'cert|expir|pki|x509'` is empty.
- **Impact:** Once 2026-05-10 passes, every `kubectl` call rejects authentication; cluster keeps running but admin access is locked out until rotation.
- **Action:**
  1. Run `talosctl --talosconfig ~/.talos/config kubeconfig --force` to overwrite `~/.kube/config` with a freshly issued cert (CN=admin, O=system:masters, ~1y validity). Verify with `kubectl config view ... | openssl x509 -noout -dates` post-rotation; confirm `kubectl get nodes` still works.
  2. If the kubeconfig is managed by chezmoi, update the chezmoi source in lockstep per the dual-edit rule.
  3. Backfill the observability gap: ship a textfile-collector CronJob (or equivalent) that emits a `kube_admin_client_cert_expiry_seconds` metric, plus a Prometheus alert that pages 30 days before expiry. This avoids the same surprise next year.
  4. Lesson learned: prior audits' time-bounded findings (cert "X days out") must be re-verified against the live cert each run, not extrapolated. The 2026-04-26 audit's "10 days" was extrapolated to "1 day" today; an `openssl x509 -dates` check caught the wrong-cert mistake.

## Warning Issues (12)

### 1. Five Bugsink-blocked & Eight Other Failed Temporal Workflows in 24h

Beyond the Bugsink-housekeeping cascade above, the last 24h has 11 other failed workflow runs and 1 timed-out run:

- `runDocsGroomTask` × 5 failed at `parseImplementResult` (`docs-groom-claude.ts:203`, "no JSON envelope") on tasks: review-ha-cleanup-followups-staleness, verify-dagger-ci-infra-fixes-status, verify-ci-quality-hardening-status, verify-monarch-package-exists, archive-homelab-audit-2026-04-25.
- `runDocsGroomAudit` × 3 failed at `git commit exit 1` (separate shellquote failure from the empty-stage path fixed in 412d4d56c).
- `scout-data-dragon-version-check-workflow` failed because `bun test --update-snapshots` rejects the test runtime — env-var validation in `packages/scout-for-lol/packages/backend/src/configuration.ts:48` requires `ENVIRONMENT` to be set.
- `golink-sync-workflow` failed once with "Unable to connect" to the golink endpoint — likely transient, but tag for re-check next audit.
- `deps-summary-weekly-workflow` failed because `POSTAL_HOST`, `POSTAL_API_KEY`, `RECIPIENT_EMAIL`, `SENDER_EMAIL` are missing from the worker pod env. Either the secret was rotated/removed or the worker is mounting a stale secret.
- `goodMorningEarly` timed out at the 30m run timeout (the 412d4d56c-adjacent "cap goodMorningEarly heat at 30°C" fix suggests known thermostat trouble; investigate Mysa/HA call hang).

**Action:** prioritize the docs-groom JSON-envelope and git-commit fixes (highest blast radius), then fix the deps-summary secret mount, then move on to the scout-data-dragon test-runtime validation. None of these page; they are silent until you check the Temporal UI.

### 2. Talos Client/Server Version Skew (Persistent)

- Server (torvalds): v1.12.0 · Client (mac): v1.12.5 (5 patches behind, same as 2026-04-26).
- This is purely an upgrade-availability item — schedulable, not on a deadline. Talos admin client cert is fine until 2027-04-26 (separate from the kubeconfig client cert in Critical #2).
- **Action:** Schedule a Talos node upgrade to v1.12.5 when convenient.

### 3. Bugsink Application-Level Alert Coverage Missing

The five PVC alerts fired but nothing alerted on the application going hard-500. **Action:** Add Bugsink HTTP 5xx and Postgres pod readiness alerts so the application-surface failure pages directly.

### 4. ArgoCD `apps` OutOfSync (Cosmetic Drift)

- `argocd app diff argocd/apps` shows three Minecraft Application objects (`minecraft-shuxin`, `minecraft-sjerred`, `minecraft-tsmc`) where ArgoCD's server-side state adds `group: ""` to `ignoreDifferences` entries that the source manifests do not include.
- Also: cloudflare-operator mutates `TunnelBinding` subjects after Argo applies them, producing perpetual drift on a couple of fields.
- **Action:** Add explicit `group: ""` to the ignoreDifferences entries for the three Minecraft Application objects in the cdk8s parent chart. Extend `ignoreDifferences` for TunnelBinding to cover the remaining mutated path, or accept as cosmetic Yellow indefinitely.

### 5. Velero Weekly Backup PartiallyFailed for `qbittorrent-pvc`

- `weekly-backup-20260504034506` is `PartiallyFailed` (1 errored item). ZFS snapshot upload of `qbittorrent-pvc` (`pvc-a1726678-2463-4706-b4e7-d89fa3a31675`) failed mid-multipart with S3 `SignatureDoesNotMatch` (HTTP 403).
- 4 prior weekly backups were `Completed` cleanly; daily/6-hourly cadence is intact (latest 6-hourly 4h ago, 0 errors).
- **Action:** Re-run weekly backup ad-hoc for `media`/`qbittorrent` namespace; verify SeaweedFS S3 credentials match what BackupStorageLocation `default` uses — `SignatureDoesNotMatch` is a credential-rotation or clock-skew symptom.

### 6. ZFS Pool Metrics Missing from Prometheus

- `zfs_zpool_fragmentation`, `zfs_zpool_capacity_used_ratio`, `zfs_zpool_size_bytes` all return empty frames. The mayadata/openebs zfs-localpv exporter is not exposing pool-level metrics; only `zfs_snapshot_*` series are present.
- Pool state from node-exporter (`node_zfs_zpool_state`) reports both pools `online`. ARC hit rate is excellent (98.30%).
- **However:** PD incident 4254 (`zfspv-pool-nvme` fragmentation 61% > 50%) and 4255 (high threshold) are still triggered from before the metric regression. Either the metrics existed at incident-creation time and were since lost, or the incidents were filed via another path.
- **Action:** Enable zpool metrics in the openebs zfs-localpv exporter (or deploy `zfs_exporter`) so the runbook's documented alerts can fire again. While at it, check whether incidents 4254/4255 still reflect reality.

### 7. SMART Exporter Producing No Series (Regression)

- `smartmon:device_healthy`, `smartmon_temperature_celsius_raw_value`, `smartmon_reallocated_sector_ct_raw_value` all return empty frames.
- 2026-04-26 audit reported `8/8 disks SMART PASSED` from this same exporter, so this is a regression somewhere in the last 9 days.
- **Action:** Inspect `packages/homelab/src/cdk8s/src/resources/monitoring/smartmon.sh` and the corresponding textfile-collector mount; non-NVMe disk health is currently invisible.

### 8. CPU `coretemp` Sensor Not Exposed

- `node_hwmon_temp_celsius` only exposes the NVMe controller sensors (`chip=nvme_nvme0`); CPU package temps are unmonitored.
- 0 CPU core throttling events detected via `node_cpu_core_throttles_total[5m]`, so this is an observability gap rather than a thermal incident.
- **Action:** Confirm the `coretemp` kernel module is loaded on Talos / node-exporter; expose the sensor via hwmon.

### 9. R2 Object Storage Over 1.5 TB Cap (Persistent)

- PD incidents 4250 (`R2StorageExceedingLimit`, critical) and 4252 (`R2StorageNearingLimit`, warning) — same condition flagged in 2026-04-26 (then incidents 3889/3890). Bucket has been over the cap for ~14+ days.
- **Action:** Identify which prefix (Velero S3 target, toolkit-fetch cache, anything else writing to R2) drives growth, prune or commit to a higher cap. Two consecutive cap breaches indicates the trend is structural; pick a target retention policy.

### 10. `kubernetes-event-exporter` OOM Kills (4 Cycles This Morning)

- 9 OOM-related dmesg lines between 07:19–07:40 UTC (4 distinct invocations) for the `kubernetes-event-exporter` Deployment in `kube-system`. Memcg-scoped (cgroup limit), not host-wide. Memory: total-vm 858 MiB, anon-rss ~120 MiB at kill.
- Pod is currently Running (kubelet restarted it); no PD alert paged.
- **Action:** Raise the Deployment's memory limit (or investigate the event-volume spike that overran it). Add a `KubeContainerOOMKilled` namespace alert if not present.

### 11. PDB-vs-Single-Replica Structural Failures (4 Apps)

- `KubePdbNotEnoughHealthyPods` is firing in `bugsink`, `plausible`, `prometheus`, `temporal`. All four are running with a 1-replica deployment and a PDB that requires `minAvailable: 1`, so any disruption blocks. This is structural, not an outage.
- **Action:** Either set `minAvailable: 0` / `maxUnavailable: 1` on the PDBs (single-replica is fine for homelab) or scale the affected workloads to 2 replicas where data layer permits.

### 12. Long Tail of Stale State

- **Stale Plex pod object:** `media/media-plex-64cfdc584d-8r82k` in `UnexpectedAdmissionError` for 11 days alongside the healthy `media-plex-64cfdc584d-x28vp`. `kubectl delete pod -n media media-plex-64cfdc584d-8r82k` clears it. Same orphan pattern flagged on 2026-04-26.
- **Released PV:** `pvc-4ada0fa5-…` (1Gi RWX zfs-ssd, claimed by `better-skill-capped/better-skill-capped-manifest`) has been Released for 120d with `Retain` reclaim policy. Same finding as 2026-04-26 — no progress.
- **Bot/scraper noise:** `redlib` has 171 restarts (Reddit upstream rate-limiting), `openebs-localpv-provisioner` 11 restarts, `prometheus-zfs-zpool-collector` 32 restarts. None affect functionality but warrant a one-pass log review.
- **Temporal scrape ServiceMonitors:** `TemporalServerMetricsDown` and `TemporalWorkerMetricsDown` are firing, yet the temporal `up` series shows `1`. The ServiceMonitor selector is likely stale after the worker re-roll 9h ago; reconcile selector vs. service ports.
- **`scout-prod` `ScoutRiotApiErrorRateHigh` firing.** App is healthy locally; investigate Riot API regional rate-limit or rotate the API key in 1Password Connect.
- **`SustainedDiskWriteActivity` on `nvme0n1`:** 2.55 TB written in 24h. NVMe wear is at 14% used, 100% spare — not a crisis yet, but a sustained write rate of >2 TB/day will eat the warranty. Identify the writer (likely Prometheus TSDB compaction, ZFS scrub, or Bugsink ingest before it OOM'd).
- **`home-zwave-js-ui` namespace alerts are expected WIP noise.** `KubePodNotReady`, `KubeDeploymentReplicasMismatch`, `KubeDeploymentRolloutStuck`, `HomeAssistantEntitiesUnavailable` will keep firing until the USB hostPath is wired. Ignore as cluster signal — track via the WIP itself.

## Application Health Matrix

60 ArgoCD apps in the `argocd` namespace. Matrix matches live count.

| App                            | Namespace                      | Status | Evidence                                                                                                                                                                     | Notes                                                               |
| ------------------------------ | ------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `1password`                    | `1password`                    | 🟢     | onepassword-connect 1/1, operator 1/1 Running 11d                                                                                                                            | —                                                                   |
| `apps`                         | `argocd`                       | 🟡     | OutOfSync/Healthy; ignoreDifferences drift on 3 Minecraft Apps + TunnelBinding mutation                                                                                      | Cosmetic; Auto-sync ON                                              |
| `argocd`                       | `argocd`                       | 🟢     | controller, redis, repo, server, dex, applicationset, notifications all 1/1 Running                                                                                          | —                                                                   |
| `birmel`                       | `birmel`                       | 🟢     | birmel 1/1 Running 9h, 0 restarts; ts-birmel-oauth ingress 1/1                                                                                                               | —                                                                   |
| `blackbox-exporter`            | `prometheus`                   | 🟢     | blackbox-exporter 1/1 Running                                                                                                                                                | —                                                                   |
| `bugsink`                      | `bugsink`                      | 🔴     | Pods Running, but PVC `pgdata-bugsink-postgresql-0` 100%; API hard-500; 5 storage alerts firing                                                                              | **Critical #1** — expand PVC + retention policy                     |
| `buildkite`                    | `buildkite`                    | 🟢     | buildkite-agent-stack-k8s 1/1 Running 11d; controller 1 restart 14h ago                                                                                                      | —                                                                   |
| `cert-manager`                 | `cert-manager`                 | 🟢     | controller, cainjector, webhook all 1/1 Running                                                                                                                              | —                                                                   |
| `chartmuseum`                  | `chartmuseum`                  | 🟢     | chartmuseum 1/1 Running; ts-apps-chartmuseum-ingress 1/1                                                                                                                     | —                                                                   |
| `cloudflare-operator`          | `cloudflare-operator-system`   | 🟢     | controller-manager 1/1 Running 11d (5 restarts in 14h, normal leader churn)                                                                                                  | —                                                                   |
| `cloudflare-tunnel`            | `cloudflare-tunnel`            | 🟢     | homelab-tunnel-… 1/1 Running 2d21h (operator ns by design)                                                                                                                   | —                                                                   |
| `dagger`                       | `dagger`                       | 🟢     | dagger-helm-engine-0 1/1 Running 11d                                                                                                                                         | —                                                                   |
| `ddns`                         | `ddns`                         | 🟢     | ddns 1/1 Running 30d (8 restarts/30d)                                                                                                                                        | No native metrics                                                   |
| `freshrss`                     | `freshrss`                     | 🟢     | freshrss 1/1; ts-freshrss-ingress 1/1                                                                                                                                        | No native metrics                                                   |
| `gickup`                       | `gickup`                       | 🟢     | gickup 1/1 Running 11d; no Gitckup\* alerts                                                                                                                                  | —                                                                   |
| `golink`                       | `golink`                       | 🟢     | golink 1/1 Running                                                                                                                                                           | Temporal `golink-sync` failed once 24h (transient)                  |
| `grafana`                      | `prometheus`                   | 🟢     | prometheus-grafana-0 3/3, image-renderer 1/1; ts-apps-grafana-ingress 1/1                                                                                                    | —                                                                   |
| `grafana-db`                   | `prometheus`                   | 🟢     | grafana-postgresql-0 1/1 Running 11d                                                                                                                                         | —                                                                   |
| `home`                         | `home`                         | 🟡     | Synced/Degraded; `home-zwave-js-ui` 0/1 (WIP — TODO USB hostPath placeholder); 4 namespace alerts firing as expected                                                         | Known WIP — ignore until USB path wired                             |
| `intel-device-plugin-operator` | `intel-device-plugin-operator` | 🟢     | inteldeviceplugins-controller-manager 1/1 Running                                                                                                                            | —                                                                   |
| `intel-gpu-device-plugin`      | `intel-device-plugin-operator` | 🟢     | intel-gpu-plugin DaemonSet 1/1 Running                                                                                                                                       | —                                                                   |
| `kueue`                        | `kueue-system`                 | 🟢     | kueue-controller-manager 1/1 Running                                                                                                                                         | —                                                                   |
| `kyverno`                      | `kyverno`                      | 🟢     | admission, background, cleanup, reports controllers all 1/1                                                                                                                  | —                                                                   |
| `kyverno-policies`             | `kyverno-policies`             | 🟢     | ClusterPolicy CRs only, no workloads                                                                                                                                         | —                                                                   |
| `loki`                         | `loki`                         | 🟢     | loki-0 2/2, gateway 1/1, canary DS 1/1, chunks-cache 2/2, results-cache 2/2                                                                                                  | —                                                                   |
| `mc-router`                    | `mc-router`                    | 🟢     | mc-router 1/1 Running                                                                                                                                                        | —                                                                   |
| `mcp-gateway`                  | `mcp-gateway`                  | 🟢     | mcp-gateway 1/1 Running; ts-mcp-gateway ingress 1/1                                                                                                                          | No native metrics                                                   |
| `media`                        | `media`                        | 🟡     | All 11 \*arr/Plex deployments healthy; `media-plex-64cfdc584d-8r82k` orphan pod stuck `UnexpectedAdmissionError` 11d                                                         | `kubectl delete pod` clears                                         |
| `minecraft-allofcreate`        | `minecraft-allofcreate`        | 🟢     | StatefulSet 0/0 (idle by design)                                                                                                                                             | Idle                                                                |
| `minecraft-allthemons`         | `minecraft-allthemons`         | 🟢     | StatefulSet 0/0 (idle by design)                                                                                                                                             | Idle                                                                |
| `minecraft-bettermc`           | `minecraft-bettermc`           | 🟢     | StatefulSet 0/0 (idle by design)                                                                                                                                             | Idle                                                                |
| `minecraft-ftbskies2`          | `minecraft-ftbskies2`          | 🟢     | StatefulSet 0/0 (idle by design)                                                                                                                                             | Idle                                                                |
| `minecraft-shuxin`             | `minecraft-shuxin`             | 🟢     | StatefulSet 0/0; ts-apps-minecraft-shuxin-bluemap-ingress 1/1                                                                                                                | Idle                                                                |
| `minecraft-sjerred`            | `minecraft-sjerred`            | 🟢     | StatefulSet 0/0; ts-apps-minecraft-sjerred-bluemap-ingress 1/1                                                                                                               | Idle                                                                |
| `minecraft-stoneblock4`        | `minecraft-stoneblock4`        | 🟢     | StatefulSet 0/0 (idle by design)                                                                                                                                             | Idle                                                                |
| `minecraft-tsmc`               | `minecraft-tsmc`               | 🟢     | StatefulSet 0/0; ts-apps-minecraft-tsmc-bluemap-ingress 1/1                                                                                                                  | Idle                                                                |
| `nfd`                          | `node-feature-discovery`       | 🟢     | nfd master 1/1, gc 1/1, worker DS 1/1                                                                                                                                        | —                                                                   |
| `openebs`                      | `openebs`                      | 🟡     | localpv-provisioner 1/1 (11 restarts, last 9h ago); zfs-localpv-controller 5/5; node DS 2/2                                                                                  | Investigate provisioner crash logs                                  |
| `plausible`                    | `plausible`                    | 🟡     | plausible 1/1 (4 restarts 14h), clickhouse 1/1, postgresql 1/1; KubePdbNotEnoughHealthyPods                                                                                  | PDB structural (1-replica)                                          |
| `pokemon`                      | `pokemon`                      | 🟢     | Deployment desired=0; ts-pokemon-{selkies,ui} ingress 1/1                                                                                                                    | Idle                                                                |
| `postal`                       | `postal`                       | 🟢     | postal-postal-{smtp,web} 1/1, worker 2/2 Running 13d; ts-postal-postal-ingress 1/1                                                                                           | —                                                                   |
| `postal-mariadb`               | `postal`                       | 🟢     | postal-mariadb-0 2/2 Running 11d                                                                                                                                             | —                                                                   |
| `postgres-operator`            | `postgres-operator`            | 🟢     | postgres-operator 1/1 Running 13d                                                                                                                                            | —                                                                   |
| `prometheus`                   | `prometheus`                   | 🟡     | All control-plane pods Running; R2StorageExceedingLimit + R2StorageNearingLimit + SustainedDiskWriteActivity + PDB                                                           | Capacity & structural; functional                                   |
| `prometheus-adapter`           | `prometheus`                   | 🟢     | prometheus-adapter 1/1 Running                                                                                                                                               | —                                                                   |
| `promtail`                     | `promtail`                     | 🟢     | promtail DS 1/1 Running                                                                                                                                                      | —                                                                   |
| `redlib`                       | `redlib`                       | 🟡     | redlib 1/1 Running; **171 restarts** (last 13h ago); ts-redlib ingress 1/1                                                                                                   | Upstream Reddit rate-limit churn                                    |
| `s3-static-sites`              | `s3-static-sites`              | 🟢     | s3-static-sites 1/1 Running 9h, 0 restarts; no StaticSite\* alerts                                                                                                           | —                                                                   |
| `scout-beta`                   | `scout-beta`                   | 🟢     | scout-beta-scout-backend 1/1 Running 9h, 0 restarts                                                                                                                          | —                                                                   |
| `scout-prod`                   | `scout-prod`                   | 🟡     | scout-prod-scout-backend 1/1 Running 12h, 0 restarts; **ScoutRiotApiErrorRateHigh** firing                                                                                   | App healthy; investigate Riot API key/region                        |
| `seaweedfs`                    | `seaweedfs`                    | 🟢     | master-0, volume-0, filer-0, s3 deploy all 1/1 Running                                                                                                                       | —                                                                   |
| `starlight-karma-bot-beta`     | `starlight-karma-bot-beta`     | 🟢     | bot 1/1 Running 9h, 0 restarts                                                                                                                                               | No native metrics                                                   |
| `starlight-karma-bot-prod`     | `starlight-karma-bot-prod`     | 🟢     | bot 1/1 Running 12d (2 restarts)                                                                                                                                             | No native metrics                                                   |
| `status-page`                  | `status-page`                  | 🟢     | status-page 1/1 Running 13d                                                                                                                                                  | No native metrics                                                   |
| `syncthing`                    | `syncthing`                    | 🟢     | syncthing 1/1 Running 9d; ts-syncthing ingress 1/1                                                                                                                           | No native metrics                                                   |
| `tailscale`                    | `tailscale`                    | 🟢     | operator 1/1 Running 11d; **all 35 ts-\*-ingress-\*-0 proxies Ready**                                                                                                        | —                                                                   |
| `tasknotes`                    | `tasknotes`                    | 🟢     | tasknotes 2/2 Running 9h, 0 restarts; ts-tasknotes-ingress 1/1                                                                                                               | —                                                                   |
| `tempo`                        | `tempo`                        | 🟢     | tempo-0 1/1 Running 2d9h                                                                                                                                                     | —                                                                   |
| `temporal`                     | `temporal`                     | 🟡     | server, ui, worker, postgresql all 1/1; **TemporalServerMetricsDown + TemporalWorkerMetricsDown + PdbNotEnoughHealthyPods** firing; 12 failed + 1 timed-out workflows in 24h | ServiceMonitor selector stale; PDB structural; workflow regressions |
| `velero`                       | `velero`                       | 🟢     | velero 1/1 Running 11d; weekly backup PartiallyFailed (qbittorrent-pvc S3 sig)                                                                                               | Re-run weekly ad-hoc                                                |

**Summary:** 1 Red, 9 Yellow, 50 Green. Row count = 60 (matches live `applications.argoproj.io`). The kubeconfig cert (Critical #2) is not a workload, so it doesn't appear in this matrix.

## CI on `main` and Open PRs

- **`main` is green.** Latest build #1528 passed in ~17m (image bump 2.0.0-1518). Three failed builds in the 24h window (1437, 1447, 1448) all stem from the same merge of PR #653 and only failed soft jobs (Knip, Trivy, ArgoCD-Healthy, Version Commit-Back). 0 running, 0 scheduled. 0 connected agents (idle queue).
- **10 open PRs**, 0 stale, 0 conflicts (PR #624 mergeable=UNKNOWN — release-please bot still computing). 6 Renovate PRs failing CI, almost entirely on `renovate/artifacts` (Renovate-internal step) for #619/#611/#608/#626. PR #621 (TypeScript v6) has 20/40 checks failing — broad upstream-blocked breakage; keep open per `feedback_never_silence_renovate`. PR #623 (Zod v4) has 3/25 failing.

## Cross-Validation Highlights

- **ArgoCD vs. pods:** `argocd/home` reports Degraded; live pod is Pending. Agree — this is the expected state during the zwave-js-ui WIP.
- **ArgoCD vs. pods:** `argocd/bugsink` reports Synced/Healthy; pods are Running but Postgres is wedged on a full PVC. **Disagrees** — ArgoCD's health model does not see PVC saturation; the row-specific check in the runbook caught it.
- **Prometheus vs. PD:** 17 of 19 PD incidents have a matching firing Prometheus alert. The two without (#4235 Velero backup item errors, #4248 Released PVs accumulating) are filed via Velero/Argo non-Prometheus paths.
- **`up == 0` vs. `TemporalServerMetricsDown`:** `up == 0` is empty across the cluster, yet TemporalServerMetricsDown is firing — the temporal scrape target is _absent_ rather than failing, i.e. the ServiceMonitor selector is stale, not that the endpoint is down. Treat as observability gap.
- **Bugsink releases vs. deploys:** Cannot evaluate this cycle because the Bugsink API is offline. Re-check at next audit.
- **Application Health row count:** 60 (matches `kubectl get applications.argoproj.io -n argocd | jq '.items | length'`).
- **App-specific alerts vs. matrix rows:** All firing app-specific alerts (`Bugsink*`, `Scout*`, `KubePodNotReady` for `home/zwave-js-ui`) produce Yellow/Red rows. No silent gaps.

## What's Working Well

- **Core platform:** ArgoCD, cert-manager, cloudflare-operator/tunnel, kueue, kyverno, postgres-operator, 1Password, Dagger, Velero, OpenEBS — all green and Running.
- **Observability tier (mostly):** Loki, Tempo, Promtail, Grafana, blackbox-exporter, prometheus-adapter all healthy. Only the `prometheus` umbrella is Yellow on capacity/PDB.
- **Storage & data:** SeaweedFS (4 pods), postal-mariadb, plausible-postgresql, temporal-postgresql, grafana-postgresql all running. Velero 6-hourly cadence is intact (latest 4h ago, 0 errors). 4-week weekly backup history shows only 1 PartiallyFailed run.
- **Tailscale ingress fabric:** 36/36 pods Ready (1 operator + 35 service ingresses) including the new `ts-home-zwave-js-ui-tailscale-ingress` that came up cleanly even though its backend is broken. Cert-manager: 3/3 certificates `Ready=True`, none expiring within 14 days.
- **Talos node:** All 17 readiness gates OK, etcd healthy, kubelet healthy, control-plane up 350d, 0 hardware errors in dmesg, 0 NVMe/ATA/MCE/ZFS errors. NVMe wear at 14% used / 100% spare, controller 46–49 °C.
- **CI:** `main` is green, latest build passed in 17m, no in-flight queue, no stale PRs, all open PRs &lt;24h old.
- **Idle-by-design clusters:** All 8 Minecraft StatefulSets at 0/0 + Pokemon Deployment at 0/0; mc-router proxies wake-on-connect; Bluemap ingresses up for shuxin / sjerred / tsmc.
- **Watchdog → Alertmanager → PagerDuty pipeline healthy** end-to-end (Watchdog firing, all expected alerts mirrored to PD).
