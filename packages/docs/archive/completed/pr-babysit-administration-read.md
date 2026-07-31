---
id: pr-babysit-administration-read
type: todo
status: complete
board: false
origin: packages/docs/archive/completed/babysit-phase4-live-retest.md
source_marker: false
---

# Optionally grant the PR babysitter Administration read access

The babysitter already treats repository rulesets as authoritative when the
classic branch-protection endpoint returns 403. Administration read access is
therefore optional belt-and-suspenders access, not a live-test prerequisite.

## Remaining

- [ ] Decide whether direct classic-protection visibility is worth expanding the GitHub App permission scope.
- [ ] If approved, update the GitHub App in its settings UI and verify the next installation token can read classic protection; otherwise record the decision and archive this todo.

## Comment Log

### 2026-07-30 — resolved by PR-bot removal

- The PR babysitter was removed entirely (see [[babysit-phase4-live-retest]]), so this optional GitHub App permission expansion is no longer relevant. Marked `complete` and archived; no permission change was made.
