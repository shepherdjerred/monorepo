import { TASK_QUEUES } from "#shared/task-queues.ts";

/**
 * Preserve the default queue for histories created before domain routing.
 * New executions move report delivery to the credential-scoped reports worker.
 */
export function reportActivityTaskQueue(explicitQueue?: string): string {
  if (explicitQueue !== undefined) {
    return explicitQueue;
  }
  return TASK_QUEUES.REPORTS;
}
