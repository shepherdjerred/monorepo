import { proxyActivities } from "@temporalio/workflow";
import type { RedditOutreachActivities } from "#activities/promotion/reddit-sweep.ts";
import type { reconcileRedditOutreachReply } from "#activities/promotion/reddit-outreach/reconcile.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const outreach = proxyActivities<RedditOutreachActivities>({
  taskQueue: TASK_QUEUES.PROMOTION,
  startToCloseTimeout: "14 minutes",
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 1 },
});

/** The durable effect journal handles ambiguity; a failed write is never retried. */
export async function runStormRedditOutreach(
  input: { preview?: boolean } = {},
) {
  return await outreach.sweepRedditOutreach(input);
}

const reconcile = proxyActivities<{
  reconcileRedditOutreachReply: typeof reconcileRedditOutreachReply;
}>({
  taskQueue: TASK_QUEUES.PROMOTION,
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});

export async function reconcileStormRedditReply(input: {
  postId: string;
  commentUrl: string;
}) {
  return await reconcile.reconcileRedditOutreachReply(input);
}
