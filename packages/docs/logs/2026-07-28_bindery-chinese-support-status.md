---
id: log-2026-07-28-bindery-chinese-support-status
type: log
status: complete
board: false
---

# Bindery Chinese Support Status

## Question

Determine whether the Bindery work for adding Chinese authors and books is
implemented, merged, deployed, and verified.

## Findings

- PR #1643 merged the in-monorepo Bindery patch and image-build path. The patch
  creates deterministic `gb:author:` synthetic authors for name-only Google
  Books results and includes positive and negative Go regression tests.
- Main CI recorded a real first-party image pin:
  `ghcr.io/shepherdjerred/bindery:2.0.0-6690@sha256:5a6c71a348d4a49ebd30ef3d00f6c8fb075f9e81f622d4f187e98fb7cf29c539`.
- The GHCR package is anonymously pullable. After the user made it public, an
  unauthenticated token request and a manifest request for the exact pinned
  digest both returned HTTP 200 on 2026-07-28.
- Main still configures the media Deployment with
  `docker.io/vavallee/bindery:v1.26.2`; PR #1759 switches the GitOps source to
  the patched first-party image.
- At the user's request, the live `media-bindery` Deployment was directly
  switched to the pinned first-party digest for testing. The rollout completed
  with one ready replica, zero restarts, version `6690`, and an external health
  response of HTTP 200 with `{"status":"ok","version":"6690"}`.
- PR #1759 contains the durable deployment and webseed-network switches; its
  expanded head passes all 34 affected verification tasks.
- A live search for `白夜行` returned multiple ShelfBridge results and Bindery
  handed four grabs to qBittorrent, proving the Chinese acquisition
  search-to-download-client path.
- Those four jobs stalled because qBittorrent shares Gluetun's network
  namespace: Gluetun replaced Kubernetes DNS and blocked the Service CIDR.
  A live patch pinned `media-shelfbridge-service` in `/etc/hosts` and allowed
  `10.96.0.0/12`; the qBittorrent pod then resolved the service and received
  HTTP 200 from `/health`.
- The already-stalled jobs still returned HTTP 404 because ShelfBridge download
  IDs are in-memory and expire after the default one-hour `DOWNLOAD_TTL`. They
  need to be removed and grabbed again after the network repair.
- A fresh direct `白夜行` smoke returned five Anna's Archive results. All five
  torrent builds failed upstream with membership-only fast download, no
  matching LibGen mirror, or HTTP 403, so no currently returned result could
  complete a fresh payload test.

## Conclusion

The Chinese search-to-download-client integration works, and the live webseed
network path is repaired. PR #1759 now carries both durable fixes. The separate
authorless Google Books add replay remains pending, and a fresh `白夜行` grab
must still prove payload download and ingest; the old jobs cannot recover
because their ShelfBridge IDs have expired.

## Session Log — 2026-07-28

### Done

- Verified PR #1643 and follow-up image-smoke fixes are merged.
- Verified the first-party image digest is recorded in `versions.ts`.
- Verified anonymous GHCR token and pinned-manifest access both return HTTP 200.
- Directly switched the live `media-bindery` Deployment to the pinned patched
  image for testing and verified rollout, pod readiness, zero restarts, image
  digest, startup logs, and the external health endpoint.
- Opened PR #1759 from the `feature/bindery-patched-deploy` git-spice stack.
- Passed `bun run verify -- --affected`: 34 successful tasks on the expanded
  PR head.
- Independently synthesized `dist/media.k8s.yaml` and verified the Bindery
  Deployment renders the exact public GHCR tag and digest.
- Diagnosed four `白夜行` grabs through Bindery, ShelfBridge, and qBittorrent:
  the torrents had valid HTTP webseeds but Gluetun blocked Kubernetes DNS and
  the Service CIDR.
- Patched the live qBittorrent Deployment with a ShelfBridge host alias and
  `FIREWALL_OUTBOUND_SUBNETS=10.96.0.0/12`; rollout completed with all three
  containers ready and zero restarts, hostname resolution succeeded, and the
  ShelfBridge health endpoint returned HTTP 200 from the qBittorrent container.
- Added the live-proven qBittorrent/ShelfBridge network configuration and
  troubleshooting guidance to PR #1759.
- Re-ran a fresh `白夜行` ShelfBridge search and attempted every returned
  download without exposing the API key; five results were found and all five
  failed at the Anna's Archive resolver before qBittorrent.

### Remaining

- Merge PR #1759.
- Remove the four expired stalled `白夜行` torrents, grab one result again, and
  verify qBittorrent payload completion followed by ingest into CWA when a
  resolvable LibGen/Z-Library result appears or source credentials are added.

### Caveats

- ArgoCD automation has no self-heal flag, so the live override currently
  persists, but a later media sync or Git revision can restore the upstream
  image until PR #1759 merges.
- Kubernetes emitted restricted-policy warnings for the existing
  `init-books-dirs` security context; enforcement did not block the rollout.
- Bindery logs warn that `/books` is read-only. That matches the External-mode
  design in which CWA owns library writes; Bindery still started healthy.
- ShelfBridge torrents can correctly show zero peer seeds; qBittorrent should
  download them from their HTTP webseed.
- ShelfBridge keeps pending grab IDs in memory for one hour by default. A 404
  from an old `/file/...` URL requires a fresh grab; connectivity alone cannot
  revive the expired ID.
- Current `白夜行` availability is provider-limited: the five fresh results
  were Anna's Archive metadata records without anonymously resolvable files.
