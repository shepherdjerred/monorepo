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
