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

- Initial dispatched head: `e70d2b183ea9b17299d4051f95ed83c06bf1d6ad`.
- Follow-up dispatched head: `059023bc07f42d9e99ae565a02e3ae7637e2a8e1`.
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
- Kept only the metrics Service endpoint discoverable through qBittorrent
  readiness failures, preserving `qbittorrent_up=0` scrapes while the WebUI
  Service remains readiness-gated.
- Added synthesis assertions that distinguish the metrics Service's
  `publishNotReadyAddresses: true` behavior from the WebUI Service default.
- Published the focused follow-up through the existing git-spice branch,
  resolved only the addressed P2 review thread, and requested one hosted Codex
  review for the resulting head.
- Passed the focused qBittorrent test, scoped cdk8s typecheck, lint/synthesis,
  and the complete cdk8s package test suite (276 passed, 13 configured skips,
  0 failed).
- Passed the docs model check across 1,038 Markdown documents.

### Remaining

- Await current-head hosted review and replacement Buildkite results; the fleet
  controller owns ongoing reconciliation.

### Caveats

- The predecessor-head Buildkite build #7274 failed during dependency setup
  because the shared Bun cache PVC is full. This PR does not change or retry
  that shared infrastructure.
- No live Kubernetes resource was mutated; deployment remains entirely through
  the existing GitOps flow.
