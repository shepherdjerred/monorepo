import { z } from "zod";
import {
  LeaguePuuidSchema,
  LoadingScreenDataSchema,
  PlayerConfigEntrySchema,
  QueueTypeSchema,
  RawCurrentGameInfoSchema,
  RegionSchema,
} from "@scout-for-lol/data";
import {
  DETACHED_WORK_MAX_ATTEMPTS,
  SCOUT_WORKFLOW_NAMES,
  scoutDetachedWorkWorkflowId,
  type ScoutDetachedWorkInput,
} from "@scout-for-lol/temporal";
import { classifyLlmProviderIssue } from "#src/alerts/provider-metrics.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import configuration from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";
import type { StartParlayGenerationInput } from "#src/betting/parlays/parlay-generation-types.ts";
import { liveDurableFacts } from "#src/durable/match/live-facts.ts";
import { withRecordedWorkflowStart } from "#src/durable/match/workflow-start-facts.ts";
import { currentScoutTemporalSupervisor } from "./runtime.ts";
import { startScoutDetachedWork } from "./starts.ts";

const logger = createLogger("temporal-work-store");

const ParlayWorkPayloadSchema = z.strictObject({
  gameInfo: RawCurrentGameInfoSchema,
  trackedPlayers: z.array(PlayerConfigEntrySchema),
  queueType: QueueTypeSchema.optional(),
  loadingScreenData: LoadingScreenDataSchema.optional(),
});

const ChampionMasteryRefreshPayloadSchema = z.strictObject({
  puuid: LeaguePuuidSchema,
  region: RegionSchema,
});

const UniqueViolationSchema = z.object({ code: z.literal("P2002") });

export function parlayTemporalWorkId(matchId: string): string {
  return `parlay:${matchId}`;
}

export function championMasteryRefreshTemporalWorkId(
  puuid: string,
  fetchedAt: Date | undefined,
): string {
  return `champion-mastery:${puuid}:${fetchedAt?.getTime().toString() ?? "missing"}`;
}

export async function persistScoutTemporalWork(
  input: {
    id: string;
    kind: ScoutDetachedWorkInput["kind"];
    payload: string;
  },
  database: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  try {
    await database.scoutTemporalWork.create({ data: input });
    return true;
  } catch (error) {
    if (!UniqueViolationSchema.safeParse(error).success) throw error;
    return false;
  }
}

async function requestStart(input: ScoutDetachedWorkInput): Promise<void> {
  const supervisor = currentScoutTemporalSupervisor();
  if (supervisor === undefined) {
    logger.warn("Temporal work persisted while the supervisor is unavailable", {
      kind: input.kind,
      workId: input.workId,
    });
    return;
  }
  try {
    // The durable request row is written before the start call, so a crash
    // between the two still leaves evidence that a start was intended.
    await withRecordedWorkflowStart({
      facts: liveDurableFacts(),
      request: {
        requestedWorkflowId: scoutDetachedWorkWorkflowId(
          input.stage,
          input.kind,
          input.workId,
        ),
        workflowType: SCOUT_WORKFLOW_NAMES.detachedWork,
        requestSource: `detached-work:${input.kind}`,
        requestedBy: null,
        input,
      },
      start: async () =>
        await startScoutDetachedWork(supervisor.client(), input),
      runIdOf: (handle) => handle.firstExecutionRunId,
    });
  } catch (error) {
    logger.warn(
      "Temporal work persisted but its immediate start was not accepted",
      {
        kind: input.kind,
        workId: input.workId,
        error,
      },
    );
  }
}

export async function enqueueParlayGeneration(
  input: StartParlayGenerationInput,
): Promise<void> {
  const parsed = ParlayWorkPayloadSchema.parse(input);
  const matchId = `${parsed.gameInfo.platformId}_${parsed.gameInfo.gameId.toString()}`;
  const workId = parlayTemporalWorkId(matchId);
  const created = await persistScoutTemporalWork({
    id: workId,
    kind: "parlay-generation",
    payload: JSON.stringify(parsed),
  });
  if (created) {
    await requestStart({
      stage: configuration.environment,
      kind: "parlay-generation",
      workId,
    });
  }
}

/**
 * Persist a deduplicated request to refresh a stale champion-mastery cache.
 * The request uses the observed snapshot timestamp as part of its identity, so
 * a later stale version can be refreshed even after this work has completed.
 */
