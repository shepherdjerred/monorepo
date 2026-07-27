---
id: log-2026-07-27-pr-1689-review-fixes
type: log
status: complete
board: false
---

# PR #1689 Review Fixes

Address the current-head Codex P2 review findings on
`feature/scout-followups`, verify the affected Scout surfaces, and update the
existing pull request without merging or closing it.

## Session Log — 2026-07-27

### Done

- Consolidated identity-moving player mutations behind one
  list-cache-invalidation navigation path in
  `packages/scout-for-lol/packages/app/src/routes/player-detail.tsx`.
- Marked route-parameter validation failures explicitly so unrelated Zod
  contract violations still report to Sentry, with focused regression coverage.
- Restored templated Plausible pageviews on initial loads and SPA navigations in
  the data router's root layout.
- Reconciled the shared queue-window proposal lifecycle: reused PRs refresh
  their title/body, no-diff runs close and delete obsolete proposals, and close
  proposals disable previously armed auto-merge.
- Passed app typecheck, lint with zero errors, and all 75 app tests; passed
  Temporal typecheck, lint with zero errors, and all 693 Temporal tests.
- Committed and pushed the update to PR #1689 on
  `feature/scout-followups`.

### Remaining

- Buildkite and Codex must evaluate the newly pushed head; the controller will
  re-dispatch the PR if the new review or required checks find another blocker.

### Caveats

- `toolkit pr health` reported no CI checks and treated a branch-position hint
  as pending conflict state. Raw GitHub status, Buildkite build #6577, and
  `git merge-tree --write-tree --quiet origin/main HEAD` were used as the
  authoritative pre-fix signals.

## Workflow Friction

- `toolkit pr health 1689 --json` did not surface the existing Buildkite checks
  and reported the branch as merely behind even though `origin/main` was already
  an ancestor. Fleet control still needs raw status contexts plus the direct
  merge-tree check until that command's Buildkite/conflict reporting is fixed.
