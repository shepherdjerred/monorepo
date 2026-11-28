import { proxyActivities } from "@temporalio/workflow";
import type { OpsCiDashboardActivities } from "#activities/ops/ci-dashboard/activities.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { collectAndPublishCiDashboard } =
  proxyActivities<OpsCiDashboardActivities>({
    taskQueue: TASK_QUEUES.OPS,
    startToCloseTimeout: "40 seconds",
    scheduleToCloseTimeout: "42 seconds",
    retry: { maximumAttempts: 1 },
  });

const { refreshCiDashboardTimings } = proxyActivities<OpsCiDashboardActivities>(
  {
    taskQueue: TASK_QUEUES.OPS,
    startToCloseTimeout: "100 seconds",
    scheduleToCloseTimeout: "110 seconds",
    retry: { maximumAttempts: 1 },
  },
);

export async function runOpsCiDashboard(): Promise<void> {
  await collectAndPublishCiDashboard();
}

export async function runOpsCiDashboardTimings(): Promise<void> {
  await refreshCiDashboardTimings();
}
