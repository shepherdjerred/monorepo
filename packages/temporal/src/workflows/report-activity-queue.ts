import { TASK_QUEUES } from "#shared/task-queues.ts";

/**
 * Route report activities to the credential-scoped reports worker.
 */
export function reportActivityTaskQueue(explicitQueue?: string): string {
  if (explicitQueue !== undefined) {
    return explicitQueue;
  }
  return TASK_QUEUES.REPORTS;
}
