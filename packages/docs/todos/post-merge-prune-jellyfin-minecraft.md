---
id: post-merge-prune-jellyfin-minecraft
type: todo
board: true
status: planned
verification: operator
disposition: blocked
origin: log-2026-07-27-homelab-cleanup-floor-heat
---

# Post-merge prune: Jellyfin + deleted Minecraft servers

PR #1747 removed Jellyfin and the five modded Minecraft servers
(allthemons, stoneblock4, bettermc, allofcreate, ftbskies2) from cdk8s and
OpenTofu. Auto-deletion on merge covers only the DNS records (CI `tofu apply`)
and the ArgoCD Application entries (`argocd.ts sync apps --prune`). Everything
else survives by design (prune is off, no resources-finalizer, PVCs untracked,
PVs `reclaimPolicy: Retain`) — same pattern as the Overseerr→Seerr migration.

## Remaining

- [ ] Confirm CI post-merge steps ran: tofu apply (11 DNS destroys) and `sync apps --prune` (5 MC Application CRs gone)
- [ ] ArgoCD sync `media`; verify `qbittorrent-hdd-pvc` expanded to 2Ti (`kubectl get pvc -n media qbittorrent-hdd-pvc`); check `zfspv-pool-hdd` free space first
- [ ] Delete Jellyfin live resources in `media`: deployment, service, Tailscale ingress/proxy, CloudflareTunnelBinding, `jellyfin-config-pvc`, `jellyfin-cache-pvc`
- [ ] `kubectl delete namespace` for minecraft-allthemons, minecraft-stoneblock4, minecraft-bettermc, minecraft-allofcreate, minecraft-ftbskies2 (world data permanently gone — user confirmed 2026-07-27)
- [ ] Delete the resulting `Released` PVs (and underlying ZFS datasets if openebs leaves them)
- [ ] Complete and archive `packages/docs/todos/overseerr-prune-after-migration.md` in the same pass

## Comment Log

- 2026-07-27: Created from the homelab-cleanup session; user asked that the manual post-merge cleanup be tracked as a doc.
