---
id: log-2026-05-17-check-main-ci-failure
type: log
status: complete
board: false
---

# Check Main CI Failure

Investigated the latest Buildkite failure on `main`.

## Findings

- Latest `main` build checked: Buildkite `monorepo` build 2577.
- Build 2577 failed on commit `3053b66525544d04af1e31ca09bb02dcccb13d64` with message `feat(scout-for-lol): support Arena 3v3`.
- The only job in the failed build was `:pipeline: Upload pipeline`; it exited with status 255 before the dynamic CI pipeline expanded.
- The failed job log shows checkout retries failing while updating the shared git mirror:

```text
error: cannot open '/buildkite/git-mirrors/https---github-com-shepherdjerred-monorepo-git/FETCH_HEAD': Quota exceeded
```

- The error repeated for all six checkout attempts, then the job failed with `getting/updating git mirror: exit status 255`.
- Kubernetes shows the Buildkite git mirror PVC is `buildkite-git-mirrors`, backed by `zfs-ssd`, with capacity `5Gi`.
- The PVC is defined in `packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts` and wired into Buildkite's `gitMirrors` checkout config.

## Why It Started

- The first observed quota failure in the recent window was build 2574, not the later `main` build 2577.
- Build 2573 passed at 20:58:55 UTC. Build 2574 started at 20:59:02 UTC and immediately failed checkout while fetching `refs/pull/624/head` with `FETCH_HEAD: Quota exceeded`.
- Builds 2575, 2576, 2577, 2578, and the original attempt of 2579 then hit the same shared git mirror failure.
- Build 2575 also spent time waiting on `/buildkite/git-mirrors/https---github-com-shepherdjerred-monorepo-git.updatelockf`, showing contention on the same shared mirror during the failure window.
- The issue later cleared enough for a manual retry of build 2579 to pass checkout, and build 2580 passed, so this was a shared mirror storage/lock saturation event rather than a bad commit or invalid pipeline config.
- The underlying fragility remains: the shared mirror PVC is only `5Gi`, while the Buildkite agent stack reuses it for the monorepo mirror across PR, branch, release, and Renovate builds.

## Session Log -- 2026-05-17

### Done

- Loaded Buildkite and Kubernetes troubleshooting guidance.
- Queried Buildkite for recent `main` builds and confirmed build 2577 is the latest failed `main` build.
- Fetched the failed Buildkite job log for build 2577.
- Checked surrounding Buildkite builds and found the quota failure began at build 2574, then affected builds 2575 through the original attempt of 2579.
- Checked the Buildkite Kubernetes namespace and confirmed the shared git mirror PVC is only `5Gi`.
- Located the in-repo Buildkite PVC and git mirror configuration.
- Expanded the desired `buildkite-git-mirrors` PVC request from `5Gi` to `20Gi` in `packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts`.
- Installed missing local workspace dependencies needed for verification in this fresh worktree.
- Verified the cdk8s synth output contains `storage: 20Gi` for `buildkite-git-mirrors`; generated `dist/` output remains ignored by repo policy.
- Ran `bun run build`, `bun run typecheck`, and `bun run lint` in `packages/homelab/src/cdk8s`.
- Updated `scripts/setup.ts` so setup explicitly runs `mise trust -y` for every repo mise config and fails visibly if trust cannot be written.
- Updated `AGENTS.md` to make `bun run scripts/setup.ts` the first-run setup path and clarify that `mise run dev` is equivalent only after the repo is trusted.
- Verified the setup script edit with `bun build scripts/setup.ts --outdir /private/tmp/setup-check`, `bunx prettier --check scripts/setup.ts AGENTS.md`, and `bunx markdownlint-cli2 AGENTS.md`.

### Remaining

- Sync the Buildkite ArgoCD application so the cluster PVC request is expanded, then rerun main CI.
- The `zfs-ssd` storage class has `allowVolumeExpansion: true`, so increasing the PVC request should be viable from the storage-class side.
- Fresh clones still need a working `bun` binary to run `bun run scripts/setup.ts`; the setup script can remove the separate manual `mise trust` step, but it cannot bootstrap Bun before any Bun exists.

### Caveats

- I did not mutate the cluster or rerun CI.
- Live exec into a job pod was not reliable because the candidate pods completed before `kubectl exec` could attach.
- Initial verification was blocked by untrusted mise shims and missing workspace dependencies; rerunning with the direct Bun binary and installed lockfile dependencies passed.
- A sandboxed dry run of `bun --check scripts/setup.ts` executed the script and confirmed the new trust path fails clearly when the sandbox cannot write mise state under `~/.local/state/mise`.
