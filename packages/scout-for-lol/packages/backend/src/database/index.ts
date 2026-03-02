import { PrismaClient } from "#generated/prisma/client/index.js";
import {
  type DiscordChannelId,
  type LeaguePuuid,
  type PlayerConfigEntry,
  MatchIdSchema,
  type MatchId,
  LeagueAccountSchema,
} from "@scout-for-lol/data";
import { uniqueBy } from "remeda";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { databaseQueriesTotal } from "#src/metrics/index.ts";

const logger = createLogger("database");

logger.info("🗄️  Initializing Prisma database client");

const basePrisma = new PrismaClient();

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ operation, args, query }) {
        databaseQueriesTotal.inc({ operation });
        return query(args);
      },
    },
  },
});

export type ExtendedPrismaClient = typeof prisma;

logger.info("✅ Database client initialized");

export type PlayerAccountWithState = {
  config: PlayerConfigEntry;
  lastMatchTime: Date | undefined;
  lastCheckedAt: Date | undefined;
};

export async function getChannelsSubscribedToPlayers(
  puuids: LeaguePuuid[],
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<{ channel: DiscordChannelId; serverId: string }[]> {
  logger.info(
    `🔍 Fetching channels subscribed to ${puuids.length.toString()} players`,
  );
  logger.info(`📋 PUUIDs: ${puuids.join(", ")}`);

  try {
    const startTime = Date.now();

    // the accounts that are subscribed to the players
    const accounts = await prismaClient.account.findMany({
      where: {
        puuid: {
          in: puuids,
        },
      },
      include: {
        player: {
          include: {
            subscriptions: true,
          },
        },
      },
    });

    const queryTime = Date.now() - startTime;
    logger.info(
      `📊 Found ${accounts.length.toString()} accounts in ${queryTime.toString()}ms`,
    );

    const result = uniqueBy(
      accounts.flatMap((account) =>
        account.player.subscriptions.map(
          (subscription): { channel: DiscordChannelId; serverId: string } => ({
            channel: subscription.channelId,
            serverId: subscription.serverId,
          }),
        ),
      ),
      (server) => server.channel,
    );

    logger.info(`📺 Returning ${result.length.toString()} unique channels`);
    return result;
  } catch (error) {
    logger.error("❌ Error fetching subscribed channels:", error);
    Sentry.captureException(error, {
      tags: { source: "db-get-subscribed-channels" },
    });
    throw error;
  }
}

/**
 * Get all player accounts with their runtime state for polling.
 * Includes lastMatchTime and lastCheckedAt to determine polling intervals.
 *
 * @param prismaClient - Prisma client instance
 * @returns Array of player accounts with their polling state
 */
export async function getAccountsWithState(
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PlayerAccountWithState[]> {
  logger.info("🔍 Fetching all player accounts with state");

  try {
    const startTime = Date.now();

    const players = await prismaClient.player.findMany({
      include: {
        accounts: true,
      },
    });

    const queryTime = Date.now() - startTime;
    logger.info(
      `📊 Found ${players.length.toString()} players in ${queryTime.toString()}ms`,
    );

    // transform
    const result = players.flatMap((player): PlayerAccountWithState[] => {
      return player.accounts.map((account): PlayerAccountWithState => {
        // Extract and validate only the fields needed for LeagueAccountSchema
        // Prisma account has many extra fields that shouldn't be in the config
        const leagueAccount = LeagueAccountSchema.parse({
          puuid: account.puuid,
          region: account.region,
        });

        const config: PlayerConfigEntry = {
          alias: player.alias,
          league: {
            leagueAccount,
          },
          discordAccount: {
            id: player.discordId ?? undefined,
          },
        };

        return {
          config,
          lastMatchTime: account.lastMatchTime ?? undefined,
          lastCheckedAt: account.lastCheckedAt ?? undefined,
        };
      });
    });

    logger.info(
      `📋 Returning ${result.length.toString()} player account entries with state`,
    );

    return result;
  } catch (error) {
    logger.error("❌ Error fetching player accounts with state:", error);
    Sentry.captureException(error, {
      tags: { source: "db-get-accounts-with-state" },
    });
    throw error;
  }
}

/**
 * Update the lastProcessedMatchId for a specific account.
 * This is called after we successfully process a match to avoid reprocessing.
 *
 * @param puuid - Player PUUID to update
 * @param matchId - The match ID that was just processed
 * @param prismaClient - Prisma client instance
 */
export async function updateLastProcessedMatch(
  puuid: LeaguePuuid,
  matchId: MatchId,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  logger.info(`📝 Updating lastProcessedMatchId for ${puuid} to ${matchId}`);

  try {
    const startTime = Date.now();

    await prismaClient.account.updateMany({
      where: {
        puuid,
      },
      data: {
        lastProcessedMatchId: matchId,
      },
    });

    const queryTime = Date.now() - startTime;
    logger.info(`✅ Updated lastProcessedMatchId in ${queryTime.toString()}ms`);
  } catch (error) {
    logger.error("❌ Error updating lastProcessedMatchId:", error);
    Sentry.captureException(error, {
      tags: { source: "db-update-last-processed-match", puuid },
    });
    throw error;
  }
}

/**
 * Get the lastProcessedMatchId for a specific account.
 *
 * @param puuid - Player PUUID to query
 * @param prismaClient - Prisma client instance
 * @returns The last processed match ID, or null if none exists
 */
export async function getLastProcessedMatch(
  puuid: LeaguePuuid,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<MatchId | null> {
  try {
    const account = await prismaClient.account.findFirst({
      where: {
        puuid,
      },
      select: {
        lastProcessedMatchId: true,
      },
    });

    return account?.lastProcessedMatchId
      ? MatchIdSchema.parse(account.lastProcessedMatchId)
      : null;
  } catch (error) {
    logger.error("❌ Error getting lastProcessedMatchId:", error);
    Sentry.captureException(error, {
      tags: { source: "db-get-last-processed-match", puuid },
    });
    throw error;
  }
}

/**
 * Update the lastMatchTime for an account.
 * This is called when we process a match to track player activity for dynamic polling.
 *
 * @param puuid - Player PUUID to update
 * @param matchTime - The game creation timestamp from the match
 * @param prismaClient - Prisma client instance
 */
export async function updateLastMatchTime(
  puuid: LeaguePuuid,
  matchTime: Date,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  logger.info(
    `📝 Updating lastMatchTime for ${puuid} to ${matchTime.toISOString()}`,
  );

  try {
    await prismaClient.account.updateMany({
      where: {
        puuid,
      },
      data: {
        lastMatchTime: matchTime,
      },
    });
  } catch (error) {
    logger.error("❌ Error updating lastMatchTime:", error);
    Sentry.captureException(error, {
      tags: { source: "db-update-last-match-time", puuid },
    });
    throw error;
  }
}

/**
 * Update the lastCheckedAt timestamp for an account.
 * This is called after we check for new matches to track when we last polled.
 *
 * @param puuid - Player PUUID to update
 * @param checkedAt - The timestamp when we checked for matches
 * @param prismaClient - Prisma client instance
 */
export async function updateLastCheckedAt(
  puuid: LeaguePuuid,
  checkedAt: Date,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  logger.info(
    `📝 Updating lastCheckedAt for ${puuid} to ${checkedAt.toISOString()}`,
  );

  try {
    await prismaClient.account.updateMany({
      where: {
        puuid,
      },
      data: {
        lastCheckedAt: checkedAt,
      },
    });
  } catch (error) {
    logger.error("❌ Error updating lastCheckedAt:", error);
    Sentry.captureException(error, {
      tags: { source: "db-update-last-checked-at", puuid },
    });
    throw error;
  }
}
