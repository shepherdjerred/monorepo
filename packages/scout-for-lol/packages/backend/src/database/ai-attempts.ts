import { type MatchId } from "@scout-for-lol/data";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

const logger = createLogger("database");

/**
 * Returns true if the AI review pipeline has already been entered for this
 * match (success or crash). Used to short-circuit re-entry so a single match
 * never burns LLM tokens twice.
 */
export async function hasAiBeenAttempted(
  matchId: MatchId,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<boolean> {
  const row = await prismaClient.matchAiAttempt.findUnique({
    where: { matchId },
    select: { matchId: true },
  });
  return row !== null;
}

/**
 * Marks an AI-review attempt for `matchId`. Must be called BEFORE the first
 * model call so a mid-pipeline crash still leaves a row behind. Idempotent
 * via upsert in case of races.
 */
export async function markAiAttempted(
  matchId: MatchId,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  try {
    await prismaClient.matchAiAttempt.upsert({
      where: { matchId },
      create: { matchId },
      update: {},
    });
  } catch (error) {
    logger.error("❌ Error marking AI attempt:", error);
    Sentry.captureException(error, {
      tags: { source: "db-mark-ai-attempted", matchId },
    });
    throw error;
  }
}
