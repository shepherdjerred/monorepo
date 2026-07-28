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
- Added a Temporal patch marker that preserves the legacy command sequence for
  morning workflows already running during deployment.
- Converted malformed Home Assistant home-zone coordinates into a
  non-retryable `ApplicationFailure` with regression coverage.
- Classified `goodMorningPreheat`'s `not-cold` outcome as benign in the
  Temporal monitoring rule and added regression coverage for both review
  fixes.
- Corrected the Minecraft operations guide to describe the three surviving
  Paper servers and their actual whitelist/operator configuration.
- With explicit user authorization, deleted the five retired Minecraft
  Applications, workloads, services, PVCs, 1Password items, secrets, OpenEBS
  ZFSVolume objects, and host ZFS datasets. Verified the three surviving
  Minecraft Applications remained healthy and synced.
- Verified the merge-time app-of-apps prune removed the five empty retired
  Minecraft namespaces while leaving the three surviving servers healthy.
- Verified `qbittorrent-hdd-pvc` is Bound at 2 TiB, its OpenEBS ZFSVolume is
  Ready, and `zfspv-pool-hdd` is ONLINE with 10.85 TiB free (49.7%).
- Opened and merged follow-up PR #1755 for the post-merge replay and
  validation fixes, and resolved every review thread on PRs #1746 and #1747
  with implementation evidence.
- Published follow-up PR #1757 to preserve the final live cleanup state and
  remaining operator work.
- After PR #1757 merged, the operator deleted the five remaining `Released`
  retired-Minecraft PV API records. Verified all five are absent and the three
  surviving Minecraft Applications remain Healthy/Synced.

### Remaining

- Complete the remaining Jellyfin and post-merge checks tracked
  in `packages/docs/todos/post-merge-prune-jellyfin-minecraft.md`.

### Caveats

- The retired Minecraft world datasets are irrecoverably deleted unless an
  independent external backup exists.
- Buildkite #6690's app-of-apps prune succeeded, but the build failed because
  `mcp-gateway` remained degraded and `media`/`loki` remained out of sync.
  The #1755 merge build (#6693) was superseded by main build #6694, which
  passed, including the app sync; Buildkite #6692 passed for #1755's initial
  PR head.
