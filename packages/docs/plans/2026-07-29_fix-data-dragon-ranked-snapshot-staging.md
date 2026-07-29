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
- Committed and pushed the repair as `1dd4aa494`, and published the inspected
  before/after fixtures on PR #1827.
- Confirmed PR #1827 is mergeable with no review threads on the repaired head.
- Traced replacement Buildkite build #7151's queued state to the `liskov`
  worker: it stopped heartbeating at 11:04–11:05 PDT, is `NotReady`,
  unreachable, and cordoned, and its Talos API times out.

### Remaining

- Restore or power on `liskov`, then monitor a Buildkite build for the final PR
  head through a green result.
- Merge PR #1827 after current-head CI and automated review pass.

### Caveats

- PR #1827 is an automated Temporal bot PR, so its existing branch is updated
  directly rather than converted into a git-spice stack.
- The durable staging safeguard takes effect in automation after this PR is
  merged and the updated Temporal worker is deployed.
- Buildkite cannot execute any repository code while `liskov` is unreachable
  because CI jobs are affinity-bound to that worker; no live cluster mutation
  was attempted.
