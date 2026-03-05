import { api } from "#src/league/api/api.ts";
import { regionToRegionGroup } from "twisted/dist/constants/regions.js";
import { mapRegionToEnum } from "#src/league/model/region.ts";
import { getAccountsWithState } from "#src/database/index.ts";
import { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { saveMatchToS3 } from "#src/storage/s3.ts";
import { MatchIdSchema } from "@scout-for-lol/data/index.ts";
import type { MatchId, Region } from "@scout-for-lol/data/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  backfillMatchesTotal,
  downtimeDetectedTotal,
} from "#src/metrics/index.ts";
import {
  riotApiRequestsTotal,
  updateRiotApiHealth,
} from "#src/metrics/index.ts";
import { z } from "zod";
import { withTimeout } from "#src/utils/timeout.ts";
import * as Sentry from "@sentry/bun";

const logger = createLogger("backfill-to-s3");

const DELAY_BETWEEN_MATCH_FETCHES_MS = 1000;
const DELAY_BETWEEN_ACCOUNTS_MS = 2000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const MAX_MATCHES_PER_REQUEST = 100;

export type BackfillResult = {
  totalMatchesFound: number;
  totalMatchesSaved: number;
  totalMatchesFailed: number;
  accountsProcessed: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function fetchMatchIdsForTimeRange(
  puuid: string,
  region: Region,
  startTimeEpochSeconds: number,
  endTimeEpochSeconds: number,
): Promise<MatchId[]> {
  const regionEnum = mapRegionToEnum(region);
  const regionGroup = regionToRegionGroup(regionEnum);
  const allMatchIds: MatchId[] = [];
  let offset = 0;
  let hasMore = true;

  // Paginate through all matches in the time range
  while (hasMore) {
    try {
      const response = await withTimeout(
        api.MatchV5.list(puuid, regionGroup, {
          startTime: startTimeEpochSeconds,
          endTime: endTimeEpochSeconds,
          count: MAX_MATCHES_PER_REQUEST,
          start: offset,
        }),
      );
      riotApiRequestsTotal.inc({
        source: "backfill-match-list",
        status: "success",
      });
      updateRiotApiHealth(true);

      const matchIdsResult = z
        .array(MatchIdSchema)
        .safeParse(response.response);
      if (!matchIdsResult.success) {
        logger.error("Failed to parse match IDs during backfill");
        hasMore = false;
        continue;
      }

      const matchIds = matchIdsResult.data;
      allMatchIds.push(...matchIds);

      if (matchIds.length < MAX_MATCHES_PER_REQUEST) {
        hasMore = false;
        continue;
      }

      offset += MAX_MATCHES_PER_REQUEST;
      await sleep(DELAY_BETWEEN_MATCH_FETCHES_MS);
    } catch (error) {
      riotApiRequestsTotal.inc({
        source: "backfill-match-list",
        status: "error",
      });
      updateRiotApiHealth(false);
      logger.error(
        `Error fetching match IDs for backfill (offset ${offset.toString()}):`,
        error,
      );
      hasMore = false;
    }
  }

  return allMatchIds;
}

export async function backfillMatchesToS3(
  startTime: Date,
  endTime: Date,
): Promise<BackfillResult> {
  const result: BackfillResult = {
    totalMatchesFound: 0,
    totalMatchesSaved: 0,
    totalMatchesFailed: 0,
    accountsProcessed: 0,
  };

  downtimeDetectedTotal.inc({ severity: "backfill" });

  logger.info(
    `Starting S3 backfill from ${startTime.toISOString()} to ${endTime.toISOString()}`,
  );

  const accountsWithState = await getAccountsWithState();
  logger.info(
    `Found ${accountsWithState.length.toString()} accounts to check for backfill`,
  );

  const startTimeEpochSeconds = Math.floor(startTime.getTime() / 1000);
  // Skip matches within last 30 min — let normal polling handle those
  const cutoffTime = new Date(endTime.getTime() - THIRTY_MINUTES_MS);
  const endTimeEpochSeconds = Math.floor(cutoffTime.getTime() / 1000);

  if (startTimeEpochSeconds >= endTimeEpochSeconds) {
    logger.info(
      "Downtime window too short for backfill after 30min cutoff, skipping",
    );
    return result;
  }

  // Collect all unique match IDs across all accounts
  const uniqueMatchIds = new Set<MatchId>();
  // Track which accounts each match belongs to (for alias metadata)
  const matchAccountAliases = new Map<MatchId, string[]>();

  for (const { config: account } of accountsWithState) {
    const puuid = account.league.leagueAccount.puuid;
    const region = account.league.leagueAccount.region;

    logger.info(
      `[${account.alias}] Fetching match history for backfill period`,
    );

    try {
      const matchIds = await fetchMatchIdsForTimeRange(
        puuid,
        region,
        startTimeEpochSeconds,
        endTimeEpochSeconds,
      );

      logger.info(
        `[${account.alias}] Found ${matchIds.length.toString()} matches in backfill window`,
      );

      for (const matchId of matchIds) {
        uniqueMatchIds.add(matchId);
        const existing = matchAccountAliases.get(matchId) ?? [];
        existing.push(account.alias);
        matchAccountAliases.set(matchId, existing);
      }

      result.accountsProcessed += 1;
    } catch (error) {
      logger.error(
        `[${account.alias}] Error fetching match history for backfill:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "backfill-account", alias: account.alias },
      });
    }

    await sleep(DELAY_BETWEEN_ACCOUNTS_MS);
  }

  result.totalMatchesFound = uniqueMatchIds.size;
  logger.info(
    `Found ${uniqueMatchIds.size.toString()} unique matches to backfill across ${result.accountsProcessed.toString()} accounts`,
  );

  // Fetch and save each match to S3
  for (const matchId of uniqueMatchIds) {
    try {
      // Use region from the first account that had this match
      const aliases = matchAccountAliases.get(matchId) ?? [];
      const accountForRegion = accountsWithState.find((a) =>
        aliases.includes(a.config.alias),
      );

      if (!accountForRegion) {
        logger.warn(`No account found for match ${matchId}, skipping`);
        result.totalMatchesFailed += 1;
        backfillMatchesTotal.inc({ status: "skipped" });
        continue;
      }

      const region = accountForRegion.config.league.leagueAccount.region;
      const matchData = await fetchMatchData(matchId, region);

      if (!matchData) {
        logger.warn(`Could not fetch match data for ${matchId}, skipping`);
        result.totalMatchesFailed += 1;
        backfillMatchesTotal.inc({ status: "fetch_failed" });
        continue;
      }

      await saveMatchToS3(matchData, aliases);
      result.totalMatchesSaved += 1;
      backfillMatchesTotal.inc({ status: "saved" });

      logger.info(
        `Backfilled match ${matchId} to S3 (${result.totalMatchesSaved.toString()}/${uniqueMatchIds.size.toString()})`,
      );
    } catch (error) {
      logger.error(`Error backfilling match ${matchId}:`, error);
      result.totalMatchesFailed += 1;
      backfillMatchesTotal.inc({ status: "error" });
      Sentry.captureException(error, {
        tags: { source: "backfill-match", matchId },
      });
    }

    await sleep(DELAY_BETWEEN_MATCH_FETCHES_MS);
  }

  logger.info(
    `Backfill complete: ${result.totalMatchesSaved.toString()} saved, ${result.totalMatchesFailed.toString()} failed out of ${result.totalMatchesFound.toString()} total`,
  );

  return result;
}
