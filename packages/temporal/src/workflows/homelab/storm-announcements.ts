import { proxyActivities } from "@temporalio/workflow";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { StormDiscordActivities } from "#activities/homelab/storm-discord.ts";

const activities = proxyActivities<StormDiscordActivities>({
  taskQueue: TASK_QUEUES.INFRA,
  startToCloseTimeout: "30 seconds",
  scheduleToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 5, initialInterval: "10 seconds" },
});

/** Daily: warns The Storm's Discord a week and a day before an active mining reset. */
export async function announceStormMiningResetCountdownWorkflow(): Promise<void> {
  await activities.announceStormMiningResetCountdown();
}

/** Tells The Storm's Discord a mining reset finished. */
export async function announceStormMiningResetDone(
  period: string,
): Promise<void> {
  await activities.announceStormMiningResetDone(period);
}
