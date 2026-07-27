---
id: pr-babysit-administration-read
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/todos/babysit-phase4-live-retest.md
source_marker: false
---

# Optionally grant the PR babysitter Administration read access

The babysitter already treats repository rulesets as authoritative when the
classic branch-protection endpoint returns 403. Administration read access is
therefore optional belt-and-suspenders access, not a live-test prerequisite.

## Remaining

- [ ] Decide whether direct classic-protection visibility is worth expanding the GitHub App permission scope.
- [ ] If approved, update the GitHub App in its settings UI and verify the next installation token can read classic protection; otherwise record the decision and archive this todo.
