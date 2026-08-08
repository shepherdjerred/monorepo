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
- Run the five-minute Temporal `buildkite-bun-cache-gc` schedule on the serial
  maintenance worker with a 15-minute activity deadline. It acquires
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
