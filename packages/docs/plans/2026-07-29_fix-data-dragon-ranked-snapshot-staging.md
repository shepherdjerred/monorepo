---
id: plan-data-dragon-ranked-snapshot-staging
type: plan
status: in-progress
board: false
---

# Fix Data Dragon Ranked Snapshot Staging

## Summary

Repair PR #1827 by committing the ranked-report snapshots regenerated from its
Data Dragon 16.15.1 assets. Harden the Temporal updater so future generated
snapshot paths cannot be silently omitted from an automated PR.

## Implementation

- Regenerate and review the ranked banner and square SVG/hash snapshots.
- Stage all Scout HTML snapshot directories with a constrained Git pathspec.
- Compare unrestricted updater changes with the allowlisted changes and fail
  before commit when a path would be omitted.
- Treat modified ranked visual snapshots like arena visual snapshots for the
  image-only refresh decision while keeping additions, deletions, and renames
  PR-worthy.
- Add regression coverage for staging omissions and ranked snapshot
  classification.

## Verification

- Run ranked banner and square integration tests without snapshot-update mode.
- Run focused report and Temporal tests, typechecks, and lints.
- Run the staged-file pre-commit hook.
- Inspect and publish rendered before/after evidence on PR #1827.
- Monitor the replacement Buildkite build and current-head review state.
