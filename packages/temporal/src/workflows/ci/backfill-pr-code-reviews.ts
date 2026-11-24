import { proxyActivities } from "@temporalio/workflow";
import type { CodeReviewActivities } from "#activities/ci/code-review.ts";
import type {
  BackfillOpenPrCodeReviewsInput,
  BackfillOpenPrCodeReviewsResult,
} from "#shared/ci/code-review.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { listOpenMainPrsForCodeReview, startPrCodeReviewWorkflow } =
  proxyActivities<CodeReviewActivities>({
    taskQueue: TASK_QUEUES.CODE_REVIEW,
    startToCloseTimeout: "2 minutes",
    retry: {
      maximumAttempts: 3,
      initialInterval: "5 seconds",
    },
  });

/**
 * One-shot backfill workflow that enumerates open non-draft PRs targeting
 * `main` and starts `prCodeReviewWorkflow` for each.
 */
export async function backfillOpenPrCodeReviewsWorkflow(
  input: BackfillOpenPrCodeReviewsInput,
): Promise<BackfillOpenPrCodeReviewsResult> {
  const openPrs = await listOpenMainPrsForCodeReview({
    owner: input.owner,
    repo: input.repo,
  });
  for (const pr of openPrs) {
    await startPrCodeReviewWorkflow({
      owner: input.owner,
      repo: input.repo,
      prNumber: pr.prNumber,
      headSha: pr.headSha,
      baseRef: pr.baseRef,
    });
  }
  return {
    startedCount: openPrs.length,
    prNumbers: openPrs.map((pr) => pr.prNumber),
  };
}
