---
id: buildkite-pvc-expansion-confirmed
status: waiting-on-verification
origin: packages/docs/logs/2026-05-17_check-main-ci-failure.md
source_marker: false
---

# Confirm `buildkite-git-mirrors` PVC actually expanded from 5Gi to 20Gi in-cluster

## What

Build 2577 failed `:pipeline: Upload pipeline` with `Quota exceeded` on the shared `/buildkite/git-mirrors/.../FETCH_HEAD` mirror. Builds 2574–2578 all hit it before clearing. Root cause: the `buildkite-git-mirrors` PVC was sized at only 5Gi, shared across all branch / PR / Renovate builds for the monorepo. Desired PVC request was bumped to 20Gi in `packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts`; cdk8s synth confirmed `storage: 20Gi`. The `zfs-ssd` storage class has `allowVolumeExpansion: true`, so expansion _should_ succeed online — but no one synced ArgoCD or verified the cluster picked it up.

## Why it's open

The originating session explicitly did not mutate the cluster or rerun CI. The cluster-side expansion is gated on ArgoCD sync of the Buildkite App.

## Done when

- `kubectl -n buildkite get pvc buildkite-git-mirrors -o jsonpath='{.status.capacity.storage}'` returns `20Gi`.
- No `Quota exceeded` failures on the mirror across the next 7 days of main / PR / Renovate builds.
- If `allowVolumeExpansion` somehow misfires (e.g. ZFS dataset quota not honored), capture the failure mode and downgrade plan in a new log.

## References

- Originating log: `packages/docs/logs/2026-05-17_check-main-ci-failure.md`
- Fix commit: `c3e8a883b`
- PVC definition: `packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts`
- Failing build: [#2577](https://buildkite.com/sjerred/monorepo/builds/2577) (commit `3053b66525544d04af1e31ca09bb02dcccb13d64`)
