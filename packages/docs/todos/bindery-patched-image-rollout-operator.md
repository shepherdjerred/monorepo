---
id: bindery-patched-image-rollout-operator
type: todo
status: in-progress
board: true
verification: operator
disposition: blocked
origin: packages/docs/archive/completed/2026-07-25_bindery-fork-chinese-add.md
---

# Complete the privileged Bindery patched-image rollout checks

## Context

PR #1643 built and published the first-party image path. The GHCR package is
publicly pullable, PR #1759 merged, and the durable deployment is Ready on the
first-party pinned image. Final validation uses the restricted production
Bindery API and media pipeline.

## Remaining

- [x] Make `ghcr.io/shepherdjerred/bindery` public and verify anonymous access to the pinned digest.
- [ ] After the agent-authored deployment switch merges, replay the Chinese Google Books add and confirm HTTP 201 plus Wanted → ShelfBridge → qBittorrent → ingest → CWA flow.
- [ ] Confirm the Bindery UI no longer returns 422 for the same Chinese selection.
- [ ] Re-test a fresh Chinese grab when ShelfBridge returns a resolvable LibGen/Z-Library result, or configure credentials for a source that can resolve the current Anna's Archive results.

## Comment Log

### 2026-07-28 — public package and temporary live smoke

- Anonymous token and exact pinned-manifest requests returned HTTP 200.
- The pinned image rolled out directly to the live Deployment with one ready
  replica, zero restarts, and external health reporting version `6690`.
- The API/UI Chinese-add replay remains pending after the durable GitOps switch.

### 2026-07-28 — `白夜行` webseed diagnosis

- Bindery handed four `白夜行` grabs to qBittorrent as ShelfBridge webseed
  torrents. Zero BitTorrent seeds is expected for this result type.
- Gluetun blocked Kubernetes DNS and the Service CIDR. A live qBittorrent patch
  added the ShelfBridge host alias and allowed `10.96.0.0/12`; in-pod
  ShelfBridge health then returned HTTP 200. PR #1759 carries the same durable
  configuration.
- The four old webseed IDs had exceeded ShelfBridge's one-hour in-memory TTL,
  so they cannot recover and must be re-grabbed.
- A fresh direct `白夜行` smoke returned five Anna's Archive results, but all
  five torrent builds failed upstream: membership-only fast download, no
  LibGen mirror, or HTTP 403. The network path is fixed; current source
  availability still blocks payload completion.

### 2026-07-27 — split from active implementation plan

- Package visibility and production API/media validation are privileged operator work; the deployment edit remains agent-owned in the parent plan.

### 2026-08-02 — durable rollout confirmed

- Confirmed PR #1759 merged with green exact-head Buildkite #6712.
- Confirmed the `media` Argo application is `Synced`/`Healthy` and Bindery is Ready on `ghcr.io/shepherdjerred/bindery:2.0.0-6874@sha256:2833…`.
- The remaining restricted API, UI, and media-chain checks are now the only work on this card.
