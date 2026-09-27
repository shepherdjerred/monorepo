import { log, proxyActivities } from "@temporalio/workflow";
import type { MiningResetActivities } from "#activities/homelab/mining-reset.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { resetMiningWorld } = proxyActivities<MiningResetActivities>({
  taskQueue: TASK_QUEUES.MINING_RESET,
  startToCloseTimeout: "3 hours",
  heartbeatTimeout: "2 minutes",
  retry: {
    maximumAttempts: 2,
    initialInterval: "1 minute",
  },
});

export async function runMiningWorldResetWorkflow(): Promise<void> {
  // Temporal's Workflow clock is deterministic. The period also becomes the
  // Backup and Job name, so a replay/retry resumes the same external effects.
  const now = new Date();
  const period = `${String(now.getUTCFullYear())}q${String(Math.floor(now.getUTCMonth() / 3) + 1)}`;
  const result = await resetMiningWorld(period);
  log.info(result);
}
