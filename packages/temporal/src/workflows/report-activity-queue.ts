import { patched } from "@temporalio/workflow";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const REPORT_ACTIVITY_QUEUE_PATCH = "report-activity-reports-queue-v1";

/**
 * Preserve the default queue for histories created before domain routing.
 * New executions move report delivery to the credential-scoped reports worker.
 */
export function reportActivityTaskQueue(explicitQueue?: string): string {
  if (explicitQueue !== undefined) {
    return explicitQueue;
  }
  // Preserve the marker for executions that already recorded it. Activity
  // task-queue attributes are replay-compatible, so both history branches can
  // now use the credential-scoped reports queue.
  patched(REPORT_ACTIVITY_QUEUE_PATCH);
  return TASK_QUEUES.REPORTS;
}
