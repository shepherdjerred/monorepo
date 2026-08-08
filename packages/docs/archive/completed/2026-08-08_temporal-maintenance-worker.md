---
id: plan-2026-08-08-temporal-maintenance-worker
type: plan
status: complete
board: false
---

# Temporal maintenance worker

## Goal

Run Kometa and Buildkite cache maintenance entirely as Temporal activities. Temporal
owns the schedule, retry, timeout, cancellation, and observability contract; Kubernetes
only provides one persistent worker Deployment and the existing Buildkite PVCs.

## Design

- Add a `maintenance` Temporal task queue and worker role with one concurrent activity.
- Deploy one `temporal-maintenance-worker` in the `buildkite` namespace, pinned to
  `liskov`, using the existing Temporal worker image.
- Mount the Bun data/control, UV, and Trivy PVCs directly into that worker.
- Move Kometa configuration and 1Password references into the Buildkite-owned chart;
  the worker reaches Plex over the network and does not mount media resources.
- Run the four tools with direct `Bun.spawn` activities. No maintenance CronJobs,
  one-shot Jobs, kubectl calls, or Job RBAC remain.

## Verification

- Unit-test command execution, cancellation, heartbeats, non-zero exits, and metrics.
- Test maintenance worker role/queue ownership and schedule queue assignments.
- Synthesize the Buildkite and Temporal manifests, including PVC mounts, network
  policies, metrics scraping, and absence of maintenance batch resources.
- Smoke-test Kometa, UV, and Trivy in the existing Temporal image.
- After ArgoCD deployment, manually run all four workflows and verify the resulting
  Plex, cache, Trivy, and Temporal metrics behavior.

## Completion evidence

- Focused Temporal and homelab typecheck, lint, unit tests, and CDK8s synthesis pass.
- Temporal image build and CLI smoke test pass for Bun, UV, Trivy, and Kometa.
- Full Temporal tests retain three pre-existing integration failures because no local
  Temporal server is running on `127.0.0.1:7233`; the focused maintenance suite passes.
