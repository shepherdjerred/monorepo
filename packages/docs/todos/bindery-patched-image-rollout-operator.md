---
id: bindery-patched-image-rollout-operator
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/plans/2026-07-25_bindery-fork-chinese-add.md
---

# Complete the privileged Bindery patched-image rollout checks

## Context

PR #1643 built and published the first-party image path. The GHCR package is
publicly pullable and the pinned image passed a temporary live deployment
smoke. Final validation uses the restricted production Bindery API and media
pipeline after the durable deployment switch merges.

## Remaining

- [x] Make `ghcr.io/shepherdjerred/bindery` public and verify anonymous access to the pinned digest.
- [ ] After the agent-authored deployment switch merges, replay the Chinese Google Books add and confirm HTTP 201 plus Wanted → ShelfBridge → qBittorrent → ingest → CWA flow.
- [ ] Confirm the Bindery UI no longer returns 422 for the same Chinese selection.

## Comment Log

### 2026-07-28 — public package and temporary live smoke

- Anonymous token and exact pinned-manifest requests returned HTTP 200.
- The pinned image rolled out directly to the live Deployment with one ready
  replica, zero restarts, and external health reporting version `6690`.
- The API/UI Chinese-add replay remains pending after the durable GitOps switch.

### 2026-07-27 — split from active implementation plan

- Package visibility and production API/media validation are privileged operator work; the deployment edit remains agent-owned in the parent plan.
