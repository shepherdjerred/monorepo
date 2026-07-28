---
id: log-2026-07-27-homelab-cleanup-floor-heat
type: log
status: in-progress
board: false
---

# Homelab cleanup + conditional floor heating

Session goals (user request 2026-07-27):

1. Expand qBittorrent downloads PVC 1TiB → 2TiB
2. Floor heating: heat master bathroom floor only when cold (indoor ≤20°C OR outdoor ≤15°C), target 30°C instead of 40°C
3. Remove Jellyfin (Overseerr already migrated to Seerr — no code change, redirect stays)
4. Delete all Minecraft servers except sjerred, shuxin, tsmc (allthemons, stoneblock4, bettermc, allofcreate, ftbskies2) — including live data (user confirmed: "We don't use any of those MC data")

## Approach

- Stack of 2 PRs in one worktree (git-spice):
  - PR1 `feature/floor-heat-conditional` — packages/temporal good-morning workflow
  - PR2 `feature/homelab-cleanup` — packages/homelab (cdk8s + tofu DNS)
- Post-merge ops: tofu apply, ArgoCD sync, live deletion of jellyfin + 5 MC namespaces/PVs, complete overseerr-prune TODO.

## Key facts discovered

- Floor heater: `climate.master_bathroom` (Mysa INF-V1, fork exposes 40°C max). Workflow: `packages/temporal/src/workflows/ha/good-morning.ts`.
- Indoor sensor: `sensor.master_bathroom_temperature` (live-verified via HA API). No weather integration in HA → Open-Meteo activity for outdoor temp; lat/lon from `zone.home` attributes.
- qBittorrent downloads PVC: `packages/homelab/src/cdk8s/src/cdk8s-charts/media.ts:33-35` (`ZfsSataVolume`, `Size.tebibytes(1)`), storage class `zfs-hdd` has `allowVolumeExpansion: true`.
- Jellyfin: `src/cdk8s/src/resources/media/jellyfin.ts` + refs in media.ts:7,54-57, versions.ts:57, pvc-backup-policy.json:153-163, sjer-red.tf:109-116.
- MC servers to delete are thin wrappers of `src/misc/modded-minecraft.ts` (dead code after); apps.ts:18-22,119-123; backup-policy entries; sjer-red.tf:359-469 CNAMEs+SRV.

## Session Log — 2026-07-27

### Done

- PR1 #1746 (`feat(temporal): heat bathroom floor only on cold mornings`): new `src/activities/weather.ts` (Open-Meteo, Zod-validated), `good-morning.ts` heats to 30°C only when bathroom air ≤20°C OR outdoor ≤15°C; warm mornings skip heat but the rest of the wake routine runs. 6 new time-skipping workflow tests; 700/700 package tests pass; strict typecheck against live HA schema (1002 entities) passes.
- PR2 #1747 (`feat(homelab): expand qBittorrent to 2Ti, remove Jellyfin, delete unused Minecraft servers`): qBittorrent downloads PVC 1→2TiB; Jellyfin fully removed (resource, pin, backup entries, CNAME, stale comments); 5 MC servers + `modded-minecraft.ts` + DNS + backup entries removed; ops guide + audit runbook updated; backup-policy test counts updated (74→67). cdk8s build/typecheck/252 tests/lint all green; `tofu validate` green.
- `tofu plan` (cloudflare): exactly 11 destroys = 5 MC CNAMEs + 5 MC SRVs + jellyfin CNAME. The 31 "changes" are pre-existing provider drift on DNSSEC/mail SRV records, unrelated.
- Both PRs marked ready for review.

### Remaining

- Merge #1746 then #1747 (bottom-up), then `git-spice repo sync --restack`.
- Post-merge ops (needs cluster + tofu apply):
  1. `op run --env-file=.env -- tofu -chdir=cloudflare apply` (packages/homelab/src/tofu)
  2. ArgoCD sync `media` + `apps`; verify `qbittorrent-hdd-pvc` expands to 2Ti (`kubectl get pvc -n media qbittorrent-hdd-pvc`); check SATA pool free space first.
  3. Live deletion: jellyfin deployment/service/ingress/PVCs (`jellyfin-config-pvc`, `jellyfin-cache-pvc`) in `media`; `argocd app delete` + `kubectl delete namespace` for minecraft-{allthemons,stoneblock4,bettermc,allofcreate,ftbskies2}; delete Released PVs (reclaimPolicy Retain).
  4. Complete + archive `packages/docs/todos/overseerr-prune-after-migration.md` while pruning.

### Caveats

- The temporal package pre-commit (`check:rehearsal`, cache:false) is very slow in a worktree (~10+ min; scout install + tests) — commit hooks take a long time; not a hang.
- HA has no weather integration; outdoor temp comes from Open-Meteo. If Open-Meteo is down, the workflow activity retries 3× then the run fails (fail-fast, no silent heating).
- Preheat window stays 2h15m though 30°C only needs ~1h — harmless superset, schedule unchanged.
- MC world data + Jellyfin config are unrecoverable after live deletion (user confirmed).
