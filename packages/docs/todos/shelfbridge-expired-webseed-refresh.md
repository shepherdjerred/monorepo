---
id: shelfbridge-expired-webseed-refresh
type: todo
status: planned
board: true
verification: agent
disposition: deferred
source_marker: false
---

# Refresh expired ShelfBridge webseeds when qBittorrent reuses a torrent

ShelfBridge webseed URLs contain an in-memory grab ID with a one-hour
`DOWNLOAD_TTL`. Re-grabbing the same book can cause qBittorrent to reuse an
existing torrent and retain its expired URL instead of replacing it with the
fresh URL.

The secure `wg0` relay fixes fresh webseed routing but intentionally does not
change duplicate-torrent behavior.

## Remaining

- [ ] Reproduce duplicate reuse after the original ShelfBridge grab ID expires.
- [ ] Determine whether Bindery, ShelfBridge, or the qBittorrent integration
      should replace the webseed URL for an existing info hash.
- [ ] Add an automated regression test covering expiry followed by re-grab.
- [ ] Verify recovery does not delete completed data or weaken qBittorrent's
      `wg0` binding.

## Comment Log

- 2026-07-29 — Split from the secure relay implementation because fresh
  downloads also stalled and required an independent routing fix.
