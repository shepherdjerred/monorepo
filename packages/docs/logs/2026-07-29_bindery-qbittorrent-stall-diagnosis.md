---
id: log-bindery-qbittorrent-stall-diagnosis-2026-07-29
type: log
status: complete
board: false
---

# Bindery qBittorrent stall diagnosis

## Context

Investigate Chinese book grabs that reached qBittorrent but remained stalled at
0.0%, distinguishing ShelfBridge URL expiry, in-cluster routing, and upstream
provider failures.

## Session Log — 2026-07-29

### Done

- Confirmed the live `media` ArgoCD application is Synced and Healthy.
- Confirmed Bindery, ShelfBridge, and qBittorrent pods are Running.
- Confirmed ShelfBridge retains ClusterIP `10.109.78.226`.
- Confirmed qBittorrent can reach ShelfBridge at that ClusterIP.
- Confirmed all four stalled `白夜行` torrents have ShelfBridge webseeds that
  return HTTP 404.
- Correlated the selected 860.1 KiB result with Bindery's 2026-07-29 10:25
  auto-grab. Bindery reused torrent
  `01fff98dcd929ca5f915249cd779e965ad85b528`, which retained its expired
  ShelfBridge download URL and had downloaded zero bytes.
- Identified an initial failure mode: qBittorrent duplicate reuse preserves an
  expired one-hour ShelfBridge webseed URL instead of refreshing or replacing
  it.
- After the operator removed and re-added the torrents, confirmed all four new
  webseed URLs returned HTTP 200 with the expected complete byte counts.
- Confirmed ShelfBridge supports range requests correctly and that every SHA-1
  piece hash in the 860.1 KiB torrent matches the served payload.
- Confirmed qBittorrent selects the single file for download and connects to
  ShelfBridge as a web peer, but transfers zero bytes.
- Identified the primary root cause: committed qBittorrent config securely pins
  `Session\Interface` and `Session\InterfaceName` to `wg0`, but ShelfBridge is
  only reachable through the pod's `eth0` Kubernetes service route. A
  ShelfBridge range request bound to `wg0` times out, while the same request
  bound to `eth0` returns HTTP 206 and the complete requested piece.
- Rejected changing qBittorrent to Any interface because preserving an
  application-level VPN binding is a required defense-in-depth control.
- Confirmed both an unbound public request and a request bound to the WireGuard
  IP use the AirVPN exit address. Also confirmed the current Gluetun firewall
  has a default-deny output policy and only allows Kubernetes service traffic
  from the pod's `eth0` address.
- Implemented a fixed-destination HAProxy relay that qBittorrent reaches through
  `wg0` and that forwards only to ShelfBridge's pinned ClusterIP.
- Added manifest regression tests that preserve both committed `wg0` bindings
  and the Gluetun firewall exception.
- Published draft PR
  [#1841](https://github.com/shepherdjerred/monorepo/pull/1841); it is
  conflict-free against the current `origin/main` and has no review threads.
- Applied the explicitly authorized temporary relay override and verified the
  live pod is 4/4 Ready with the exact pinned HAProxy digest.
- Verified qBittorrent remains bound to `wg0`, Gluetun retains `OUTPUT DROP`,
  the VPN-bound public exit is unchanged, and explicit `eth0` public egress
  fails.
- Confirmed the affected 860 KiB Chinese EPUB completed through the relay.
- Diagnosed the subsequent Bindery import block: the obsolete
  `calibre.drop_folder_path` setting did not select external import, so Bindery
  tried to write its intentionally read-only `/books` mount.
- Set `import.mode=external` and `import.drop_folder=/ingest`, retried only the
  fresh queue item, and verified CWA repaired and imported the EPUB into its
  Calibre library.
- Verified CWA's scheduled Send-to-Kindle job executed successfully.
- Reconciled the committed qBittorrent concurrency limits to the existing live
  `20/20/40` values after the restart guard surfaced that drift.

### Remaining

- Pass the Buildkite PR gate and obtain human merge of the GitOps relay change.
- After merge, verify the durable GitOps rollout returns ArgoCD to Synced.
- Resolve
  [`bindery-cwa-transliterated-library-reconcile`](../todos/bindery-cwa-transliterated-library-reconcile.md)
  without moving or duplicate-importing the existing Calibre file.
- Implement the separately tracked
  [`shelfbridge-expired-webseed-refresh`](../todos/shelfbridge-expired-webseed-refresh.md)
  follow-up; duplicate reuse is real but did not explain freshly re-added
  torrents.

### Caveats

- A fresh grab can still fail if the upstream Anna's Archive or LibGen source
  cannot resolve or serve the payload.
- Do not replace the `wg0` binding with Any interface. Gluetun's kill switch is
  effective, but it should remain a second independent control rather than the
  only IP-leak boundary.
- The user explicitly authorized the temporary live override while CI was
  unavailable. ArgoCD is Healthy but OutOfSync until PR #1841 ships.
- CWA's Calibre import succeeded, but Bindery's library scan reported one
  unmatched file because the managed path was transliterated; the queue item
  remains `importExternal`.
- CWA logged a missing `book_format_checksums` table during its optional KOReader
  checksum task; Calibre import and Kindle delivery were unaffected.
- Buildkite build #7163 remained scheduled because `liskov` was cordoned and
  `Ready=Unknown`; no repository job had started or failed.
