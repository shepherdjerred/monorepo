---
id: buildkite-bun-cache-bootstrap
type: plan
status: complete
board: false
---

# Buildkite Bun Cache Bootstrap

## Goal

Prepare the Buildkite agent stack for safe cache lifecycle management without
changing install behavior yet:

- expand the disposable shared Bun cache PVC from 30 GiB to 60 GiB in place;
- add a separate 1 GiB, backup-excluded control PVC for cache locks;
- mount the control PVC into every command container; and
- ensure the CI image contains `flock` through the `util-linux` package.

The lifecycle collector and install wrapper will follow in a second PR after
this storage and image bootstrap is deployed.

## Implementation

- Update the Buildkite PVC and agent-stack pod specification in the cdk8s app.
- Add the control PVC using the existing NVMe LZ4 storage class and disposable
  backup policy.
- Add `util-linux` to the CI base image.
- Extend focused render and image tests to make the new invariants explicit.
- Submit as a draft git-spice PR, pass current-head CI and review, merge, and
  verify the live ArgoCD/Kubernetes state before starting the lifecycle PR.

## Verification

- Focused cdk8s build, typecheck, lint, and tests pass.
- CI image tests confirm `util-linux` remains installed.
- Staged-file hooks pass.
- Buildkite passes on the PR head.
- After merge, the original Bun data PVC UID is unchanged, its requested and
  effective capacity are 60 GiB, the control PVC is Bound, and a Buildkite
  command pod exposes `/buildkite/bun-cache-control` with `flock` available.

## Session Log — 2026-07-30

### Done

- Cleared the full disposable Bun cache under a paused Buildkite queue.
- Reduced live use from 27% to 2% and resumed queue dispatch.
- Implemented the 60 GiB data PVC, 1 GiB control PVC, command-container mount,
  explicit `util-linux`/`flock` image dependency, and backup-policy entry.
- Passed the focused cdk8s build, typecheck, lint, and 288-test suite, the
  toolchain shell test, ShellCheck, and docs validation.
- Merged PR #1858 at `9173f7a27a41aa74ead9c1e93d9d8bf0b710eba2`.
- Synced release `2.0.0-7332` and verified the original data PVC kept UID
  `67ea3ce2-41af-43da-9cce-9f127ad38a07` with 60 GiB requested and available.
- Verified the 1 GiB control PVC is Bound and a real Buildkite command
  container mounts it from ZFS at `/buildkite/bun-cache-control`.
- Verified that command container runs `flock` from `util-linux 2.38.1`.

### Remaining

- Complete the separate cache lifecycle PR.

### Caveats

- The lifecycle PR must not merge before this bootstrap is live because its
  shared lock lives on the new control PVC.
- The first Argo sync updated the admission policy and resized the data PVC but
  rejected the newly classified control PVC before the policy update took
  effect. A second sync of the same GitOps release created it successfully.
  The lifecycle PR assigns admission policies an earlier sync wave so future
  policy-and-PVC releases do not repeat this ordering failure.