export async function enqueueChampionMasteryRefresh(
  input: {
    puuid: string;
    region: string;
    fetchedAt: Date | undefined;
  },
  database: ExtendedPrismaClient = prisma,
): Promise<void> {
  // `fetchedAt` participates in the durable work identity, but it is not part
  // of the activity payload. Parse the two independently so strict payload
  // validation does not reject every cache-miss refresh.
  const payload = ChampionMasteryRefreshPayloadSchema.parse({
    puuid: input.puuid,
    region: input.region,
  });
  const workId = championMasteryRefreshTemporalWorkId(
    payload.puuid,
    input.fetchedAt,
  );
  const created = await persistScoutTemporalWork(
    {
      id: workId,
      kind: "champion-mastery-refresh",
      payload: JSON.stringify(payload),
    },
    database,
  );
  const requeued =
    !created &&
    (await requeueFailedScoutTemporalWorkIfFailed(
      workId,
      "Champion mastery refresh retried after a later page visit",
      database,
      JSON.stringify(payload),
    ));
  if (created || requeued) {
    await requestStart({
      stage: configuration.environment,
      kind: "champion-mastery-refresh",
      workId,
    });
  }
}

export async function requeueFailedScoutTemporalWork(
  workId: string,
  reason: string,
  database: ExtendedPrismaClient = prisma,
): Promise<void> {
  const requeued = await requeueFailedScoutTemporalWorkIfFailed(
    workId,
    reason,
    database,
  );
  if (!requeued) {
    throw new Error(
      `Scout Temporal work ${workId} is missing or is not in failed state`,
    );
  }
}

async function requeueFailedScoutTemporalWorkIfFailed(
  workId: string,
  reason: string,
  database: ExtendedPrismaClient,
  payload?: string,
): Promise<boolean> {
  const parsedReason = z.string().trim().min(10).parse(reason);
  const result = await database.scoutTemporalWork.updateMany({
    where: { id: workId, state: "failed" },
    data: {
      state: "queued",
      requeueCount: { increment: 1 },
      lastRequeueReason: parsedReason,
      lastRequeuedAt: new Date(),
      ...(payload === undefined ? {} : { payload }),
    },
  });
  return result.count === 1;
}

export async function findQueuedScoutTemporalWork(
  database: ExtendedPrismaClient = prisma,
) {
  return await database.scoutTemporalWork.findMany({
    where: { state: "queued" },
    select: { id: true, kind: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}

export async function executeScoutTemporalWork(
  input: ScoutDetachedWorkInput,
  attempt = 1,
): Promise<void> {
  const work = await prisma.scoutTemporalWork.findUniqueOrThrow({
    where: { id: input.workId },
    select: { kind: true, payload: true, state: true },
  });
  if (work.kind !== input.kind) {
    throw new Error(
      `Temporal work ${input.workId} has kind ${work.kind}, expected ${input.kind}`,
    );
  }
  if (work.state === "completed") return;

  await prisma.scoutTemporalWork.update({
    where: { id: input.workId },
    data: {
      state: "running",
      startedAt: new Date(),
      failedAt: null,
      lastError: null,
      attemptCount: { increment: 1 },
    },
  });
  try {
    const raw = JSON.parse(work.payload);
    if (input.kind === "parlay-generation") {
      const parlayInput = ParlayWorkPayloadSchema.parse(raw);
      const { runParlayGeneration } =
        await import("#src/betting/parlays/parlay-generate.ts");
      await runParlayGeneration(
        {
          gameInfo: parlayInput.gameInfo,
          trackedPlayers: parlayInput.trackedPlayers,
          queueType: parlayInput.queueType,
          loadingScreenData: parlayInput.loadingScreenData,
        },
        prisma,
        "temporal",
      );
    } else {
      const masteryInput = ChampionMasteryRefreshPayloadSchema.parse(raw);
      const { refreshChampionMasterySnapshot } =
        await import("#src/league/champion-mastery/snapshots.ts");
      await refreshChampionMasterySnapshot(masteryInput);
    }
    await prisma.scoutTemporalWork.update({
      where: { id: input.workId },
      data: { state: "completed", completedAt: new Date() },
    });
  } catch (error) {
    const terminalFailure =
      attempt >= DETACHED_WORK_MAX_ATTEMPTS ||
      classifyLlmProviderIssue(error) === "quota";
    await prisma.scoutTemporalWork.update({
      where: { id: input.workId },
      data: {
        state: terminalFailure ? "failed" : "queued",
        failedAt: terminalFailure ? new Date() : null,
        lastError: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
