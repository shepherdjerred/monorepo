---
id: bindery-cwa-transliterated-library-reconcile
type: todo
status: complete
board: false
source_marker: false
---

# Reconcile CWA-transliterated library paths in Bindery

Bindery external handoff successfully copied a Chinese EPUB to `/ingest`, and
CWA imported it into the Calibre library. CWA transliterated the Chinese
author/title in the managed filesystem path, so Bindery's subsequent library
scan reported `files_found=1`, `unmatched=1` and left the queue item in
`importExternal`.

The file is safely present in Calibre. Do not re-import or move it merely to
clear the Bindery queue state.

## Resolution

Obsolete. The ebook stack was removed from the homelab, so there is no Bindery queue to reconcile and no CWA library to attach against.

Outstanding when retired:

- Reproduce the mismatch with a fixture containing Chinese embedded
  metadata and a CWA-style transliterated destination path.
- Decide whether reconciliation should use a stable Calibre identifier,
  embedded metadata, or an explicit attach-existing-file API.
- Add regression coverage that attaches the existing managed file without
  copying it back through `/ingest`.
- Reconcile the live book and retire the stale `importExternal` queue item
  after the safe path is implemented.

## Comment Log

- 2026-07-29 — Discovered during the first successful
  qBittorrent → Bindery → CWA Chinese EPUB handoff. Direct database mutation
  and duplicate re-import were rejected because the Calibre copy is already
  correct.

- 2026-08-11 — Retired with the ebook stack. Bindery, Calibre-Web Automated, ShelfBridge, and the qBittorrent webseed relay were removed from the homelab, so this work is obsolete and will not be implemented. Preserved for the rationale behind the storage and backup artifacts the removal retained.
