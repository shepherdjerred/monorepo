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
empty namespaces. The five remaining `Released` PV API objects were deleted
later that day; no retired Minecraft storage objects remain in Kubernetes.

## Remaining

- [ ] Delete Jellyfin live resources in `media`: deployment, service, Tailscale ingress/proxy, CloudflareTunnelBinding, `jellyfin-config-pvc`, `jellyfin-cache-pvc`
- [ ] Complete and archive `packages/docs/todos/overseerr-prune-after-migration.md` in the same pass

## Comment Log

- 2026-07-27: Created from the homelab-cleanup session; user asked that the manual post-merge cleanup be tracked as a doc.
- 2026-07-28: With explicit user authorization, deleted the five retired ArgoCD Applications and all namespaced workloads, services, PVCs, 1Password items, and secrets. Deleted the five matching OpenEBS ZFSVolume CRs and verified no matching host datasets remain. The harness blocked direct Namespace/PV deletion, leaving only five empty namespaces and five `Released` PV API objects.
- 2026-07-28: Buildkite #6690 successfully pruned the five empty Minecraft namespaces. It later failed its app-tree health wait because `mcp-gateway` was degraded and `media`/`loki` were out of sync. Live verification found no retired Applications, namespaces, or namespaced resources; the three surviving Minecraft Applications remained Healthy/Synced. Main build #6694 subsequently passed, including the app sync.
- 2026-07-28: Verified `qbittorrent-hdd-pvc` is Bound with a 2 TiB request and capacity. Its OpenEBS ZFSVolume is Ready on `torvalds`; current collector metrics report `zfspv-pool-hdd` ONLINE with 10.85 TiB free (49.7%), so no expansion remediation remains.
- 2026-07-28: After PR #1757 merged, the operator deleted the five remaining `Released` retired-Minecraft PV API records. Live verification found none of the five PVs and confirmed `minecraft-sjerred`, `minecraft-shuxin`, and `minecraft-tsmc` remain Healthy/Synced.

## Session Log — 2026-07-28

### Done

- Deleted the five final `Released` retired-Minecraft PV API records and
  verified they are absent.
- Confirmed `minecraft-sjerred`, `minecraft-shuxin`, and `minecraft-tsmc`
  remain Healthy/Synced.

### Remaining

- Delete the remaining Jellyfin resources listed above.
- Complete and archive the Overseerr cleanup TODO.

### Caveats

- The retired Minecraft world datasets are irrecoverably deleted unless an
  independent external backup exists.
