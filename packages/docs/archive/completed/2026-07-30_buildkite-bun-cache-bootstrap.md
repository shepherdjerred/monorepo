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
