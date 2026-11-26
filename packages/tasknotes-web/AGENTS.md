# TaskNotes web constraints

This package is an online browser client of `POST /api/v1/sync`. It does not
own a database, a second task schema, or homelab routing.

- Import wire types from `@shepherdjerred/facet-protocol`. Never hand-edit
  generated protocol files.
- Do not log, persist in the repo, or put a bearer token in a URL. Session
  storage is the default; `localStorage` is only the explicit "remember" choice.
- List membership follows the macOS `FacetStoreQueries` rules: top-level tasks,
  inbox, civil due days, and tombstones from incremental sync.
