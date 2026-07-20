---
id: log-2026-05-23-renovate-dashboard-481-docker-unschedule
type: log
status: complete
board: false
---

# Renovate Dashboard #481 Docker Unschedule

## Context

User asked to update the Docker/Helm items in the Renovate dashboard issue #481
that were under "Awaiting Schedule".

## Session Log — 2026-05-23

### Done

- Loaded Docker, Helm, version-management, and GitHub workflow guidance.
- Checked prior Renovate dashboard context with `toolkit recall search`.
- Fetched the live body of GitHub issue #481 and confirmed that the "Awaiting Schedule" section contained Docker-related updates plus protobufjs/typescript majors, but no Helm release entries.
- Checked 20 Docker-related awaiting-schedule boxes in issue #481:
  grouped Grafana/Loki/Tempo/MinIO pinning, Docker digest refreshes, Grafana/Loki/Tempo Docker tag updates, and the Grafana v13 Docker tag update.
- Verified issue #481 now has those 20 Docker awaiting-schedule entries checked.

### Remaining

- Renovate still needs to process the checked dashboard entries and create/update PRs.
- Helm release entries were not touched because they are under "Pending Status Checks", not "Awaiting Schedule".

### Caveats

- Left protobufjs v8, TypeScript v6, and "Create all awaiting schedule PRs at once" unchecked.
- A first GitHub issue edit was accepted but did not change the body because the local Bun transform was blocked by untrusted mise config; retried with a shell-only transform and verified the final checkbox state.

## Session Log — 2026-05-23 Merge Follow-up

### Done

- Merged 17 open Renovate PRs immediately with admin override and merge commits:
  #887, #888, #889, #890, #891, #892, #893, #894, #895, #896, #897, #898,
  #899, #900, #901, #902, and #789.
- Attempted the same for #903, #904, #905, and #906; GitHub rejected them as
  conflicted after #887 pinned the same image lines.
- Landed the remaining final image state directly on `main` with two commits:
  `6438d29a531cf3838d9bcab5f762a5652ead51e3` and
  `65619b0fc88465d29b3df580943b9d6c8755fbfe`.
- Closed #903, #904, #905, and #906 as superseded by the direct commits and
  deleted their Renovate branches.
- Verified there are no remaining open Renovate PRs.

### Remaining

- None for the open Renovate PR queue.

### Caveats

- #903 and #906 were mutually exclusive Grafana updates on the same image line
  (`11.6.14` vs `13.0.1`), so the final direct commit kept the higher requested
  Grafana target, `13.0.1`.
- The direct commits bypassed PR CI and landed unsigned because they were written
  through the GitHub contents API.

## Session Log — 2026-05-23 Kubernetes Revert

### Done

- Confirmed #789 changed only `packages/homelab/src/cdk8s/src/versions.ts`.
- Reverted the accidental Kubernetes upgrade on `main` with commit
  `6582969b77a2cabeae90852861fa5901993b2371`.
- Verified `versions["kubernetes/kubernetes"]` is back to `v1.36.0`.
- Verified there are no open Renovate PRs after the revert.

### Remaining

- None for removing the Kubernetes upgrade from `main`.

### Caveats

- #789 remains a merged PR in GitHub history, but its code change has been
  reverted on `main`.
- Renovate may propose the Kubernetes update again later unless its rule or
  dashboard state is changed.
