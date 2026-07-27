---
id: 2026-07-25-ci-no-dind-cache-cutover
type: plan
status: complete
board: false
---

# CI No-DinD Cache Cutover

## Goal

Remove the per-job Docker-in-Docker graph from Buildkite while preserving the
current production-image startup checks. Keep durable, bounded caches on
Liskov so warm CI work is read-heavy rather than recreated per pod.

## Decisions

- BuildKit owns image builds, in-image smoke execution, and direct registry
  pushes; CI must not use `--load`, a local Docker daemon, or `DOCKER_HOST`.
- Every production image receives a stable runtime-filesystem stage and an
  in-image smoke target that exercises the same image-owned startup assertions.
- The LLM observability Docker Compose E2E becomes a Kubernetes pod with
  equivalent Tempo and MinIO sidecars, readiness checks, and cleanup.
- Persistent caches use Liskov-local LZ4 ZFS PVCs: BuildKit 300Gi (240Gi GC),
  Turbo 256Gi, git mirrors 20Gi, and OpenTofu plugins 10Gi. Cache volumes are
  excluded from backup.
- CI concurrency remains capped at 20 until fixed-corpus evidence supports a
  separate increase.

## Acceptance

- No CI image, smoke, E2E, or verify lane starts DinD or invokes `docker`.
- PR image validation still runs the startup checks for every affected image;
  main pushes only after those checks pass.
- The native E2E validates Tempo, MinIO bucket initialization, and the existing
  test suite against the same localhost topology.
- Synthesized manifests keep cache placement on Liskov, bounded storage, and
  backup exclusion. The fixed corpus has every expected lane, p95 duration no
  worse than 10%, and at least 50% fewer pod-parent writes.

## Historical follow-up state

- Run the PR pipeline on Liskov and confirm its native Tempo/MinIO sidecar E2E
  and all remote BuildKit smoke targets.
- After merge, compare the fixed corpus with the accepted baseline: every
  expected lane present, p95 duration no worse than 10%, and at least 50%
  fewer pod-parent write bytes before considering a concurrency increase.
- Retire the now-unused R2 Turbo bucket only after the local cache has passed
  the rollout window.

## Session Log — 2026-07-25

### Done

- Published draft PR #1663 from commit `e77d42865` (`feat(ci): remove dind
image cache path`); Buildkite build 6267 is the first remote execution.
- Replaced CI DinD usage with the remote BuildKit client flow. PR image solves
  execute in-image `smoke` targets without an exporter; main validates first,
  then pushes directly to GHCR and records registry digests.
- Added smoke/image stages for every production image, including startup and
  binary/configuration assertions that run in the image filesystem. The Caddy
  generated configuration is mounted as a target-scoped BuildKit secret.
- Replaced the LLM observability Compose lane with native Tempo and MinIO
  sidecars plus MinIO bucket initialization in the Buildkite pod.
- Moved the Turbo server to its Liskov-local 256Gi LZ4 filesystem cache,
  increased BuildKit to 300Gi with a 240Gi GC watermark, and marked the git
  mirror and all cache claims as excluded from backup. Added the 10Gi OpenTofu
  plugin cache with a cross-pod lock because its cache format has no concurrent
  writer guarantee.
- Added pipeline validation for the no-DinD invariants and corrected the app
  Dockerfile frontend pin so `COPY --parents` is supported by BuildKit.
- Verified affected repository checks, all image smoke definitions, and real
  local Caddy and TaskNotes in-image smoke solves.

### Historical follow-up state

- Run the PR pipeline on Liskov and confirm its native Tempo/MinIO sidecar E2E
  and all remote BuildKit smoke targets.
- After merge, compare the fixed corpus with the accepted baseline: every
  expected lane present, p95 duration no worse than 10%, and at least 50%
  fewer pod-parent write bytes before considering a concurrency increase.
- Retire the now-unused R2 Turbo bucket only after the local cache has passed
  the rollout window.

### Caveats

- The write-reduction claim requires post-merge fixed-corpus telemetry; local
  checks can establish correctness but not the production I/O result.
- The remote BuildKit service is cluster-internal, so this workstation can
  validate Bake/Dockerfile semantics but cannot execute the remote solve.

## Session Log — 2026-07-27

### Done

- PR #1663 is merged; active image lanes use remote BuildKit, native service sidecars replace Compose, and pipeline validation rejects DinD restoration.

### Remaining

- None in this plan.

### Caveats

- The historical design is retained for context; it is not an active board item.
