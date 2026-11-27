import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "#activities/ops/brim/refresh.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { refreshBrimArchive } = proxyActivities<typeof activities>({
  taskQueue: TASK_QUEUES.INFRA,
  // The first refresh downloads and verifies each workstation's full archive.
  startToCloseTimeout: "2 hours",
  scheduleToCloseTimeout: "3 hours",
  retry: { maximumAttempts: 3 },
});

export async function runBrimArchiveRefresh(): Promise<void> {
  await refreshBrimArchive();
}
