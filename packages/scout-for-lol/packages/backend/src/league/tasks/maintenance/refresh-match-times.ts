/**
 * Startup task to refresh lastMatchTime for all tracked accounts.
 *
 * This runs slowly in the background on startup to ensure all accounts
 * have accurate lastMatchTime values for proper polling intervals.
 */

import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { backfillLastMatchTime } from "@scout-for-lol/backend/league/api/backfill-match-history.ts";
import {
  LeagueAccountSchema,
  LeaguePuuidSchema,
  type PlayerConfigEntry,
} from "@scout-for-lol/data/index.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("refresh-match-times");

/** Number of accounts to process in each batch */
const BATCH_SIZE = 3;

/** Delay between batches in milliseconds (avoid rate limiting) */
const BATCH_DELAY_MS = 60_000;

/** Delay between individual API calls within a batch */
const API_CALL_DELAY_MS = 2000;

/** Only refresh accounts that haven't been updated in this many hours */
const STALE_THRESHOLD_HOURS = 6;

/**
 * Refresh lastMatchTime for accounts that need it.
 *
 * Prioritizes:
 * 1. Accounts with null lastMatchTime (never set)
 * 2. Accounts with stale lastMatchTime (not updated recently)
 *
 * Runs slowly to avoid API rate limits.
 */
export async function refreshMatchTimes(): Promise<void> {
  logger.info("🔄 Starting match time refresh task");

  const staleThreshold = new Date(
    Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000,
  );

  // Find accounts that need refreshing
  const accountsToRefresh = await prisma.account.findMany({
    where: {
      OR: [{ lastMatchTime: null }, { lastMatchTime: { lt: staleThreshold } }],
    },
    include: {
      player: true,
    },
    orderBy: [
      // Prioritize null lastMatchTime first
      { lastMatchTime: "asc" },
    ],
  });

  if (accountsToRefresh.length === 0) {
    logger.info("✅ All accounts have recent lastMatchTime values");
    return;
  }

  logger.info(
    `📊 Found ${accountsToRefresh.length.toString()} account(s) needing refresh ` +
      `(null or older than ${STALE_THRESHOLD_HOURS.toString()} hours)`,
  );

  let refreshed = 0;
  let failed = 0;
  let noMatches = 0;

  // Process in batches
  for (let i = 0; i < accountsToRefresh.length; i += BATCH_SIZE) {
    const batch = accountsToRefresh.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(accountsToRefresh.length / BATCH_SIZE);

    logger.info(
      `📦 Processing batch ${batchNum.toString()}/${totalBatches.toString()}`,
    );

    for (const account of batch) {
      try {
        const leagueAccount = LeagueAccountSchema.parse({
          puuid: account.puuid,
          region: account.region,
        });

        const playerConfig: PlayerConfigEntry = {
          alias: account.player.alias,
          league: { leagueAccount },
          discordAccount: { id: account.player.discordId ?? undefined },
        };

        const puuid = LeaguePuuidSchema.parse(account.puuid);
        const result = await backfillLastMatchTime(playerConfig, puuid);

        if (result) {
          logger.info(`  ✅ ${account.player.alias}: ${result.toISOString()}`);
          refreshed++;
        } else {
          logger.info(`  ⚠️  ${account.player.alias}: No match history found`);
          noMatches++;
        }
      } catch (error) {
        logger.error(`  ❌ ${account.player.alias}: Failed`, error);
        failed++;
      }

      // Delay between API calls
      await sleep(API_CALL_DELAY_MS);
    }

    // Delay between batches (unless this is the last batch)
    if (i + BATCH_SIZE < accountsToRefresh.length) {
      logger.info(`⏳ Waiting 1 minute before next batch...`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  logger.info(
    `✅ Match time refresh complete: ${refreshed.toString()} refreshed, ` +
      `${noMatches.toString()} no matches, ${failed.toString()} failed`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
