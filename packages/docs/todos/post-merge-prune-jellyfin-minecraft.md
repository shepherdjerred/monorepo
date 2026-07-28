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
and any remaining app-of-apps resources (`argocd.ts sync apps --prune`). The
Minecraft Applications, workloads, PVCs, secrets, and ZFS datasets were
deleted live on 2026-07-28. Five empty namespaces and five `Released` PV API
objects remain; the underlying world-data datasets are already gone.

## Remaining

- [ ] Confirm CI post-merge steps ran: tofu apply (11 DNS destroys) and `sync apps --prune`
- [ ] ArgoCD sync `media`; verify `qbittorrent-hdd-pvc` expanded to 2Ti (`kubectl get pvc -n media qbittorrent-hdd-pvc`); check `zfspv-pool-hdd` free space first
- [ ] Delete Jellyfin live resources in `media`: deployment, service, Tailscale ingress/proxy, CloudflareTunnelBinding, `jellyfin-config-pvc`, `jellyfin-cache-pvc`
- [ ] Remove the five empty namespaces: minecraft-allthemons, minecraft-stoneblock4, minecraft-bettermc, minecraft-allofcreate, minecraft-ftbskies2
- [ ] Delete the five `Released` Minecraft PV API objects; their matching ZFSVolume CRs and host datasets are already deleted
- [ ] Complete and archive `packages/docs/todos/overseerr-prune-after-migration.md` in the same pass

## Comment Log

- 2026-07-27: Created from the homelab-cleanup session; user asked that the manual post-merge cleanup be tracked as a doc.
- 2026-07-28: With explicit user authorization, deleted the five retired ArgoCD Applications and all namespaced workloads, services, PVCs, 1Password items, and secrets. Deleted the five matching OpenEBS ZFSVolume CRs and verified no matching host datasets remain. The harness blocked direct Namespace/PV deletion, leaving only five empty namespaces and five `Released` PV API objects.
