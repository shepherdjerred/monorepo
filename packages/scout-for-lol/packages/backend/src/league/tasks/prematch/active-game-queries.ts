import { z } from "zod";
import type { MatchId } from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import * as Sentry from "@sentry/bun";

const logger = createLogger("prematch-active-game-queries");

const ACTIVE_GAME_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const TrackedPuuidsSchema = z.array(z.string());
const PrematchMessageIdsSchema = z.record(z.string(), z.string());

export type ActiveGameRecord = {
  gameId: number;
  trackedPuuids: string[];
  prematchMessageIds: Record<string, string>;
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
      gameId: Number(row.gameId),
      trackedPuuids: TrackedPuuidsSchema.parse(JSON.parse(row.trackedPuuids)),
      prematchMessageIds:
        row.prematchMessageIds === null
          ? {}
          : PrematchMessageIdsSchema.parse(JSON.parse(row.prematchMessageIds)),
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
    const gameIdBigInt = BigInt(gameId);
    await prismaClient.activeGame.upsert({
      where: { gameId: gameIdBigInt },
      create: {
        gameId: gameIdBigInt,
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
 * Persist the Discord message IDs produced by the prematch notification.
 * Message IDs are stored per channel because one game can be delivered to
 * several subscribed channels, and the postmatch report must reply in each
 * channel to its own corresponding prematch message.
 */
export async function recordPrematchMessageIds(
  gameId: number,
  messageIds: ReadonlyMap<string, string>,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const serialized = Object.fromEntries(messageIds.entries());
  try {
    await prismaClient.activeGame.update({
      where: { gameId: BigInt(gameId) },
      data: { prematchMessageIds: JSON.stringify(serialized) },
    });
  } catch (error) {
    logger.error(
      `❌ Error recording prematch message IDs for game ${gameId.toString()}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: {
        source: "prematch-record-message-ids",
        gameId: gameId.toString(),
      },
    });
    throw error;
  }
}

/** Return the prematch Discord message IDs for a game, keyed by channel ID. */
export async function getPrematchMessageIds(
  gameId: number,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<Map<string, string>> {
  const row = await prismaClient.activeGame.findUnique({
    where: { gameId: BigInt(gameId) },
    select: { prematchMessageIds: true },
  });
  if (row === null) {
    return new Map();
  }
  if (row.prematchMessageIds === null) {
    return new Map();
  }
  const parsed = PrematchMessageIdsSchema.parse(
    JSON.parse(row.prematchMessageIds),
  );
  return new Map(Object.entries(parsed));
}

export async function getPrematchMessageIdsForMatchId(
  matchId: MatchId,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<Map<string, string>> {
  const suffix = matchId.split("_").at(-1);
  const gameId =
    suffix !== undefined && /^\d+$/.test(suffix) ? Number(suffix) : NaN;
  return Number.isSafeInteger(gameId)
    ? getPrematchMessageIds(gameId, prismaClient)
    : new Map();
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
