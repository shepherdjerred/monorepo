---
id: log-pr-1746-review-comments
type: log
status: complete
board: false
---

# PR #1746 review comments

Resolve all unresolved actionable review threads on PR #1746, verify the affected Temporal and homelab monitoring behavior, and update the existing git-spice stack.

## Session Log — 2026-07-28

### Done

- Restacked PR #1746 onto `origin/main`, preserving the current Seerr version
  while retaining the Jellyfin removal.
- Made `goodMorningWakeUp` wait through the heat window and turn off the
  bathroom thermostat regardless of the second temperature reading.
- Classified `goodMorningPreheat`'s `not-cold` outcome as benign in the
  Temporal monitoring rule and added regression coverage for both review
  fixes.
- Corrected the Minecraft operations guide to describe the three surviving
  Paper servers and their actual whitelist/operator configuration.
- With explicit user authorization, deleted the five retired Minecraft
  Applications, workloads, services, PVCs, 1Password items, secrets, OpenEBS
  ZFSVolume objects, and host ZFS datasets. Verified the three surviving
  Minecraft Applications remained healthy and synced.

### Remaining

- Remove the five empty retired-Minecraft namespace objects and five
  `Released` PV API records during normal GitOps/operator cleanup.
- Complete the remaining qBittorrent, Jellyfin, and post-merge checks tracked
  in `packages/docs/todos/post-merge-prune-jellyfin-minecraft.md`.

### Caveats

- The retired Minecraft world datasets are irrecoverably deleted unless an
  independent external backup exists.
- Direct Namespace and PV deletion was blocked by the execution harness.
- Until PR #1746 merges, another sync of the current `main` app-of-apps chart
  can recreate the retired child Applications and empty services; their
  persistent data no longer exists.
