import { log, patched, proxyActivities, sleep } from "@temporalio/workflow";
import type { MiningResetActivities } from "#activities/homelab/mining-reset.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { announceStormMiningResetDone } from "./storm-announcements.ts";

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
  // A busy player server is an expected deferral, not an Activity failure.
  // Four hours of durable waits leave three hours in the schedule execution
  // window for the isolated snapshot and reset Job once it hibernates.
  for (let attempt = 0; attempt <= 48; attempt += 1) {
    const result = await resetMiningWorld(period);
    if (result.kind === "completed") {
      log.info(result.message);
      // Histories recorded before the Discord notice existed replay without it.
      if (patched("storm-reset-discord-notice")) {
        try {
          await announceStormMiningResetDone(period);
        } catch (error) {
          // The reset is done; a missed announcement must not fail it.
          log.warn("Announcing the mining reset on Discord failed", { error });
        }
      }
      return;
    }
    if (attempt === 48) {
      throw new Error(
        `The Storm server stayed active through the reset window for ${period}`,
      );
    }
    await sleep("5 minutes");
  }
}
