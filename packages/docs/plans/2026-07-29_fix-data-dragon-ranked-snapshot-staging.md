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

## Session Log — 2026-07-29

### Done

- Created an isolated worktree at
  `.claude/worktrees/pr-1827-data-dragon-fix` from PR #1827 head
  `1960ca58890f65f282aa706f59bc34471505e404`.
- Regenerated the ranked banner and square SVG/hash snapshots from Data Dragon
  16.15.1 and confirmed all 13 direct ranked report tests pass.
- Expanded the Temporal updater's generated path set to every report HTML
  snapshot directory and added a full-tree, fail-closed allowlist check before
  staging.
- Added regression tests for ranked snapshot classification, future snapshot
  directories, disallowed report source changes, and rename paths.
- Passed focused Temporal/report tests, typechecks, lints, Prettier, and diff
  whitespace checks.
- Passed the staged-file pre-commit gate, including Gitleaks, Prettier, and
  repository safety checks.
- Rendered and inspected before/after banner and square fixtures for PR
  evidence.

### Remaining

- Commit and push the repair to PR #1827.
- Publish the inspected visual evidence and monitor replacement CI and review.

### Caveats

- PR #1827 is an automated Temporal bot PR, so its existing branch is updated
  directly rather than converted into a git-spice stack.
- The durable staging safeguard takes effect in automation after this PR is
  merged and the updated Temporal worker is deployed.
