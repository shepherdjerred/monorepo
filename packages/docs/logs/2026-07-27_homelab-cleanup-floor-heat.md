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
