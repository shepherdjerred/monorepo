# TaskNotes web constraints

This package is a browser client of `POST /api/v1/sync`. The server owns
canonical task data. Browser storage retains Facet wire data, drafts, and
outgoing commands for the active workspace.

- Import wire types from `@shepherdjerred/facet-protocol`. Never hand-edit
  generated protocol files.
- Do not log, persist in the repo, or put a bearer token in a URL. Session
  storage is the default; `localStorage` is only the explicit "remember" choice.
- Keep authenticated API responses and private files out of the service-worker cache.
- List membership follows the macOS `FacetStoreQueries` rules: top-level tasks,
  inbox, civil due days, and tombstones from incremental sync.
