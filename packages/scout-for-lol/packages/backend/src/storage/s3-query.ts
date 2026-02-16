import { GetObjectCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { createS3Client } from "@scout-for-lol/backend/storage/s3-client.ts";
import configuration from "@scout-for-lol/backend/configuration.ts";
import { getErrorMessage } from "@scout-for-lol/backend/utils/errors.ts";
import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data/index";
import { eachDayOfInterval, format, startOfDay, endOfDay } from "date-fns";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

// Timeout for individual S3 operations (30 seconds)
const S3_REQUEST_TIMEOUT_MS = 30000;
// Timeout specifically for body stream reading (15 seconds)
const BODY_STREAM_TIMEOUT_MS = 15000;
// Retry configuration
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [1000, 2000, 4000];

const logger = createLogger("storage-s3-query");

/**
 * Read S3 response body with an independent timeout.
 * This protects against hung streams that the request-level abort doesn't catch.
 */
async function readBodyWithTimeout(
  body: { transformToString: () => Promise<string> },
  timeoutMs: number,
  key: string,
): Promise<string> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Body stream timeout after ${timeoutMs.toString()}ms`));
    }, timeoutMs);
  });

  try {
    logger.debug(`[S3Query] 📖 Reading body stream for ${key}`);
    const result = await Promise.race([body.transformToString(), timeoutPromise]);
    logger.debug(`[S3Query] ✅ Body stream read complete for ${key}`);
    return result;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate date prefixes for S3 listing between start and end dates (inclusive)
 * Returns paths in format: games/YYYY/MM/DD/
 */
function generateDatePrefixes(startDate: Date, endDate: Date): string[] {
  const days = eachDayOfInterval({
    start: startOfDay(startDate),
    end: endOfDay(endDate),
  });

  return days.map((day) => {
    const year = format(day, "yyyy");
    const month = format(day, "MM");
    const dayStr = format(day, "dd");
    return `games/${year}/${month}/${dayStr}/`;
  });
}

/**
 * Check if a match includes any of the specified participant PUUIDs
 */
function matchIncludesParticipant(match: RawMatch, puuids: string[]): boolean {
  return match.metadata.participants.some((puuid) => puuids.includes(puuid));
}

/**
 * Process match download results and filter by participant PUUIDs
 */
function processMatchResults(
  results: PromiseSettledResult<{ key: string; match: RawMatch | null }>[],
  puuids: string[],
): RawMatch[] {
  const matches: RawMatch[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value.match) {
      continue;
    }

    const { match } = result.value;
    if (!matchIncludesParticipant(match, puuids)) {
      continue;
    }

    matches.push(match);
  }
  return matches;
}

/**
 * Check if an error is retryable (network/timeout errors, not parse errors)
 */
function isRetryableError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes("timeout") ||
    message.includes("Timeout") ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ENOTFOUND") ||
    message.includes("socket hang up") ||
    message.includes("network")
  );
}

/**
 * Fetch and parse a match from S3 with timeout and retry logic
 */
async function getMatchFromS3(client: S3Client, bucket: string, key: string): Promise<RawMatch | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, S3_REQUEST_TIMEOUT_MS);

    try {
      if (attempt > 0) {
        const backoffMs = RETRY_BACKOFF_MS[attempt - 1] ?? 4000;
        logger.info(
          `[S3Query] 🔄 Retry ${attempt.toString()}/${MAX_RETRIES.toString()} for ${key} after ${backoffMs.toString()}ms`,
        );
        await sleep(backoffMs);
      }

      logger.debug(
        `[S3Query] 📥 Downloading match ${key} (attempt ${(attempt + 1).toString()}/${(MAX_RETRIES + 1).toString()})`,
      );
      const startTime = Date.now();

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const response = await client.send(command, {
        abortSignal: abortController.signal,
      });

      if (!response.Body) {
        clearTimeout(timeoutId);
        logger.warn(`[S3Query] No body in response for key: ${key}`);
        return null;
      }

      // Use body stream timeout to prevent hanging on stream read
      const bodyString = await readBodyWithTimeout(response.Body, BODY_STREAM_TIMEOUT_MS, key);
      clearTimeout(timeoutId);

      const elapsed = Date.now() - startTime;
      logger.debug(`[S3Query] ✅ Downloaded match ${key} in ${elapsed.toString()}ms`);

      // Parse and validate the match data with Zod schema for runtime type safety
      const matchData = JSON.parse(bodyString);
      const match = RawMatchSchema.parse(matchData);

      return match;
    } catch (error) {
      clearTimeout(timeoutId);

      const errorMessage = getErrorMessage(error);

      if (abortController.signal.aborted) {
        logger.warn(`[S3Query] ⏱️ Request timeout after ${S3_REQUEST_TIMEOUT_MS.toString()}ms for key: ${key}`);
        // Timeout is retryable
        if (attempt < MAX_RETRIES) {
          continue;
        }
        logger.warn(`[S3Query] ❌ All retries exhausted for ${key} (timeout)`);
        return null;
      }

      // Check if error is retryable
      if (isRetryableError(error) && attempt < MAX_RETRIES) {
        logger.warn(`[S3Query] ⚠️ Retryable error for ${key}: ${errorMessage}`);
        continue;
      }

      // Non-retryable error (parse error, validation error, etc.) - don't retry
      logger.warn(`[S3Query] ❌ Failed to fetch or parse match ${key}: ${errorMessage}`);
      return null;
    }
  }

  // Should not reach here, but just in case
  return null;
}

/**
 * Query matches from S3 within a date range, filtered by participant PUUIDs
 *
 * @param startDate Start of date range (inclusive)
 * @param endDate End of date range (inclusive)
 * @param puuids Array of participant PUUIDs to filter by
 * @returns Array of matches that occurred in the date range and include any of the specified participants
 */
export async function queryMatchesByDateRange(startDate: Date, endDate: Date, puuids: string[]): Promise<RawMatch[]> {
  const bucket = configuration.s3BucketName;

  if (!bucket) {
    logger.warn("[S3Query] S3_BUCKET_NAME not configured, returning empty results");
    return [];
  }

  if (puuids.length === 0) {
    logger.warn("[S3Query] No PUUIDs provided, returning empty results");
    return [];
  }

  logger.info(`[S3Query] 🔍 Querying matches from ${startDate.toISOString()} to ${endDate.toISOString()}`);
  logger.info(`[S3Query] 👥 Filtering for ${puuids.length.toString()} participants`);

  const client = createS3Client();
  const dayPrefixes = generateDatePrefixes(startDate, endDate);
  const matches: RawMatch[] = [];
  let totalObjects = 0;
  let matchedObjects = 0;

  logger.info(`[S3Query] 📅 Scanning ${dayPrefixes.length.toString()} day(s)`);

  // Process days in batches to avoid overwhelming S3 and memory
  const BATCH_SIZE = 5; // Process 5 days at a time
  const MAX_CONCURRENT_DOWNLOADS = 10; // Limit concurrent match downloads
  const MAX_CONSECUTIVE_ERRORS = 3; // Stop if we get too many consecutive errors

  let consecutiveErrors = 0;

  for (let i = 0; i < dayPrefixes.length; i += BATCH_SIZE) {
    const batch = dayPrefixes.slice(i, i + BATCH_SIZE);

    for (const prefix of batch) {
      try {
        const listCommand = new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
        });

        const response = await client.send(listCommand, {
          abortSignal: AbortSignal.timeout(S3_REQUEST_TIMEOUT_MS),
        });

        if (!response.Contents || response.Contents.length === 0) {
          logger.info(`[S3Query] No objects found for prefix: ${prefix}`);
          continue;
        }

        logger.info(`[S3Query] Found ${response.Contents.length.toString()} object(s) in ${prefix}`);

        // Filter for only match.json files (games/{date}/{matchId}/match.json)
        const matchJsonKeys = response.Contents.flatMap((obj) =>
          obj.Key?.endsWith("/match.json") ? [obj.Key] : [],
        ).slice(0, 1000); // Limit to prevent memory issues

        logger.info(`[S3Query] Found ${matchJsonKeys.length.toString()} match.json file(s) in ${prefix}`);
        totalObjects += matchJsonKeys.length;

        // Get all keys for this day
        const keys = matchJsonKeys;

        if (keys.length === 0) {
          logger.info(`[S3Query] No valid keys found for ${prefix}`);
          continue;
        }

        // Process matches in smaller concurrent batches to avoid overwhelming S3
        for (let j = 0; j < keys.length; j += MAX_CONCURRENT_DOWNLOADS) {
          const keyBatch = keys.slice(j, j + MAX_CONCURRENT_DOWNLOADS);

          const matchPromises = keyBatch.map(async (key) => {
            try {
              const match = await getMatchFromS3(client, bucket, key);
              return { key, match };
            } catch (error) {
              logger.warn(`[S3Query] Failed to fetch match ${key}: ${getErrorMessage(error)}`);
              return { key, match: null };
            }
          });

          const results = await Promise.allSettled(matchPromises);
          const batchMatches = processMatchResults(results, puuids);
          matches.push(...batchMatches);
          matchedObjects += batchMatches.length;
        }
      } catch (error) {
        logger.error(`[S3Query] Error processing prefix ${prefix}: ${getErrorMessage(error)}`);
        consecutiveErrors++;

        // Circuit breaker: if we get too many consecutive errors, stop processing
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          logger.error(`[S3Query] ❌ Too many consecutive errors (${consecutiveErrors.toString()}), stopping query`);
          throw new Error(
            `S3 query failed after ${consecutiveErrors.toString()} consecutive errors. Last error: ${getErrorMessage(error)}`,
          );
        }

        continue;
      }

      // Reset error counter on successful processing
      consecutiveErrors = 0;
    }

    // Log progress every few batches
    if ((i / BATCH_SIZE) % 5 === 0 && i > 0) {
      const progress = Math.round((i / dayPrefixes.length) * 100);
      logger.info(
        `[S3Query] 📈 Progress: ${progress.toString()}% (${i.toString()}/${dayPrefixes.length.toString()} days processed, ${matchedObjects.toString()} matches found)`,
      );
    }

    // Add a small delay between batches to be nice to S3
    if (i + BATCH_SIZE < dayPrefixes.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  logger.info(
    `[S3Query] ✅ Query complete: ${matchedObjects.toString()}/${totalObjects.toString()} matches matched filter`,
  );
  logger.info(`[S3Query] 📊 Returning ${matches.length.toString()} matches`);

  return matches;
}
