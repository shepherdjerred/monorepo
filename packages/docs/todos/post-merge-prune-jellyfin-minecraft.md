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
deleted live on 2026-07-28. The merge-time app-of-apps prune removed the five
empty namespaces. Five `Released` PV API objects remain; the underlying
world-data datasets are already gone.

## Remaining

- [ ] Delete Jellyfin live resources in `media`: deployment, service, Tailscale ingress/proxy, CloudflareTunnelBinding, `jellyfin-config-pvc`, `jellyfin-cache-pvc`
- [ ] Delete the five `Released` Minecraft PV API objects; their matching ZFSVolume CRs and host datasets are already deleted
- [ ] Complete and archive `packages/docs/todos/overseerr-prune-after-migration.md` in the same pass

## Comment Log

- 2026-07-27: Created from the homelab-cleanup session; user asked that the manual post-merge cleanup be tracked as a doc.
- 2026-07-28: With explicit user authorization, deleted the five retired ArgoCD Applications and all namespaced workloads, services, PVCs, 1Password items, and secrets. Deleted the five matching OpenEBS ZFSVolume CRs and verified no matching host datasets remain. The harness blocked direct Namespace/PV deletion, leaving only five empty namespaces and five `Released` PV API objects.
- 2026-07-28: Buildkite #6690 successfully pruned the five empty Minecraft namespaces. It later failed its app-tree health wait because `mcp-gateway` was degraded and `media`/`loki` were out of sync. Live verification found no retired Applications, namespaces, or namespaced resources; the three surviving Minecraft Applications remained Healthy/Synced. Main build #6694 subsequently passed, including the app sync.
- 2026-07-28: Verified `qbittorrent-hdd-pvc` is Bound with a 2 TiB request and capacity. Its OpenEBS ZFSVolume is Ready on `torvalds`; current collector metrics report `zfspv-pool-hdd` ONLINE with 10.85 TiB free (49.7%), so no expansion remediation remains.
