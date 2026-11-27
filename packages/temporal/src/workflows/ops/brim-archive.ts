import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "#activities/ops/brim/refresh.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { refreshBrimArchive } = proxyActivities<typeof activities>({
  taskQueue: TASK_QUEUES.INFRA,
  startToCloseTimeout: "30 minutes",
  scheduleToCloseTimeout: "40 minutes",
  retry: { maximumAttempts: 3 },
});

export async function runBrimArchiveRefresh(): Promise<void> {
  await refreshBrimArchive();
}
