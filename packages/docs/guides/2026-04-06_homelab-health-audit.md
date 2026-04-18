# Homelab Health Audit — 2026-04-06

Comprehensive audit of the `torvalds` cluster using the [audit runbook](2026-04-04_homelab-audit-runbook.md). Run with 6 parallel agents covering Talos, K8s workloads, ArgoCD/storage, monitoring/alerts/PagerDuty, hardware/network, and Bugsink.

## Key Finding: Last Audit Fixes Not Deployed

All fixes from the [2026-04-05 audit](2026-04-05_homelab-health-audit-2.md) were committed (`be49fdd3`) and built into images (2.0.0-899), but the version bump PR (#532) was never merged. The cluster is still running 2.0.0-891. See [Is My Commit Deployed?](2026-04-06_is-commit-deployed.md) for the verification process.

## Issues Found: 8

### Red / Critical (4)

#### 1. Bugsink PostgreSQL — disk full (outage, now resolved)

- ZFS dataset quota was 8Gi but 50 Velero snapshots consumed 7.96G, leaving only 39M for actual data (665M)
- PostgreSQL entered `start failed` crash loop — all Bugsink API calls returned HTTP 500
- **Root cause:** Velero backup snapshots accumulating without retention policy pruning old ones
- **Fix applied:** Deleted 28 snapshots older than 2 weeks. Usage dropped from 95% → 18% (665M used, 3.2G available). PostgreSQL recovered automatically after API server restart.
- **Follow-up needed:** Configure Velero snapshot retention for bugsink PVC, or exclude it from backup (error events are replaceable)

#### 2. `argocd/apps` — OutOfSync + Degraded, SyncError on 2.0.0-899

- Root "app of apps" failing sync: `one or more synchronization tasks completed unsuccessfully`
- **Root cause:** Two one-shot Jobs (`dagger-zfs-tuning`, `docker-config-builder`) have `ttlSecondsAfterFinished: 86400`. After TTL cleanup, ArgoCD sees them as Missing/OutOfSync and fails the entire sync cascade.
- **Fix:** Added `argocd.argoproj.io/hook: Sync` and `argocd.argoproj.io/hook-delete-policy: BeforeHookCreation` annotations to both Jobs in `packages/homelab/src/cdk8s/src/resources/argo-applications/dagger.ts`
- Blocks: all downstream deployments including version bump PR

#### 3. Scout spectator validation — pre-match detection broken

- `ScoutRiotApiErrorRateHigh` alert firing with `source=spectator-validation`
- **Root cause:** Riot added two new undocumented fields (`riotId`, `lastSelectedSkinIndex`) to the Spectator V5 CurrentGameParticipant response. The Zod schema uses `.strict()` and rejects them.
- Errors every 30 seconds for every active player — pre-match game detection silently fails
- **Fix:** Added `riotId: z.string().optional()` and `lastSelectedSkinIndex: z.number().optional()` to `RawCurrentGameParticipantSchema` in `packages/scout-for-lol/packages/data/src/league/raw-current-game-info.schema.ts`

#### 4. starlight-karma-bot-beta + tasknotes — CrashLoopBackOff (same as last audit)

- starlight-karma-bot-beta: 303 restarts, broken 170+ days
- tasknotes: 281 restarts
- **Root cause:** Prisma `--skip-generate` flag removed in newer version. Fix was committed in `be49fdd3` but not deployed (version bump PR #532 not merged).

### Yellow / Warning (4)

#### 5. Talos `etcd-servers` extra arg rejected (now resolved)

- **New since last audit.** The `etcd-servers: https://127.0.0.1:2379` patch recommended last audit is not supported in Talos v1.12.0
- `ControlPlaneStaticPodController` failing every 1-2 minutes
- **Fix applied:** Removed `extraArgs` block from machine config via `talosctl edit machineconfig`. Errors stopped immediately.

#### 6. 23 unacknowledged PagerDuty incidents (oldest 24h+)

- Clusters: Bugsink PVC (5), TaskNotes (7), Starlight (2), Home Assistant (1), R2 storage (2), infrastructure (3), external sites (1), hardware (1), jobs (1)
- Zero notes on any incident

#### 7. R2 storage exceeding 1TB limit

- PagerDuty incidents #3582, #3583
- Needs investigation into which workload is writing to R2

#### 8. SMART/NVMe exporters not reporting

- `smartctl_device_smart_status`, `nvme_smart_log_percent_used` return empty
- The `2>/dev/null` removal from last audit hasn't deployed (blocked by version bump PR)

## What's Working Well

- **Thermals fixed!** CPU: 40-43°C idle / 71°C peak (was 100°C last audit). NVMe1: ~71°C max (was 105°C). Zero thermal throttling. Re-paste + heatsinks worked.
- **Node:** Ready, 10% CPU, 47% memory, Talos v1.12.0, kernel 6.18.1
- **ZFS:** ARC hit rate 99.68%, no pool errors
- **Networking:** 37 Tailscale proxies all healthy, 0 restarts. All 3 TLS certs valid.
- **Velero:** All 4 schedules active, recent backups succeeding
- **ArgoCD:** 58/61 apps synced + healthy
- **DaemonSets:** 13/13 all desired=current=ready
- **PVs/PVCs:** All 55 PVs bound, bugsink now at 18% after cleanup
- **Databases:** PostgreSQL, MariaDB, ClickHouse all healthy

## Code Changes

| File                                                                              | Change                                                         |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/scout-for-lol/packages/data/src/league/raw-current-game-info.schema.ts` | Add `riotId` and `lastSelectedSkinIndex` to participant schema |
| `packages/homelab/src/cdk8s/src/resources/argo-applications/dagger.ts`            | Add ArgoCD hook annotations to both one-shot Jobs              |
| `packages/docs/guides/2026-04-06_is-commit-deployed.md`                           | New guide: how to verify a commit is deployed                  |

## Runtime Fixes Applied

| Fix                             | Evidence                                     |
| ------------------------------- | -------------------------------------------- |
| Talos etcd-servers revert       | `talosctl dmesg` — no more controller errors |
| Bugsink ZFS snapshot cleanup    | `df -h` shows 18% usage (was 95%)            |
| Bugsink `data.failed/` deletion | Removed 40M of stale failed init data        |

## Post-Deploy Actions (after merging version bump PR)

1. Verify starlight-karma-bot-beta and tasknotes exit CrashLoopBackOff
2. Verify `argocd/apps` syncs successfully with hook annotations
3. Verify `ScoutRiotApiErrorRateHigh` alert clears
4. Acknowledge/triage remaining PagerDuty incidents
5. Investigate R2 storage exceeding 1TB
