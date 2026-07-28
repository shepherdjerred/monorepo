---
id: guide-2026-04-25-minecraft-server-ops
type: guide
status: complete
board: false
---

# Minecraft Server Ops

## Deployed Servers

As of 2026-07, only the three bespoke Paper servers remain declared:
`minecraft-sjerred`, `minecraft-shuxin`, and `minecraft-tsmc` (see
`packages/homelab/src/cdk8s/src/resources/argo-applications/minecraft-*.ts`).

The IaC and DNS records for the five retired pack servers (All the Mons, FTB
StoneBlock 4, Better Minecraft, All of Create, FTB Skies 2) have been removed.
Their live Applications, workloads, PVCs, secrets, and OpenEBS ZFS datasets
were deleted on 2026-07-28. Five empty namespace objects and five `Released`
PV objects remain for the normal GitOps prune/operator cleanup tracked in
`packages/docs/todos/post-merge-prune-jellyfin-minecraft.md`; the world data
itself is gone.

## Operational Notes

- `minecraft-sjerred` uses a six-player whitelist: `RiotShielder`,
  `lolopToaster`, `gexboy8`, `Virmel`, `XiguaShuxin`, and `XiguaJerred`.
- `minecraft-shuxin` uses a four-player whitelist: `RiotShielder`,
  `vietnamesechovy`, `XiguaShuxin`, and `XiguaJerred`.
- `minecraft-tsmc` has no whitelist and grants operator access to
  `RiotShielder`.
- `mc-router` auto-hibernates idle servers and wakes them on connect.
- `mc.sjer.red`, `shuxin.sjer.red`, and `mc.ts-mc.net` are CNAMEs to
  `ddns.sjer.red` managed outside OpenTofu.
- Server definitions live in `packages/homelab/src/cdk8s/src/resources/argo-applications/`.
