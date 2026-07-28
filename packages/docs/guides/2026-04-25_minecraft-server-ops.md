---
id: guide-2026-04-25-minecraft-server-ops
type: guide
status: complete
board: false
---

# Minecraft Server Ops

## Deployed Servers

As of 2026-07 only the three bespoke servers remain: `minecraft-sjerred`,
`minecraft-shuxin`, and `minecraft-tsmc` (see
`packages/homelab/src/cdk8s/src/resources/argo-applications/minecraft-*.ts`).
The five `createModdedMinecraftApp` pack servers (All the Mons, FTB StoneBlock
4, Better Minecraft, All of Create, FTB Skies 2) were deleted on 2026-07-27
along with their namespaces, data, DNS records, and the shared
`modded-minecraft.ts` helper.

## Operational Notes

- Whitelist: `RiotShielder`, `vietnamesechovy`.
- `mc-router` auto-hibernates idle servers and wakes them on connect.
- CurseForge API key is stored in 1Password and shared across the servers.
- `mc.sjer.red`, `shuxin.sjer.red`, and `mc.ts-mc.net` are CNAMEs to
  `ddns.sjer.red` managed outside OpenTofu.
- Server definitions live in `packages/homelab/src/cdk8s/src/resources/argo-applications/`.

## Deployment Caution

Starting all servers at once can hit CurseForge API rate limits. Stagger first-time startups or full redeploys.
