import type { ScoutStage } from "@scout-for-lol/temporal";
import { prisma } from "#src/database/index.ts";
import { launchChallengeRunRecompute } from "#src/progression/challenges/launch.ts";
import { advanceDuelEvent } from "#src/progression/duels/advancement.ts";
import { signalDuelSeries } from "#src/progression/duels/launch.ts";
import { launchHallBaseline } from "#src/progression/hall/launch.ts";
import {
  challengeRecomputeLag,
  duelSeriesState,
} from "#src/metrics/progression.ts";

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

async function reconcileDuelSeries(stage: ScoutStage): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const seriesPage = await prisma.duelSeries.findMany({
      where: {
        deadlineAt: { not: null },
        seriesState: {
          in: [
            "awaiting_acceptance",
            "scheduled",
            "awaiting_readiness",
            "provisioning_code",
            "code_ready",
            "in_progress",
          ],
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: RECONCILIATION_BATCH_SIZE,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    });
    for (const series of seriesPage) {
      if (series.deadlineAt === null) {
        throw new Error("A reconcilable duel series has no deadline");
      }
      await signalDuelSeries({
        stage,
        seriesId: series.id,
        deadlineAt: series.deadlineAt,
        requestId: `reconcile-duel:${series.id}`,
      });
    }
    if (seriesPage.length < RECONCILIATION_BATCH_SIZE) return;
    const last = seriesPage.at(-1);
    if (last === undefined) {
      throw new Error("A full duel reconciliation page must have a cursor");
    }
    cursor = last.id;
  }
}

async function reconcileDuelEvents(stage: ScoutStage): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const events = await prisma.duelEvent.findMany({
      where: { eventState: "in_progress" },
      include: {
        series: {
          where: {
            seriesState: "completed",
            winnerCompetitorId: { not: null },
          },
          orderBy: { completedAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: RECONCILIATION_BATCH_SIZE,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    });
    for (const event of events) {
      if (event.series[0] !== undefined) {
        await advanceDuelEvent(event.id, stage);
      }
    }
    if (events.length < RECONCILIATION_BATCH_SIZE) return;
    const last = events.at(-1);
    if (last === undefined) {
      throw new Error("A full duel-event reconciliation page needs a cursor");
    }
    cursor = last.id;
  }
}

/**
 * Replays durable database intents whose initial Temporal start may have been
 * interrupted after the transaction committed. Every workflow ID and bracket
 * slot uses a stable business key, so retries adopt existing work rather than
 * duplicating it.
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
  await reconcileDuelSeries(stage);
  await reconcileDuelEvents(stage);

  const [seriesCounts, oldestRecompute] = await Promise.all([
    prisma.duelSeries.groupBy({
      by: ["seriesState"],
      _count: { _all: true },
    }),
    prisma.challengeRunRevision.findFirst({
      where: { revisionState: { in: ["queued", "running"] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);
  duelSeriesState.reset();
  for (const count of seriesCounts) {
    duelSeriesState.set({ state: count.seriesState }, count._count._all);
  }
  challengeRecomputeLag.set(
    oldestRecompute === null
      ? 0
      : Math.max(0, (Date.now() - oldestRecompute.createdAt.getTime()) / 1000),
  );
}
