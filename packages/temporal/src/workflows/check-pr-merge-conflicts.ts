import { proxyActivities } from "@temporalio/workflow";
import type { CheckPrMergeConflictsActivities } from "#activities/check-pr-merge-conflicts.ts";
import type {
  CheckPrMergeConflictsInput,
  // imported only for the inferred return type's reach
} from "#shared/schemas.ts";

const { runCheckPrMergeConflicts } =
  proxyActivities<CheckPrMergeConflictsActivities>({
    startToCloseTimeout: "10 minutes",
    heartbeatTimeout: "90 seconds",
    retry: {
      maximumAttempts: 5,
      initialInterval: "5s",
      backoffCoefficient: 2,
      maximumInterval: "60s",
    },
  });

/**
 * Walks open PRs and posts a `ci/merge-conflict` commit status per PR computed
 * from a local `git merge-tree` (never GitHub's lazy `mergeable` field).
 * Triggered by the GitHub webhook on push-to-main (`kind: all-prs`) and on
 * per-PR events (`kind: single-pr`). See
 * packages/docs/plans/2026-06-14_pr-merge-conflict-check.md.
 */
export async function checkPrMergeConflictsWorkflow(
  input: CheckPrMergeConflictsInput,
): Promise<void> {
  await runCheckPrMergeConflicts(input);
}
