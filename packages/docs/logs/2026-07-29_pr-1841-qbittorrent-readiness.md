---
id: log-pr-1841-qbittorrent-readiness-2026-07-29
type: log
status: in-progress
board: false
---

# PR 1841 qBittorrent Readiness Remediation

## Objective

Remediate the current review finding on PR #1841 so a ShelfBridge outage does
not make qBittorrent unready, while preserving the relay behavior and retaining
a readiness signal for qBittorrent's own health.

## Evidence

- Dispatched head: `e70d2b183ea9b17299d4051f95ed83c06bf1d6ad`.
- Assigned worktree:
  `.claude/worktrees/qbittorrent-shelfbridge-relay`.
- The worktree was clean and checked out on
  `feature/qbittorrent-shelfbridge-relay` before remediation began.

## Session Log — 2026-07-29

### Done

- Decoupled the HAProxy sidecar's startup, liveness, and readiness probes from
  ShelfBridge backend availability while retaining `/health` as the explicit
  backend-health signal.
- Added a qBittorrent WebUI readiness probe so the pod's Services still stop
  routing when qBittorrent's own listener is unavailable.
- Added rendered-manifest assertions for relay-local readiness, backend-health
  reporting, and qBittorrent-local unready behavior.
- Passed the focused qBittorrent test, scoped cdk8s typecheck, lint/synthesis,
  and the complete cdk8s package test suite (276 passed, 13 configured skips,
  0 failed).

### Remaining

- Publish the verified fix to PR #1841, resolve the addressed review thread,
  request a current-head hosted Codex review, and let the fleet controller
  reconcile replacement CI when the shared Buildkite cache PVC is available.

### Caveats

- Buildkite build #7176 failed before pipeline upload because the shared Bun
  cache PVC is full. This PR does not change or retry that shared
  infrastructure.
- No live Kubernetes resource was mutated; deployment remains entirely through
  the existing GitOps flow.
