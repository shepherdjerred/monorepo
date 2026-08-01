---
id: plan-buildkite-bun-cache-lifecycle-2026-07-29
type: plan
status: in-progress
board: false
---

# Buildkite Bun Cache Lifecycle

## Problem

The shared `buildkite-bun-cache` persistent volume filled its former 30 GiB
quota because it had no garbage collection or retention policy. Bun retains
downloaded package versions until the cache is explicitly removed, so added
headroom alone would only delay another incident.

## Design

- Use the bootstrap deployment's 60 GiB data PVC and independent 1 GiB control
  PVC. Keep managed cache data under `/buildkite/bun-cache/data` and the lock at
  `/buildkite/bun-cache-control/.gc.lock`, where a full data filesystem cannot
  prevent cleanup from acquiring the lock.
- Configure those paths only in the static pipeline. The agent-stack pod patch
  mounts both volumes without setting Bun's environment, so current installs
  use the managed subdirectory while older pipeline revisions fall back to
  per-pod caching instead of bypassing the lock.
- Route every Buildkite dependency install through one explicit helper that
  holds a shared `flock` for the duration of `bun install`.
- Run a five-minute Kubernetes CronJob with a 15-minute deadline. It acquires
  the exclusive lock, rechecks volume utilization, and directly deletes every
  entry below the managed data directory only at or above the 60% high-water
  mark.
- Alert on the Bun PVC alone at 75% for 10 minutes and 90% for 5 minutes using
  persistent ZFS telemetry joined to kube-state-metrics. Alert when the
  collector has not succeeded for 20 minutes.
- Apply PVC admission-policy changes one Argo sync wave before PVC changes so a
  newly classified claim can be created in the same release.
- Validate the synthesized Kubernetes resources, the static pipeline
  invariants, and the focused homelab test graph.

## Session Log — 2026-07-29

### Done

- Confirmed the cache is unbounded and that Bun has only a full-cache removal
  command, not size- or age-based garbage collection.
- Selected a shared/exclusive lock protocol so collection cannot race active
  installs.
- Migrated every static-pipeline install to
  `.buildkite/scripts/bun-install.sh` and added a validator that rejects direct
  `bun install` calls.
- Added the typed Bun cache cdk8s module, versioned collector script, hourly
  high-water-mark CronJob, persistent coordination lock, and focused tests.
- Passed the focused pipeline validator, shell tests, ShellCheck, documentation
  checks, and the package-scoped build/typecheck/test/lint graph for
  `@homelab/cdk8s` and `@shepherdjerred/root-scripts`.

### Remaining

- Commit the verified implementation and publish a draft git-spice pull
  request.
- Restore live cache capacity with a one-time, controlled clear of the legacy
  cache root after the Kubernetes control plane is reachable again.
- Verify current-head Buildkite CI, merge the fix, and confirm ArgoCD deploys
  the collector before treating the incident as resolved.

### Caveats

- The current cache contents remain unavailable at the hard quota. The
  one-time clear is currently blocked because `torvalds`, the Kubernetes API
  host, is offline in Tailscale; `liskov` itself remains online and Talos
  reports its kubelet and storage services healthy.
- The current cache root needs one controlled clear to bootstrap the first
  locked pull-request build. After deployment, new pipelines use the managed
  `data` subdirectory and older pipeline revisions stop writing to the shared
  volume.

## Session Log — 2026-07-30

### Done

- Paused the Buildkite queue, cleared only the disposable Bun cache, reduced
  live use from about 7.95 GiB to 0.56 GiB, and resumed dispatch.
- Merged bootstrap PR #1858, which expands the existing data PVC to 60 GiB,
  adds the independent control PVC and command-pod mount, and promotes
  `util-linux`/`flock` in the CI image.
- Re-synced the published bootstrap release to break the control-PVC bootstrap
  deadlock, then verified both PVCs Bound, the original data PVC UID preserved,
  the control mount present in a real command pod, and `flock` executable.
- Restacked the lifecycle branch onto the merged bootstrap and migrated every
  static-pipeline install through the shared-lock wrapper.
- Implemented the five-minute, 60%-threshold exclusive collector, independent
  lock mount, 15-minute deadline, cache-specific capacity alerts, stale
  collector alert, and admission-policy sync ordering.
- Passed focused pipeline validation, shell tests, ShellCheck, cdk8s tests,
  build, typecheck, lint, and documentation validation. The live Prometheus
  API accepted both new query shapes and reported the Bun PVC at about 6.3%
  used.
- Addressed the automated review's older-pipeline race by removing Bun's
  managed paths from the controller-level pod environment.

### Remaining

- Commit and update PR #1854, pass current-head Buildkite CI and review, merge,
  and verify the collector, alert rules, and locked install path in production.

### Caveats

- Bootstrap release `2.0.0-7332` initially applied the expanded data PVC and
  updated policy catalog but rejected the new control PVC because both were in
  the same Argo sync wave. Retrying after the policy update is safe; the
  lifecycle change makes this ordering deterministic for future releases.
- Four long-running review-gate jobs temporarily occupied every Buildkite
  agent, leaving the bootstrap sync retry reserved.
