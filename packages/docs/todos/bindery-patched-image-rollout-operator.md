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

PR #1643 built and published the first-party image path. The deployment switch
must wait until the GHCR package is publicly pullable; final validation uses the
restricted production Bindery API and media pipeline.

## Remaining

- [ ] Make `ghcr.io/shepherdjerred/bindery` public and verify anonymous access to the pinned digest.
- [ ] After the agent-authored deployment switch merges, replay the Chinese Google Books add and confirm HTTP 201 plus Wanted → ShelfBridge → qBittorrent → ingest → CWA flow.
- [ ] Confirm the Bindery UI no longer returns 422 for the same Chinese selection.

## Comment Log

### 2026-07-27 — split from active implementation plan

- Package visibility and production API/media validation are privileged operator work; the deployment edit remains agent-owned in the parent plan.
