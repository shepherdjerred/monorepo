import { proxyActivities } from "@temporalio/workflow";
import type { QualityGuideActivities } from "@shepherdjerred/media/quality-guide";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const guide = proxyActivities<QualityGuideActivities>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "2 minutes",
  startToCloseTimeout: "15 minutes",
  scheduleToCloseTimeout: "20 minutes",
  retry: { maximumAttempts: 1 },
});

/** A new workflow leaves retained acquisition histories unchanged. */
export async function refreshMediaQualityGuidesWorkflow() {
  return guide.refreshMediaQualityGuides();
}
