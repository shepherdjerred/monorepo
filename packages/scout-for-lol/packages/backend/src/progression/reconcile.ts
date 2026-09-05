import type { ScoutStage } from "@scout-for-lol/temporal";
import { prisma } from "#src/database/index.ts";
import { launchHallBaseline } from "#src/progression/hall/launch.ts";

const RECONCILIATION_BATCH_SIZE = 100;

/**
 * Replays durable Hall baseline intents whose initial Temporal start may have
 * been interrupted after the transaction committed.
 */
export async function reconcileCompetitiveProgression(
  stage: ScoutStage,
): Promise<void> {
  const hallRuns = await prisma.hallBaselineRun.findMany({
    where: { baselineState: "building" },
    orderBy: { createdAt: "asc" },
    take: RECONCILIATION_BATCH_SIZE,
  });

  for (const run of hallRuns) {
    await launchHallBaseline(stage, {
      guildId: run.guildId,
      revision: run.revision,
      workflowId: run.workflowId,
      reused: true,
    });
  }
}
