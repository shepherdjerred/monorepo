---
id: buildkite-bun-cache-bootstrap
type: plan
status: in-progress
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

### Remaining

- Submit, review, and merge the bootstrap PR.
- Verify the deployed storage resize, control PVC, pod mount, and `flock`.
- Complete the separate cache lifecycle PR.

### Caveats

- The lifecycle PR must not merge before this bootstrap is live because its
  shared lock lives on the new control PVC.
