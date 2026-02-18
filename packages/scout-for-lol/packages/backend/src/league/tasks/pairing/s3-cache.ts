import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "@scout-for-lol/backend/storage/s3-client.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import configuration from "@scout-for-lol/backend/configuration.ts";
import { getErrorMessage } from "@scout-for-lol/backend/utils/errors.ts";
import {
  type ServerPairingStats,
  type WeeklyPairingCache,
  WeeklyPairingCacheSchema,
} from "@scout-for-lol/data/index";
import {
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
  endOfISOWeek,
  isBefore,
} from "date-fns";

const logger = createLogger("pairing-s3-cache");

/**
 * Generate S3 key for weekly pairing cache
 */
function generateCacheKey(
  serverId: string,
  year: number,
  weekNumber: number,
): string {
  return `pairing-stats/${serverId}/week-${year.toString()}-${weekNumber.toString().padStart(2, "0")}.json`;
}

/**
 * Check if a week is complete (all days have passed)
 */
export function isWeekComplete(year: number, weekNumber: number): boolean {
  const now = new Date();
  const { end: weekEnd } = getWeekDateRange(year, weekNumber);
  return isBefore(weekEnd, now);
}

/**
 * Get current week info
 */
export function getCurrentWeekInfo(): { year: number; weekNumber: number } {
  const now = new Date();
  return {
    year: getISOWeekYear(now),
    weekNumber: getISOWeek(now),
  };
}

/**
 * Get date range for a specific ISO week
 */
export function getWeekDateRange(
  year: number,
  weekNumber: number,
): { start: Date; end: Date } {
  // Create a date in the middle of the target year
  const jan4 = new Date(year, 0, 4); // Jan 4 is always in week 1
  const weekStart = startOfISOWeek(jan4);

  // Move to the target week
  const targetWeekStart = new Date(weekStart);
  targetWeekStart.setDate(targetWeekStart.getDate() + (weekNumber - 1) * 7);

  const targetWeekEnd = endOfISOWeek(targetWeekStart);

  return { start: targetWeekStart, end: targetWeekEnd };
}

/**
 * Try to load cached pairing stats from S3
 * Returns null if cache doesn't exist or is invalid
 */
export async function loadCachedPairingStats(
  serverId: string,
  year: number,
  weekNumber: number,
): Promise<WeeklyPairingCache | null> {
  const bucket = configuration.s3BucketName;

  if (bucket === undefined) {
    logger.warn(
      "[PairingCache] S3_BUCKET_NAME not configured, skipping cache read",
    );
    return null;
  }

  const key = generateCacheKey(serverId, year, weekNumber);
  logger.info(`[PairingCache] Attempting to load cache from ${key}`);

  try {
    const client = createS3Client();
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await client.send(command);

    if (!response.Body) {
      logger.info("[PairingCache] Cache file has no body");
      return null;
    }

    const bodyString = await response.Body.transformToString();
    const data = JSON.parse(bodyString);
    const validated = WeeklyPairingCacheSchema.parse(data);

    // Only use cache if the week was complete when cached
    if (!validated.isComplete) {
      logger.info(
        "[PairingCache] Cache exists but week was not complete, ignoring",
      );
      return null;
    }

    logger.info(
      `[PairingCache] Successfully loaded cache for week ${year.toString()}-${weekNumber.toString()}`,
    );
    return validated;
  } catch (error) {
    const message = getErrorMessage(error);
    // NoSuchKey is expected when cache doesn't exist
    if (message.includes("NoSuchKey") || message.includes("not found")) {
      logger.info(
        `[PairingCache] No cache found for week ${year.toString()}-${weekNumber.toString()}`,
      );
    } else {
      logger.warn(`[PairingCache] Error loading cache: ${message}`);
    }
    return null;
  }
}

/**
 * Save pairing stats to S3 cache
 * Only saves if the week is complete
 */
export async function saveCachedPairingStats(
  stats: ServerPairingStats,
  year: number,
  weekNumber: number,
): Promise<boolean> {
  const bucket = configuration.s3BucketName;

  if (bucket === undefined) {
    logger.warn(
      "[PairingCache] S3_BUCKET_NAME not configured, skipping cache write",
    );
    return false;
  }

  const isComplete = isWeekComplete(year, weekNumber);

  if (!isComplete) {
    logger.info(
      `[PairingCache] Week ${year.toString()}-${weekNumber.toString()} not complete, skipping cache write`,
    );
    return false;
  }

  const cache: WeeklyPairingCache = {
    version: "v1",
    serverId: stats.serverId,
    year,
    weekNumber,
    isComplete: true,
    stats,
  };

  const key = generateCacheKey(stats.serverId, year, weekNumber);
  logger.info(`[PairingCache] Saving cache to ${key}`);

  try {
    const client = createS3Client();
    const body = JSON.stringify(cache, null, 2);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
      Metadata: {
        serverId: stats.serverId,
        year: year.toString(),
        weekNumber: weekNumber.toString(),
        matchesAnalyzed: stats.totalMatchesAnalyzed.toString(),
        pairingsCount: stats.pairings.length.toString(),
      },
    });

    await client.send(command);
    logger.info(
      `[PairingCache] Successfully saved cache for week ${year.toString()}-${weekNumber.toString()}`,
    );
    return true;
  } catch (error) {
    logger.error(
      `[PairingCache] Error saving cache: ${getErrorMessage(error)}`,
    );
    return false;
  }
}

/**
 * Get pairing stats for a specific week, using cache if available
 */
export async function getPairingStatsForWeek(
  serverId: string,
  year: number,
  weekNumber: number,
  calculateFn: (startDate: Date, endDate: Date) => Promise<ServerPairingStats>,
): Promise<ServerPairingStats> {
  // Try to load from cache first (only for complete weeks)
  const cached = await loadCachedPairingStats(serverId, year, weekNumber);
  if (cached) {
    logger.info(
      `[PairingCache] Using cached stats for week ${year.toString()}-${weekNumber.toString()}`,
    );
    return cached.stats;
  }

  // Calculate fresh stats
  const { start, end } = getWeekDateRange(year, weekNumber);
  logger.info(
    `[PairingCache] Calculating fresh stats for week ${year.toString()}-${weekNumber.toString()}`,
  );

  const stats = await calculateFn(start, end);

  // Cache if week is complete
  await saveCachedPairingStats(stats, year, weekNumber);

  return stats;
}
