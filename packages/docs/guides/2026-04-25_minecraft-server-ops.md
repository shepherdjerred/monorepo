# Minecraft Server Ops

## Status

Active operational reference. Extracted from the archived March 2026 modpack recommendation research.

## Deployed Servers

All deployed servers use the `itzg/minecraft-server` Helm chart with `AUTO_CURSEFORGE` type.

| Server           | Hostname               | JVM | K8s Memory | Storage |
| ---------------- | ---------------------- | --- | ---------- | ------- |
| All the Mons     | `allthemons.sjer.red`  | 8G  | 10Gi       | 64Gi    |
| FTB StoneBlock 4 | `stoneblock4.sjer.red` | 6G  | 8Gi        | 32Gi    |
| Better Minecraft | `bettermc.sjer.red`    | 6G  | 8Gi        | 32Gi    |
| All of Create    | `allofcreate.sjer.red` | 6G  | 8Gi        | 32Gi    |
| FTB Skies 2      | `ftbskies2.sjer.red`   | 6G  | 8Gi        | 32Gi    |

## Operational Notes

- Whitelist: `RiotShielder`, `vietnamesechovy`.
- `mc-router` auto-hibernates idle servers and wakes them on connect.
- CurseForge API key is stored in 1Password and shared across the servers.
- DNS uses CNAMEs to `ddns.sjer.red` plus SRV records managed in OpenTofu.
- Shared helper: `packages/homelab/src/cdk8s/src/misc/modded-minecraft.ts`.
- Thin server definitions live in `packages/homelab/src/cdk8s/src/resources/argo-applications/`.

## Deployment Caution

Starting all servers at once can hit CurseForge API rate limits. Stagger first-time startups or full redeploys.
