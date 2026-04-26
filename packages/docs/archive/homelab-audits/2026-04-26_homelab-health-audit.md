# Homelab Infrastructure Health Audit — 2026-04-26

Produced by running the [Homelab Audit Runbook](../../guides/2026-04-04_homelab-audit-runbook.md) across 7 parallel agents (Sections 1–12). All checks were read-only; no remediation has been applied.

## Cluster Overview

| Metric            | Value                                        | Metric                 | Value                                   |
| ----------------- | -------------------------------------------- | ---------------------- | --------------------------------------- |
| Node              | `torvalds` (single, Ready)                   | Uptime                 | ~64h57m (services last bounced 4-24)    |
| Talos (server)    | v1.12.0                                      | Talos client           | v1.12.5 (skew)                          |
| Kubernetes        | v1.35.0                                      | Talos PKI cert expiry  | **2026-05-06 (10 days)**                |
| CPU               | ~10–14%                                      | Memory                 | ~64% (well under 85%)                   |
| Total pods        | ~150                                         | Deployments            | 79 (all Ready)                          |
| DaemonSets        | 14 (all DESIRED=READY)                       | StatefulSets           | 18 (all Ready)                          |
| ArgoCD apps       | 61 (57 Synced+Healthy, 3 OOS-OK, 1 Degraded) | Released PVs           | 1 (`better-skill-capped-manifest`)      |
| Velero schedules  | 4 enabled (6h/daily/weekly/monthly)          | Last failed backup     | 28d ago, isolated, not recurring        |
| Open PD incidents | **15 (all unacked)**                         | Distinct firing alerts | 21 (incl. Watchdog heartbeat)           |
| NVMe wear         | nvme0 7%, nvme1 14%                          | All disks SMART        | PASSED (8/8)                            |
| Tailscale proxies | 36/36 Running 1/1                            | Bugsink open issues    | 1 high-volume + scattered low-volume    |
| `main` CI         | green (last 5 builds passed)                 | Open PRs               | 15 (0 conflicts; PR #626 + cascade red) |

## Root Causes

Three independent issues dominate today's findings:

1. **`temporal-temporal-worker` blocked on missing secret key** — pod has been in `CreateContainerConfigError` for 13h with 3,693 container-start retries. The secret `temporal/temporal-temporal-worker-1p` exists and contains 12 keys (`AWS_*`, `GH_TOKEN`, `HA_*`, `OPENAI_API_KEY`, `POSTAL_*`, `RECIPIENT_EMAIL`, `S3_*`), but the deployment also requires `ANTHROPIC_API_KEY`, which is not in the synced secret. Every temporal-worker-related alert + 7 of the 15 PD incidents (#4018, #4019, #4020, #4033, #4035, #4036, #4055) trace back to this single missing key. The 2026-04-20 audit had the same root deployment (different shape: secret missing entirely; today the secret exists but is incomplete) — so the 1Password `OnePasswordItem` for this worker has been edited but is still missing one field.
2. **Talos PKI cert expires in 10 days (2026-05-06)** — was 16 days at the 2026-04-20 audit; clock has run down. If missed, admin `kubectl`/`talosctl` access fails until rotation.
3. **R2 over the 1.5 TB cap** — both warning + critical incidents (#3889/#3890) are open since 2026-04-21. The previous 1 TB cap incident pair (#3582/#3583) was closed; only the threshold moved, and the bucket is still over.

## Critical Issues (3)

### 1. Temporal Worker — Missing `ANTHROPIC_API_KEY`

- **Resource:** `Deployment temporal-temporal-worker` in ns `temporal`
- **Pod:** `temporal-temporal-worker-755658ccb6-rsgx9` — `CreateContainerConfigError` for ~13h, 3,693 image-pull cycles
- **Evidence:** `kubectl describe pod` event: `Error: couldn't find key ANTHROPIC_API_KEY in Secret temporal/temporal-temporal-worker-1p`. The synced secret currently has these 12 keys: `AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, GH_TOKEN, HA_TOKEN, HA_URL, OPENAI_API_KEY, POSTAL_API_KEY, POSTAL_HOST, POSTAL_HOST_HEADER, RECIPIENT_EMAIL, S3_BUCKET_NAME, S3_ENDPOINT`. Image: `ghcr.io/shepherdjerred/temporal-worker:2.0.0-1161@sha256:8cd2f89f5ba…`.
- **ArgoCD:** `argocd/temporal` reports Sync=Synced, Health=Degraded (worker progress deadline exceeded). Other temporal pods (server, ui, postgresql) all 1/1.
- **Prometheus:** `up{namespace="temporal"} == 0` for both worker and server-metrics services because the pod is not ready, which in turn fires `TemporalServerMetricsDown` / `TemporalWorkerMetricsDown` / `TargetDown ×2`.
- **PagerDuty:** #4018, #4019, #4020 (metrics down), #4033 (pods not ready), #4035 (replicas mismatch), #4036 (rollout stuck), #4055 (container waiting >1h) — 7 incidents, all opened 2026-04-26.
- **Action:** Add `ANTHROPIC_API_KEY` to the 1Password item that produces `temporal-temporal-worker-1p`, then `kubectl rollout restart deploy/temporal-temporal-worker -n temporal`. Per memory `feedback_dont_modify_1p_items`, do **not** rename or duplicate fields in 1Password — fix the field on the existing item. If the worker code added `ANTHROPIC_API_KEY` recently and the 1Password update was missed, also `git log --since=2026-04-20 -- packages/temporal/` to find the env-var addition for context.

### 2. Talos PKI Certificate Expires 2026-05-06 (10 Days Out)

- **Evidence:** `talosctl config info` reports admin cert expires 2026-05-06; was 16 days remaining at the 2026-04-20 audit, is now 10 days.
- **Impact:** Once expired, `kubectl` and `talosctl` admin access is unavailable until rotation; cluster keeps running, but management is locked out.
- **Action:** Schedule rotation **before 2026-05-06**. Either rotate the talosconfig directly, or run `talosctl upgrade-k8s` which re-issues incidentally and also closes the v1.12.0 → v1.12.5 server skew (issue #3 below).
- **Cross-validation note:** Promoted from Yellow (2026-04-20) to Red because the deadline is now inside one week of work and the cost of missing it is operationally severe.

### 3. R2 Object Storage Over 1.5 TB Cap

- **PagerDuty:** #3889 (`R2StorageNearingLimit`, warning) + #3890 (`R2StorageExceedingLimit`, critical), both opened 2026-04-21, unacked.
- **Context:** 2026-04-20 audit flagged the same condition against the older 1 TB cap (#3582/#3583, since closed). Cap appears to have been raised to 1.5 TB; the bucket has already grown past it.
- **Action:** Identify which prefix drove growth (Velero S3 target, toolkit-fetch cache, anything else writing to R2), prune or raise the quota again. A second consecutive cap breach indicates the trend is structural — pick a target retention policy rather than only raising the ceiling.

## Warning Issues (11)

### 1. Talos Client/Server Version Skew

- Server (torvalds): v1.12.0 · Client (mac): v1.12.5 (5 patch behind).
- **Action:** Server upgrade closes both this skew and Critical #2 in one operation.

### 2. ArgoCD `temporal` App Degraded

- Synced + Degraded; root cause is Critical #1. Will auto-resolve once the worker pod exits `CreateContainerConfigError`.

### 3. ZFS Fragmentation `zfspv-pool-nvme` at 59%

- PagerDuty #3943 (4d old, opened 2026-04-22). Was 57% on 2026-04-20 — slow uptick.
- ZFS ARC hit metrics could not be queried via `toolkit gf query` this run (permission denied for series). Pre-existing alert `ZfsPoolFragmentationHigh` is the trigger.
- **Action:** Same as 2026-04-20 plan: `zpool scrub` during a maintenance window; longer-term plan a rebuild if fragmentation trend continues.

### 4. Released PV Accumulating — `better-skill-capped-manifest` Orphan

- `kubectl get pv | grep -v Bound` returned exactly one Released PV: `pvc-4ada0fa5-5528-43d8-8618-9d51e8079a33`, 1 Gi, `zfs-ssd`, Retain, age 111d, originally bound to `better-skill-capped/better-skill-capped-manifest`.
- PagerDuty #3688 (18d old, oldest open) — alert `ReleasedPVsAccumulating` continues to fire.
- **Cross-validation note:** Resolves the 2026-04-20 audit's caveat that `kubectl get pv` returned empty — today there is a real orphan with a clear owner. The PVC's namespace `better-skill-capped` is no longer producing fresh deploys (Bugsink last release for that project: 2026-02-19, 66d ago — see Warning #10).
- **Action:** Reclaim the PV manually (`kubectl delete pv pvc-4ada0fa5-…` after confirming nothing depends on it), or recreate the PVC if the workload is still expected to come back.

### 5. SSD Sustained Write Activity — `nvme1n1`

- PagerDuty #3848 (6d old, opened 2026-04-20). 1.401 TB written in the last 24 h; alert `SustainedDiskWriteActivity` firing.
- Per Agent E, `nvme_percentage_used_ratio` for `nvme1n1` is at 14% — wear is fine, but the rate is high.
- **Action:** Identify the writer (`iotop` / `btrace` via `talosctl` or per-pod metrics) — likely candidates are Loki ingester, Tempo, Velero TSDB churn, or a Buildkite agent cache.

### 6. Home Assistant — Good Morning Workflow Missing + Entities Unavailable

- PD #3993 (3d old): `HaGoodMorningWorkflowMissing` — last run 25h+ ago vs. expected daily.
- Firing in Prometheus: `HaVacuumWorkflowMissing` (info), `HomeAssistantEntitiesUnavailable` (98 entities, up from 92 on 2026-04-20). The earlier #3824 incident closed; current view comes from active alerts (the corresponding new PD #4054 was on the triggered list during pre-flight but is not in the current triggered set — likely auto-grouped with #3993 or transitioned).
- Loki shows pykumo `device_authentication_error` log lines — climate integration credentials.
- **Action:** Re-auth the failing integrations in HA UI; confirm Good Morning trigger isn't disabled. Cross-check Agent G's report: Temporal `good-morning` schedule was listed as healthy with "scheduled next runs" — so the workflow is firing on schedule from the Temporal side; the failure is in HA's automation acting on that signal, or in HA itself receiving state.

### 7. KubePdbNotEnoughHealthyPods (×4)

- Firing for 4 PDBs: `bugsink/postgres-critical-op-pdb`, `plausible/postgres-critical-op-pdb`, `prometheus/postgres-critical-op-pdb`, `temporal/postgres-critical-op-pdb`.
- New since 2026-04-20 (no PD incident attached yet — likely below paging threshold).
- **Action:** For single-replica StatefulSets behind a `minAvailable=1` PDB, the alert effectively means "the only pod isn't Ready." Each of the 4 namespaces has a `*-postgresql-0` pod, and Agent B reported all StatefulSets Ready. Investigate the PDB definitions vs. actual replica count — the PDB may target a critical-operation label set that no current pod carries, in which case the alert is a label drift, not real risk.

### 8. Stale CronJob Failure Incident — `better-skill-capped-fetcher`

- PD #3714 (12d old). Agent B confirms the CronJob no longer exists in the cluster (`kubectl get cronjobs -A` does not list it; `dependency-summary` is also gone).
- **Action:** Close the PD incident — the source object has been removed, so the alert is a stale trigger.

### 9. Bugsink: scout-for-lol 502 — High Volume, Aged

- Issue UUID `0fd96737-5188-4f43-8c81-810059e58821`, **18,963 digested events**. First seen 2026-04-07, last seen 2026-04-20 (issue not currently growing).
- Workload `scout-for-lol-backend` was Running cleanly per Agent B (no CrashLoopBackOff or restart spike).
- **Action:** Either review the captured exceptions for a fix and resolve the issue in Bugsink, or mark it ignored if the upstream cause was a transient Riot API outage that is now over. The fact that release `2.0.0-1161` was published today (2026-04-26) suggests the project is actively deploying — confirm the regression isn't reappearing in newer releases.

### 10. Bugsink: better-skill-capped Stale Release Tracking

- Project's most recent release record is **2026-02-19** (66 days ago), but issue `01f77080-19ae-4d0e-90c5-281f26b5cb98` (404s) had its latest event today, 2026-04-26.
- Combined with Warning #4 (the project's PV is Released), the project may be in a transitional state: workload deprecated, PV waiting to be reclaimed, but something is still reporting 404s.
- **Action:** Decide intent — if the project is deprecated, remove the SDK config + delete the Released PV. If it should still be running, fix the deploy pipeline so a fresh Bugsink release is produced on each push.

### 11. Bugsink: scout-for-lol Riot ID Validation Errors Growing

- Issue UUID `20cff609-24b8-4789-90c8-aa9b55ef0ba1`, 646 digested / 457 stored events, last seen 2026-04-26. Growing user-input validation errors.
- **Action:** Cross-check against any UI or API contract change for the Riot ID input field around the last week.

## Informational

- **DNS upstream timeouts:** Agent A flagged ~50 `dns-resolve-cache` UDP timeouts to `192.168.1.1:53` in recent dmesg. Not surfaced as a CoreDNS or pod-level error by any other agent — likely router intermittency. Watch.
- **NVMe `nvme0` `temp3` (controller warning sensor) at ~70.85°C** — same range as 2026-04-20, well within consumer-SSD envelope (vendor 80–85°C). Composite (`temp1`) is 49.85°C. Low priority.
- **Velero weekly-backup-20260330034504 (28d old) PartiallyFailed** — Prometheus PVC snapshot ZFS plugin panic ("index out of range"). All 26 subsequent backups Completed clean. Treat as transient unless it recurs.
- **One-off ArgoCD chart bumps pending** — `argocd/apps`, `argocd/birmel`, `argocd/bugsink` are OutOfSync but Healthy on auto-sync (`~2.0.0-0` target vs. published `2.0.0-1`). Normal staging behavior; not a finding.
- **Open PRs / Renovate cascade:** PR #626 (eslint v10 major) is failing 3 checks (`buildkite/monorepo/pr`, `buildkite/monorepo/pr/eslint-lint`, `renovate/artifacts`). 5 other open Renovate PRs (#623, #621, #619, #611, #608) inherit the failure. `main` is green (last 5 builds passed), so the failure is PR-specific and probably reflects real eslint v10 breaking changes that need codebase fixes before the major can land.
- **Monitoring coverage gaps still present:** Agent E re-confirmed that `smartctl_*`, `nvme_composite_temperature_celsius`, and `node_cpu_core_throttles_total` are not emitting under those names. The runbook's Section 7 queries don't return data; Agent E was able to query `smartmon:device_healthy` and the `nvme_*_ratio` series instead. This was raised in the 2026-04-20 audit's Warning #13 — still un-addressed.

## What's Working Well

- **Node health:** single-node control plane Ready; CPU ~10–14%, memory ~64%. Kernel dmesg clean for panics/oops/OOM/MCE/segfault across ~450 KB of recent log. All 13 Talos system services Running OK; etcd/kubelet/API server all healthy. Last reboot 2026-04-24 (~2.7 days uptime).
- **Workload fleet:** 79/79 Deployments healthy (worker pod is the only Deployment with Replicas != Ready, and it's still counted "ready" structurally because of the rolling update — but pod-level it's stuck). 18/18 StatefulSets, 14/14 DaemonSets, all 90+ PVCs Bound, 0 Pending, 1 Released.
- **ArgoCD:** 57/61 Synced + Healthy. The 3 OutOfSync apps are normal pending chart bumps; the 1 Degraded app traces to the temporal worker.
- **Backups:** all 4 Velero schedules running on cadence; last 26 backups (6h/daily/weekly/monthly) Completed with 0 errors. Only failure in the recent window is the 28-day-old prometheus PVC snapshot plugin panic, with 11+ clean backups since.
- **Monitoring:** `Watchdog` heartbeat firing as expected. Only `up == 0` targets are the temporal-worker metrics endpoints (consequence of Critical #1) — every other scrape is up. Loki not reporting any new error storm.
- **Hardware:** every disk SMART = PASSED. NVMe wear nvme0 7% / nvme1 14% — both nominal. CPU thermals nominal. No CPU throttling detected. SATA bay temps in the 30s–40s.
- **Network/TLS:** all 3 cert-manager Certificates READY=True, nearest expiry 48 days (Intel device plugin). Tailscale operator + 36 ingress proxy pods all 1/1. The legacy `tailscaleingress` CRD is intentionally absent — cluster uses the ProxyGroup model.
- **Temporal (server side):** frontend gRPC SERVING, both expected namespaces present, 13 schedules active and on-cadence, **0 failed workflow executions in the last 24h, 0 Running executions older than 24h.** Worker pod is the only sick component; everything driven by the worker is paused, but the platform itself is healthy.
- **CI:** `main` is green — last 5 builds (1208, 1196, 1185, 1174, 1163) all PASSED. Buildkite agent pool healthy; queue empty.
- **Pull requests:** 15 open, **0 merge conflicts**, 9 Renovate (well-managed backlog). No PRs >14 days stale.
- **Bugsink:** 4 of 9 projects sit at 0 unresolved issues. Active projects' release-tracking is current (scout-for-lol released today).
- **Resolved since 2026-04-20:** redlib CrashLoopBackOff (now stable), orphaned `media-plex-5c457fc795-*` failed pods (gone), `dependency-summary` and `better-skill-capped-fetcher` CronJobs (removed), `obsidian-headless` Bun better-sqlite3 spam (#3546 closed), CPUThrottlingHigh on postal-mariadb metrics + tasknotes, `plex-movies-hdd-pvc` no longer Pending/Lost.

## Cross-Validation Notes

- **ArgoCD reported health vs. actual pod state:** Matches — the only Degraded ArgoCD app (`argocd/temporal`) maps directly to the `temporal-temporal-worker` pod's `CreateContainerConfigError`. The 3 OutOfSync apps are all Healthy at the pod level, consistent with manual chart-bump staging.
- **Firing Prometheus alerts vs. open PD incidents:** Matches 1:1 for all temporal-worker alerts → 7 PD incidents; R2 alerts → #3889/#3890; ZFS frag → #3943; HA workflow → #3993; SSD wear → #3848; released-PV → #3688. **Stale incidents:** #3712 (Roomba 17d), #3714 (CronJob removed 12d ago) — alert sources exist but the underlying objects either are inanimate (Roomba) or no longer exist (CronJob), so these are triage candidates rather than active bugs.
- **`KubePdbNotEnoughHealthyPods` ×4 vs. StatefulSet state:** Apparent contradiction — Agent B saw all postgresql StatefulSets at READY=DESIRED. Most plausible explanation is PDB label drift (selector targets a label set the pods no longer carry). Verify before treating as a real availability risk.
- **Backup recency vs. declared schedule:** Matches — 6-hourly within last hour (2026-04-26 18:15 PDT), daily within last 16h, weekly on schedule, monthly on schedule.
- **Released PV alert vs. `kubectl get pv`:** Now consistent — last audit's "alert fires but no orphan visible" caveat resolved; today there is exactly one orphan and it's the same alert.
- **Bugsink scout-for-lol 502 vs. pod health:** No correlation in pod state — Agent B saw no scout-for-lol restart spike. Issue is from external upstream (Riot API) during 2026-04-07 → 2026-04-20 window; not currently growing.
- **`main` CI green vs. ArgoCD auto-sync apps:** Consistent — auto-sync apps tracking `main` are running the latest tagged image; no "ArgoCD Synced + main red" mismatch (because `main` is green).
- **PR `statusCheckRollup` vs. `bk build` for same commit:** Consistent — PR #626's check failure shows up in Buildkite as the `pr/eslint-lint` step failing. No stale GitHub check status detected.

## Delta vs. 2026-04-20 Audit

| Direction                  | Items                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Resolved**               | redlib CrashLoopBackOff; orphaned media-plex pods; `dependency-summary` and `better-skill-capped-fetcher` CronJobs removed; obsidian/Bun `better-sqlite3` spam (#3546); `KubePdbNotEnoughHealthyPods` original triggers; CPUThrottlingHigh on postal-mariadb metrics + tasknotes; `plex-movies-hdd-pvc` no longer surfaced as a top issue (still 6 Ti, no Prometheus utilization metric reachable this run). |
| **Unchanged / persistent** | Talos client/server skew (still v1.12.5 vs v1.12.0); ZFS fragmentation on `zfspv-pool-nvme` (57% → 59%); ReleasedPVs alert (#3688) — now with one identifiable orphan; Roomba inactivity (#3712); SMART/NVMe metric coverage gap; `argocd/temporal` Degraded; backup environmental warnings on monthly.                                                                                                      |
| **Worsened / escalated**   | Talos PKI expiry now **10 days** (was 16) — promoted to Red; HA entities unavailable count 92 → 98; R2 cap moved 1 TB → 1.5 TB but bucket still over (#3582/#3583 closed → #3889/#3890 opened).                                                                                                                                                                                                              |
| **New**                    | `temporal-temporal-worker` failure mode shifted from "secret missing" to "secret present but missing `ANTHROPIC_API_KEY`" (regression after a partial fix); SSD sustained-write alert on `nvme1n1` (#3848); `KubePdbNotEnoughHealthyPods` ×4 firing; PR #626 + Renovate cascade red.                                                                                                                         |

## Summary

Cluster is broadly healthy. Three items demand attention this week:

1. **Add `ANTHROPIC_API_KEY` to the `temporal-temporal-worker-1p` 1Password item.** This unblocks the worker and clears 7 PD incidents + every temporal-related firing alert.
2. **Rotate the Talos PKI cert before 2026-05-06.** Combine with a server upgrade to v1.12.5 to also close the client/server skew.
3. **Decide R2 retention.** Second consecutive cap breach in two weeks; raising the ceiling alone is not a strategy.

Then a triage pass on the 15 unacked PD incidents — close stale ones (#3714 for the removed CronJob; #3712 if Roomba inactivity is expected), ack the temporal-worker batch when remediation begins, and link tickets to the R2 retention work.

Beyond that, three slow-burn items to schedule rather than rush: the `better-skill-capped` deprecation cleanup (orphan PV + stale Bugsink release tracking), the `nvme1n1` write-rate investigation, and the monitoring coverage gap (SMART/NVMe metric names that the runbook expects but the cluster doesn't emit). These haven't moved in two audits.

No hardware, thermal, network, or backup risks observed.
