---
id: log-2026-07-26-pr-1676-scout-quiet-version-banner
type: log
status: in-progress
board: false
---

# PR #1676 Scout quiet version banner review remediation

## Context

Address the review-gate findings for the owner-only, fixed-position contract
mismatch indicator without changing its quiet or persistent-dismiss behavior.

## Session Log — 2026-07-26

### Done

- Inspected PR health, the Buildkite review findings, and an independent
  merge-tree check against `origin/main`.
- Moved the owner authorization decision to the public `/api/version` endpoint,
  using its signed session cookie and the backend's central debug-owner flag.
  The SPA no longer duplicates the owner identifier or calls `auth.meWeb`.
- Preserved the fixed corner placement and dismissal keyed to the contract-hash
  pair; added endpoint/schema coverage for the server-provided authorization
  field's unauthenticated default.
- Verified backend and app typechecks, changed-file lint, focused backend and
  app tests, and Prettier formatting.

### Remaining

- Await Buildkite and review-gate results after the remediation is pushed.

### Caveats

- The independent merge-tree check against the current `origin/main` is clean.
