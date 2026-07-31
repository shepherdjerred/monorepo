---
id: log-buildkite-bun-cache-full-investigation-2026-07-29
type: log
status: complete
board: false
---

# Buildkite Bun Cache Full Investigation

## Scope

Read-only investigation of reported Buildkite failures involving the shared
`buildkite-bun-cache` PVC and older pre-checkout `stack_error` builds.

## Findings

### Current Bun install failures

- The report was correct when written, but the incident continued. Builds
  7266–7320 are now 55 consecutive failed builds, not nine. Build 7320 was
  still the newest build at the final check.
- Build 7320 completed checkout and then failed in the `verify` job at
  `bun install --frozen-lockfile` with:

  ```text
  error: Unexpected accessing temporary directory. Please set $BUN_TMPDIR or $BUN_INSTALL
  ```

- The error is a storage-capacity failure, not a missing environment variable.
  The live ZFS dataset backing `buildkite-bun-cache` has 30.0 GiB used, 0 bytes
  available, and a hard 30 GiB quota.
- All `container-0` Buildkite steps mount this PVC at `/buildkite/bun-cache` and
  set `BUN_INSTALL_CACHE_DIR` to that path. Downstream broken and canceled jobs
  are fallout from the initial install failure.

### Why the cache filled

- The 30 GiB PVC was introduced as a persistent, shared Bun download cache.
  Its desired state contains no cleanup job, generation rotation, retention
  policy, or size-aware garbage collection.
- The adjacent shared UV cache does have a scheduled prune job. BuildKit and
  Turbo also have independently bounded cache designs; the Bun cache is the
  lifecycle exception.
- Bun 1.3.14 exposes `bun pm cache rm` for a complete cache clear, but no
  age- or size-based prune command. Its cache retains package versions in
  versioned directories.
- Historical volume telemetry shows the cache grew from effectively empty on
  July 26 to about 29.9 GiB by July 29 01:00 PDT. It abruptly dropped to about
  4.2 GiB ten minutes later, consistent with an external full clear, and then
  refilled in roughly 18 hours. The actor responsible for that clear was not
  identified.
- The generic `PVCStorageHigh` alert did fire, but its kubelet metric disappears
  whenever no short-lived job pod mounts the PVC. The alert therefore resets
  between jobs and is not a reliable cache-lifecycle control.

### Older `stack_error` failures

- The seven reported older failures were real but were not exhaustive. The
  inspected history contains additional jobs with the same failure mode during
  the Liskov worker outage and onboarding window.
- Representative build 7176 never acquired an agent: its pipeline-upload job
  had no agent, no start time, no checkout, exit status `-1`, and
  `signal_reason: stack_error` after the 15-minute scheduling window.
- This is a separate failure class from the full Bun cache. Liskov did not
  become Kubernetes Ready until 2026-07-29 13:45 PDT; the affected jobs expired
  before that transition. The node is currently Ready with no reported disk,
  memory, or process pressure.
- Replacing those builds before restoring cache capacity would not produce
  meaningful results: the replacement jobs would proceed farther than the old
  scheduling failure, then fail at the shared Bun cache.

## Assessment

The immediate blocker is a disposable cache at a hard quota, but expanding the
PVC alone is not a durable fix: the current workload refilled 30 GiB in about
18 hours. Recovery requires an authorized cache clear or expansion, followed by
a GitOps change that bounds growth and avoids deleting cache entries while
concurrent installs are using them. A cache-specific alert should use a
persistent storage metric rather than a mount-dependent kubelet metric.

No cache clear, PVC resize, Buildkite retry, Kubernetes mutation, or GitOps
change was performed during this investigation.

## Session Log — 2026-07-29

### Done

- Confirmed 55 consecutive Buildkite failures in the cache-incident window
  through build 7320 and isolated the representative first failing command.
- Verified the backing ZFS dataset is at its hard 30 GiB quota with 0 bytes
  available.
- Distinguished the older pre-checkout `stack_error` failures from the current
  post-checkout Bun failures using Buildkite job and Liskov readiness evidence.
- Traced the durable cause to the missing lifecycle policy for the shared Bun
  cache and measured its refill history from live telemetry.

### Remaining

- Publish the bounded, concurrency-safe lifecycle implementation documented in
  `packages/docs/plans/2026-07-29_buildkite-bun-cache-lifecycle.md`.
- Clear the disposable legacy cache and retry CI after the Kubernetes control
  plane is reachable again.

### Caveats

- The cache contents could not be inspected without mounting the unmounted PVC,
  which would mutate cluster state. The investigation therefore cannot divide
  growth precisely between retained package versions and abandoned temporary
  files.
- The Kubernetes readiness timeline confirms worker unavailability for the
  older failures. Later direct Talos access showed Liskov healthy, but the
  lower-level reason for the earlier outage was not recovered.
- During the recovery attempt, `torvalds` went offline in Tailscale and stopped
  serving the Kubernetes API. Direct Talos access to `liskov` still reports the
  worker Ready with healthy kubelet, container runtime, and ZFS services, but a
  safe Kubernetes-mounted cache clear cannot proceed without the control plane.
