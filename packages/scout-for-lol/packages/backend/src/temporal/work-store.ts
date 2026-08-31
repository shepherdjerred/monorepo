import { z } from "zod";
import {
  LoadingScreenDataSchema,
  PlayerConfigEntrySchema,
  QueueTypeSchema,
  RawCurrentGameInfoSchema,
} from "@scout-for-lol/data";
import {
  DETACHED_WORK_MAX_ATTEMPTS,
  type ScoutDetachedWorkInput,
} from "@scout-for-lol/temporal";
import { classifyLlmProviderIssue } from "#src/alerts/provider-metrics.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import configuration from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";
import type { StartParlayGenerationInput } from "#src/betting/parlay-generation-types.ts";
import { currentScoutTemporalSupervisor } from "./runtime.ts";
import { startScoutDetachedWork } from "./starts.ts";

const logger = createLogger("temporal-work-store");

const ParlayWorkPayloadSchema = z.strictObject({
  gameInfo: RawCurrentGameInfoSchema,
  trackedPlayers: z.array(PlayerConfigEntrySchema),
  queueType: QueueTypeSchema.optional(),
  loadingScreenData: LoadingScreenDataSchema.optional(),
});

const UniqueViolationSchema = z.object({ code: z.literal("P2002") });

export function parlayTemporalWorkId(matchId: string): string {
  return `parlay:${matchId}`;
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
    await startScoutDetachedWork(supervisor.client(), input);
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

export async function requeueFailedScoutTemporalWork(
  workId: string,
  reason: string,
  database: ExtendedPrismaClient = prisma,
): Promise<void> {
  const parsedReason = z.string().trim().min(10).parse(reason);
  const result = await database.scoutTemporalWork.updateMany({
    where: { id: workId, state: "failed" },
    data: {
      state: "queued",
      requeueCount: { increment: 1 },
      lastRequeueReason: parsedReason,
      lastRequeuedAt: new Date(),
    },
  });
  if (result.count !== 1) {
    throw new Error(
      `Scout Temporal work ${workId} is missing or is not in failed state`,
    );
  }
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
    const parlayInput = ParlayWorkPayloadSchema.parse(raw);
    const { runParlayGeneration } =
      await import("#src/betting/parlay-generate.ts");
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
