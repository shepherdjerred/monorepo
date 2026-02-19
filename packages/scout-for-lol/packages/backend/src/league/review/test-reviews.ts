#!/usr/bin/env bun
/**
 * Test script for generating AI reviews
 * Usage: bun run src/league/review/test-reviews.ts [options]
 */

import { generateMatchReview } from "@scout-for-lol/backend/league/review/generator.ts";
import {
  MatchIdSchema,
  LeaguePuuidSchema,
  parseQueueType,
  RawMatchSchema,
  RawTimelineSchema,
  type ArenaMatch,
  type CompletedMatch,
  type PlayerConfigEntry,
  type RawMatch,
  type RawTimeline,
  type MatchId,
} from "@scout-for-lol/data/index";
import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "@scout-for-lol/backend/storage/s3-client.ts";
import { LolApi, Constants } from "twisted";
import configuration from "@scout-for-lol/backend/configuration.ts";
import {
  toMatch,
  toArenaMatch,
} from "@scout-for-lol/backend/league/model/match.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import {
  parseArgs,
  getMatchSummary,
  generateDatePrefixes,
  type MatchType,
} from "@scout-for-lol/backend/league/review/test-reviews-utils.ts";

// Initialize Riot API client for timeline fetching
const api = new LolApi({ key: configuration.riotApiToken });

const logger = createLogger("review-test-reviews");

/**
 * Fetch match keys from S3 for the specified date range
 */
async function fetchMatchKeysFromS3(daysBack: number): Promise<string[]> {
  const bucket = configuration.s3BucketName;

  if (bucket === undefined) {
    throw new Error("S3_BUCKET_NAME not configured");
  }

  const client = createS3Client();
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const prefixes = generateDatePrefixes(startDate, endDate);
  const allKeys: string[] = [];

  logger.info(
    `\n🔍 Searching S3 for matches in last ${String(daysBack)} days...`,
  );

  for (const prefix of prefixes) {
    try {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
      });

      const response = await client.send(listCommand);

      if (response.Contents) {
        const keys = response.Contents.flatMap((obj) =>
          obj.Key !== undefined && obj.Key.length > 0 ? [obj.Key] : [],
        );
        allKeys.push(...keys);
        logger.info(`  Found ${String(keys.length)} match(es) in ${prefix}`);
      }
    } catch (error) {
      logger.warn(`  Warning: Could not list ${prefix}:`, error);
    }
  }

  logger.info(`✅ Found ${String(allKeys.length)} total matches\n`);
  return allKeys;
}

/**
 * Fetch and parse a match from S3
 */
async function fetchMatchFromS3(key: string): Promise<RawMatch | null> {
  const bucket = configuration.s3BucketName;

  if (bucket === undefined) {
    throw new Error("S3_BUCKET_NAME not configured");
  }

  const client = createS3Client();

  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await client.send(command);

    if (!response.Body) {
      return null;
    }

    const bodyString = await response.Body.transformToString();
    // Parse and validate the match data with Zod schema
    const matchData = JSON.parse(bodyString);
    return RawMatchSchema.parse(matchData);
  } catch (error) {
    logger.warn(`Failed to fetch match ${key}:`, error);
    return null;
  }
}

/**
 * Create a minimal player config for testing
 */
function createMinimalPlayerConfig(
  puuid: string,
  name: string,
): PlayerConfigEntry {
  return {
    alias: name,
    league: {
      leagueAccount: {
        puuid: LeaguePuuidSchema.parse(puuid),
        region: "AMERICA_NORTH",
      },
    },
  };
}

/**
 * Convert a raw Riot API match to our internal format
 */
function convertRawMatchToInternalFormat(
  rawMatch: RawMatch,
): CompletedMatch | ArenaMatch {
  const queueType = parseQueueType(rawMatch.info.queueId);

  // Pick the first participant as our "tracked player"
  const firstParticipant = rawMatch.info.participants[0];
  if (!firstParticipant) {
    throw new Error("No participants in match");
  }

  const playerName =
    firstParticipant.riotIdGameName !== undefined &&
    firstParticipant.riotIdGameName.length > 0 &&
    firstParticipant.riotIdTagline
      ? `${firstParticipant.riotIdGameName}#${firstParticipant.riotIdTagline}`
      : "Unknown";

  const playerConfig = createMinimalPlayerConfig(
    firstParticipant.puuid,
    playerName,
  );

  const player = {
    config: playerConfig,
    ranks: {},
  };

  return queueType === "arena"
    ? toArenaMatch([player], rawMatch)
    : toMatch([player], rawMatch, new Map());
}

type S3MatchResult = {
  match: CompletedMatch | ArenaMatch;
  rawMatch: RawMatch;
  matchId: MatchId;
};

/**
 * Fetch timeline data from Riot API for a match
 */
async function fetchTimelineFromRiotApi(
  matchId: MatchId,
): Promise<RawTimeline | undefined> {
  try {
    logger.info(`📊 Fetching timeline from Riot API for ${matchId}`);
    const response = await api.MatchV5.timeline(
      matchId,
      Constants.RegionGroups.AMERICAS,
    );
    const validated = RawTimelineSchema.parse(response.response);
    logger.info(
      `✅ Timeline fetched with ${validated.info.frames.length.toString()} frames`,
    );
    return validated;
  } catch (error) {
    logger.warn(`⚠️  Failed to fetch timeline for ${matchId}:`, error);
    return undefined;
  }
}

