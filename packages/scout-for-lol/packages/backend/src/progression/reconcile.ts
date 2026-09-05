import type { ScoutStage } from "@scout-for-lol/temporal";
import { prisma } from "#src/database/index.ts";
import { launchChallengeRunRecompute } from "#src/progression/challenges/launch.ts";
import { launchHallBaseline } from "#src/progression/hall/launch.ts";
import { challengeRecomputeLag } from "#src/metrics/progression.ts";

const RECONCILIATION_BATCH_SIZE = 100;

async function reconcileChallengeRevisions(stage: ScoutStage): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const revisions = await prisma.challengeRunRevision.findMany({
      where: { revisionState: { in: ["queued", "running", "failed"] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: RECONCILIATION_BATCH_SIZE,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    });
    for (const revision of revisions) {
      await launchChallengeRunRecompute({
        stage,
        runId: revision.runId,
        revision: revision.revision,
      });
    }
    if (revisions.length < RECONCILIATION_BATCH_SIZE) return;
    const last = revisions.at(-1);
    if (last === undefined) {
      throw new Error(
        "A full challenge reconciliation page must have a cursor",
      );
    }
    cursor = last.id;
  }
}

/**
 * Replays durable database intents whose initial Temporal start may have been
 * interrupted after the transaction committed. Every workflow ID uses a
 * stable business key, so retries adopt existing work rather than duplicating
 * it.
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
  await reconcileChallengeRevisions(stage);

  const oldestRecompute = await prisma.challengeRunRevision.findFirst({
    where: { revisionState: { in: ["queued", "running"] } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  challengeRecomputeLag.set(
    oldestRecompute === null
      ? 0
      : Math.max(0, (Date.now() - oldestRecompute.createdAt.getTime()) / 1000),
  );
}
