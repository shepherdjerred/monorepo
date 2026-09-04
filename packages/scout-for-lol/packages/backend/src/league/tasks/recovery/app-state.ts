import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { getErrorMessage } from "#src/utils/errors.ts";

const BOT_STATE_ID = 1;

export async function getLastSuccessfulPollAt(): Promise<Date | undefined> {
  const row = await prisma.botState.findUnique({
    where: { id: BOT_STATE_ID },
  });
  return row?.lastSuccessfulPollAt ?? undefined;
}

export async function setLastSuccessfulPollAt(date: Date): Promise<void> {
  await prisma.botState.upsert({
    where: { id: BOT_STATE_ID },
    update: { lastSuccessfulPollAt: date },
    create: { id: BOT_STATE_ID, lastSuccessfulPollAt: date },
  });
}

export async function markPostMatchPollStarted(
  startedAt: Date,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  await prismaClient.botState.upsert({
    where: { id: BOT_STATE_ID },
    update: {
      pollStartedAt: startedAt,
      pollCompletedAt: null,
      pollEvidenceComplete: null,
      pollFailureReason: null,
      pollStatus: "running",
    },
    create: {
      id: BOT_STATE_ID,
      pollStartedAt: startedAt,
      pollStatus: "running",
    },
  });
}

export async function markPostMatchPollCompleted(
  input: {
    completedAt: Date;
    evidenceComplete: boolean;
    evidenceWatermark?: Date | undefined;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  await prismaClient.botState.upsert({
    where: { id: BOT_STATE_ID },
    update: {
      ...(input.evidenceComplete
        ? { lastSuccessfulPollAt: input.completedAt }
        : {}),
      pollCompletedAt: input.completedAt,
      pollEvidenceComplete: input.evidenceComplete,
      evidenceWatermarkAt: input.evidenceWatermark ?? null,
      pollFailureReason: input.evidenceComplete
        ? null
        : "Match discovery evidence was incomplete.",
      pollStatus: input.evidenceComplete ? "healthy" : "incomplete",
    },
    create: {
      id: BOT_STATE_ID,
      ...(input.evidenceComplete
        ? { lastSuccessfulPollAt: input.completedAt }
        : {}),
      pollCompletedAt: input.completedAt,
      pollEvidenceComplete: input.evidenceComplete,
      evidenceWatermarkAt: input.evidenceWatermark ?? null,
      pollFailureReason: input.evidenceComplete
        ? null
        : "Match discovery evidence was incomplete.",
      pollStatus: input.evidenceComplete ? "healthy" : "incomplete",
    },
  });
}

export async function markPostMatchPollFailed(
  error: unknown,
  failedAt: Date,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  await prismaClient.botState.upsert({
    where: { id: BOT_STATE_ID },
    update: {
      pollCompletedAt: failedAt,
      pollEvidenceComplete: false,
      pollFailureReason: getErrorMessage(error),
      pollStatus: "failed",
    },
    create: {
      id: BOT_STATE_ID,
      pollCompletedAt: failedAt,
      pollEvidenceComplete: false,
      pollFailureReason: getErrorMessage(error),
      pollStatus: "failed",
    },
  });
}