/**
 * Get a random match from S3 that matches the specified type
 */
async function getRandomMatchFromS3(
  matchType: MatchType,
  daysBack: number,
): Promise<S3MatchResult> {
  const keys = await fetchMatchKeysFromS3(daysBack);

  if (keys.length === 0) {
    throw new Error("No matches found in S3");
  }

  // Shuffle and try matches until we find one of the right type
  const shuffled = keys.toSorted(() => Math.random() - 0.5);

  for (const key of shuffled) {
    const rawMatch = await fetchMatchFromS3(key);
    if (!rawMatch) {
      continue;
    }

    const queueType = parseQueueType(rawMatch.info.queueId);

    // Check if this match type matches what we're looking for
    const isMatchingType =
      (matchType === "arena" && queueType === "arena") ||
      (matchType === "aram" && queueType === "aram") ||
      (matchType === "ranked" &&
        (queueType === "solo" || queueType === "flex")) ||
      (matchType === "unranked" &&
        (queueType === "quickplay" || queueType === "draft pick"));

    if (isMatchingType) {
      logger.info(`📦 Using match from S3: ${key}`);
      const match = convertRawMatchToInternalFormat(rawMatch);
      const matchId = MatchIdSchema.parse(rawMatch.metadata.matchId);
      return { match, rawMatch, matchId };
    }
  }

  throw new Error(
    `Could not find a ${matchType} match in the last ${String(daysBack)} days of S3 data`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs();

  // Raw match data is required for match summary generation
  if (!options.useS3) {
    logger.error(
      "❌ The --s3 flag is required. Example data does not include raw match data needed for match summaries.",
    );
    logger.info("   Run with: bun run src/league/review/test-reviews.ts --s3");
    process.exit(1);
  }

  logger.info(`\n${"=".repeat(80)}`);
  logger.info(`Testing AI Review Generation`);
  logger.info(`${"=".repeat(80)}\n`);
  logger.info(`Match Type: ${options.matchType}`);
  logger.info("Review Count:", options.count);
  logger.info(`Source: S3 (last ${String(options.s3Days)} days)`);
  logger.info();

  // Generate multiple reviews
  for (let i = 0; i < options.count; i++) {
    if (options.count > 1) {
      logger.info("─".repeat(80));
      logger.info(`Review ${String(i + 1)}/${String(options.count)}`);
      logger.info("─".repeat(80) + "\n");
    }

    // Get the match from S3 (required for raw match data)
    const { match, rawMatch, matchId } = await getRandomMatchFromS3(
      options.matchType,
      options.s3Days,
    );

    const matchSummary = getMatchSummary(match);

    logger.info(`Match: ${matchSummary}`);
    logger.info(`Queue: ${match.queueType ?? "unknown"}\n`);

    // Fetch timeline from Riot API (required for timeline summary)
    const rawTimeline = await fetchTimelineFromRiotApi(matchId);
    if (!rawTimeline) {
      logger.warn(`⚠️  Skipping match ${matchId} - timeline not available`);
      continue;
    }

    const startTime = Date.now();
    const reviewResult = await generateMatchReview(
      match,
      matchId,
      rawMatch,
      rawTimeline,
    );
    const duration = Date.now() - startTime;

    if (!reviewResult) {
      logger.info("❌ No review generated - API keys not configured");
      logger.info(
        `   Set OPENAI_API_KEY environment variable to generate AI reviews`,
      );
      logger.info();
      continue;
    }

    logger.info("Generated Review:");
    logger.info(`┌${"─".repeat(78)}┐`);
    // Word wrap the review to 76 chars
    const words = reviewResult.text.split(" ");
    let line = "│ ";
    for (const word of words) {
      if (line.length + word.length + 1 > 77) {
        logger.info(line.padEnd(79, " ") + "│");
        line = "│ " + word + " ";
      } else {
        line += word + " ";
      }
    }
    if (line.length > 2) {
      logger.info(line.padEnd(79, " ") + "│");
    }
    logger.info(`└${"─".repeat(78)}┘`);
    logger.info();

    logger.info(`Stats:`);
    logger.info(`  - Length: ${String(reviewResult.text.length)} characters`);
    logger.info(`  - Generation time: ${String(duration)}ms`);
    if (reviewResult.image) {
      logger.info(
        `  - AI Image: Generated (${String(reviewResult.image.length)} bytes)`,
      );
    }
    logger.info();

    if (reviewResult.text.length > 400) {
      logger.info(`⚠️  Warning: Review exceeds 400 character limit!`);
      logger.info();
    }

    if (i < options.count - 1) {
      // Small delay between requests to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  logger.info(`${"=".repeat(80)}\n`);
}

void (async () => {
  try {
    await main();
  } catch (error) {
    logger.error("Error generating review:", error);
    process.exit(1);
  }
})();
