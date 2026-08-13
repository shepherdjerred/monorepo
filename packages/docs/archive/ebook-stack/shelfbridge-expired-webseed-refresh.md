---
id: shelfbridge-expired-webseed-refresh
type: todo
status: complete
board: false
source_marker: false
---

# Refresh expired ShelfBridge webseeds when qBittorrent reuses a torrent

ShelfBridge webseed URLs contain an in-memory grab ID with a one-hour
`DOWNLOAD_TTL`. Re-grabbing the same book can cause qBittorrent to reuse an
existing torrent and retain its expired URL instead of replacing it with the
fresh URL.

The secure `wg0` relay fixes fresh webseed routing but intentionally does not
change duplicate-torrent behavior.

## Resolution

Obsolete. ShelfBridge and the qBittorrent webseed relay were removed from the homelab, so expired webseed reuse can no longer occur.

Outstanding when retired:

- Reproduce duplicate reuse after the original ShelfBridge grab ID expires.
- Determine whether Bindery, ShelfBridge, or the qBittorrent integration
  should replace the webseed URL for an existing info hash.
- Add an automated regression test covering expiry followed by re-grab.
- Verify recovery does not delete completed data or weaken qBittorrent's
  `wg0` binding.

## Comment Log

- 2026-07-29 — Split from the secure relay implementation because fresh
  downloads also stalled and required an independent routing fix.

- 2026-08-11 — Retired with the ebook stack. Bindery, Calibre-Web Automated, ShelfBridge, and the qBittorrent webseed relay were removed from the homelab, so this work is obsolete and will not be implemented. Preserved for the rationale behind the storage and backup artifacts the removal retained.
