# merge-conflict-check fixture

This PR is the standing fixture for the `ci/merge-conflict` status-check feature.

DO NOT MERGE. DO NOT CLOSE.

It exists so the Temporal worker has a stable open PR head SHA to:

- spike-test commit-status overwrites during initial development (Phase 0b);
- smoke-test the production rollout of the merge-conflict check workflow.

If this file or PR ever feels in the way, ping the most recent contributor to
`packages/temporal/src/activities/check-pr-merge-conflicts.ts` before touching it.
