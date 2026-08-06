---
id: temporal-pr-reaction-listener-cleanup
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/archive/completed/2026-07-30_remove-pr-review-bot.md
---

# Terminate the orphaned Temporal PR reaction listener

## Context

PR #1863 removed the PR review bot worker and merged with green exact-head CI. The production `prReactionListener` execution predates that removal and continues-as-new indefinitely, but no deployed worker polls its removed task queue. It is therefore stranded in `Running` and requires an explicitly authorized production mutation.

The 2026-08-02 board audit found workflow ID `pr-review-reaction-listener`, run ID `1f888075-3599-4a7c-9b8b-8222cb0563a2`, started `2026-07-30T23:15:47.494916184Z`. No other running execution of `prReviewPipeline`, `prSummaryPipeline`, or `prBabysitWorkflow` was present.

## Remaining

- [ ] With explicit operator authorization, terminate workflow ID `pr-review-reaction-listener` with reason `pr-review reaction-listener removed (PR #1863)`.
- [ ] Confirm the workflow is no longer running and recheck that no removed PR-bot workflow types remain.
- [ ] Mark this todo complete and move it to `packages/docs/archive/completed/`.

## Comment Log

### 2026-08-02 — split from completed implementation plan

- PR #1863 is merged, its exact-head Buildkite build #7393 is green, and the newer Temporal worker is deployed.
- The remaining action is a privileged production termination, so it is blocked on explicit operator authorization rather than left in an agent-owned implementation plan.
