import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import * as Sentry from "@sentry/bun";

const logger = createLogger("prematch-active-game-queries");

const ACTIVE_GAME_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const TrackedPuuidsSchema = z.array(z.string());

export type ActiveGameRecord = {
  gameId: number;
  trackedPuuids: string[];
  detectedAt: Date;
  expiresAt: Date;
};

/**
 * Get all active games from the database.
 */
export async function getActiveGames(
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<ActiveGameRecord[]> {
  try {
    const rows = await prismaClient.activeGame.findMany();
    return rows.map((row) => ({
      gameId: row.gameId,
      trackedPuuids: TrackedPuuidsSchema.parse(JSON.parse(row.trackedPuuids)),
      detectedAt: row.detectedAt,
      expiresAt: row.expiresAt,
    }));
  } catch (error) {
    logger.error("❌ Error fetching active games:", error);
    Sentry.captureException(error, {
      tags: { source: "prematch-get-active-games" },
    });
    throw error;
  }
}

/**
 * Insert a new active game record.
 *
 * @param gameId - Riot game ID from the spectator API
 * @param trackedPuuids - Array of tracked player PUUIDs detected in this game
 */
export async function upsertActiveGame(
  gameId: number,
  trackedPuuids: string[],
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ACTIVE_GAME_TTL_MS);
  const puuidsJson = JSON.stringify(trackedPuuids);

  try {
    await prismaClient.activeGame.upsert({
      where: { gameId },
      create: {
        gameId,
        trackedPuuids: puuidsJson,
        detectedAt: now,
        expiresAt,
      },
      update: {
        trackedPuuids: puuidsJson,
      },
    });
    logger.info(
      `📝 Tracked active game ${gameId.toString()} with ${trackedPuuids.length.toString()} player(s)`,
    );
  } catch (error) {
    logger.error(`❌ Error upserting active game ${gameId.toString()}:`, error);
    Sentry.captureException(error, {
      tags: {
        source: "prematch-upsert-active-game",
        gameId: gameId.toString(),
      },
    });
    throw error;
  }
}

/**
 * Delete expired active game records (where expiresAt < now).
 *
 * @returns Number of records deleted
 */
export async function deleteExpiredActiveGames(
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<number> {
  try {
    const result = await prismaClient.activeGame.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    if (result.count > 0) {
      logger.info(
        `🧹 Cleaned up ${result.count.toString()} expired active game(s)`,
      );
    }
    return result.count;
  } catch (error) {
    logger.error("❌ Error deleting expired active games:", error);
    Sentry.captureException(error, {
      tags: { source: "prematch-delete-expired" },
    });
    throw error;
  }
}

/**
 * Get the count of currently tracked active games.
 */
export async function getActiveGameCount(
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<number> {
  try {
    return await prismaClient.activeGame.count();
  } catch (error) {
    logger.error("❌ Error counting active games:", error);
    return 0;
  }
}
