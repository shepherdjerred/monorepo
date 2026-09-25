import {
  type LeaguePuuid,
  type PlayerConfigEntry,
  LeagueAccountSchema,
  DiscordAccountIdSchema,
} from "@scout-for-lol/data";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

const logger = createLogger("database");

export type PlayerAccountWithState = {
  config: PlayerConfigEntry;
  lastMatchTime: Date | undefined;
  lastCheckedAt: Date | undefined;
};

type AccountStateClient = Pick<ExtendedPrismaClient, "player">;

/**
 * The configs behind a FIXED set of PUUIDs, with no live-guild filter.
 *
 * `getAccountsWithState` narrows by `getActiveServerIds()`, which is a read of
 * the Discord gateway's guild cache and therefore answers differently in
 * different processes. Its own doc calls the unfiltered fallback "more work,
 * never the wrong work", and for the polling filter it was written for that is
 * true: widening the set only costs effort. It is exactly false wherever a
 * match's already-recorded roster is being rebuilt, or a detected game's
 * audience resolved, because there the filter NARROWS, so a gateway-owning
 * worker does less work and the wrong work.
 *
 * This lookup takes the PUUIDs as given and answers the same way in every
 * process. One entry per `Account` row, as `getAccountsWithState` also returns,
 * so a PUUID registered in several guilds yields several configs; ordered so
 * two runs over the same rows agree.
 */
export async function getAccountConfigsByPuuids(
  puuids: readonly LeaguePuuid[],
  prismaClient: Pick<ExtendedPrismaClient, "account"> = prisma,
): Promise<PlayerConfigEntry[]> {
  if (puuids.length === 0) return [];
  const accounts = await prismaClient.account.findMany({
    where: { puuid: { in: [...puuids] } },
    include: { player: true },
    orderBy: [{ puuid: "asc" }, { id: "asc" }],
  });
  return accounts.map((account) => ({
    alias: account.player.alias,
    league: {
      leagueAccount: LeagueAccountSchema.parse({
        puuid: account.puuid,
        region: account.region,
      }),
    },
    discordAccount: {
      id:
        account.player.discordId === null
          ? undefined
          : DiscordAccountIdSchema.parse(account.player.discordId),
    },
  }));
}

/**
 * Get all player accounts with their runtime state for polling.
 * Includes lastMatchTime and lastCheckedAt to determine polling intervals.
 *
 * @param prismaClient - Prisma client instance
 * @returns Array of player accounts with their polling state
 */
export async function getAccountsWithState(
  prismaClient: AccountStateClient = prisma,
  activeServerIds?: Set<string>,
): Promise<PlayerAccountWithState[]> {
  logger.info("🔍 Fetching all player accounts with state");

  try {
    const startTime = Date.now();

    // When a set of active guild ids is provided, only poll players whose guild
    // the bot is still a member of - this avoids burning Riot API calls on
    // guilds the bot has been removed from. Callers must omit this (rather than
    // pass an empty set) when the client is not ready, so polling is not skipped
    // wholesale during startup/outages.
    const players = await prismaClient.player.findMany({
      ...(activeServerIds
        ? { where: { serverId: { in: [...activeServerIds] } } }
        : {}),
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
            id:
              player.discordId === null
                ? undefined
                : DiscordAccountIdSchema.parse(player.discordId),
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
