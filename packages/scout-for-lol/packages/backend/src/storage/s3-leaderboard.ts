import {
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  CachedLeaderboardSchema,
  type CachedLeaderboard,
  type CompetitionId,
} from "@scout-for-lol/data/index.ts";
import configuration from "#src/configuration.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import {
  leaderboardSnapshotFetchTotal,
  leaderboardSnapshotFetchDurationSeconds,
} from "#src/metrics/index.ts";
import { z } from "zod";

// Schema for AWS S3 "not found" errors
const AwsS3NotFoundErrorSchema = z.object({
  name: z.enum(["NoSuchKey", "NotFound"]),
});

const logger = createLogger("storage-s3-leaderboard");

// ============================================================================
// S3 Key Generation
// ============================================================================

/**
 * Generate S3 key for current leaderboard
 * Format: leaderboards/competition-{id}/current.json
 */
function generateCurrentLeaderboardKey(competitionId: number): string {
  return `leaderboards/competition-${competitionId.toString()}/current.json`;
}

/**
 * Generate S3 key for historical leaderboard snapshot
 * Format: leaderboards/competition-{id}/snapshots/YYYY-MM-DD.json
 */
function generateSnapshotLeaderboardKey(
  competitionId: number,
  date: Date,
): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `leaderboards/competition-${competitionId.toString()}/snapshots/${year.toString()}-${month}-${day}.json`;
}

// ============================================================================
// Save Leaderboard to S3
// ============================================================================

/**
 * Save leaderboard to S3 with versioning
 *
 * Saves to two locations:
 * 1. Current leaderboard (overwrites previous)
 * 2. Daily snapshot (preserves history)
 *
 * @param leaderboard Leaderboard data to cache
 * @returns Promise that resolves when both saves complete
 */
export async function saveCachedLeaderboard(
  leaderboard: CachedLeaderboard,
): Promise<void> {
  const bucket = configuration.s3BucketName;

  if (bucket === undefined) {
    logger.warn(
      `[S3Leaderboard] ⚠️  S3_BUCKET_NAME not configured, skipping cache for competition: ${leaderboard.competitionId.toString()}`,
    );
    return;
  }

  logger.info(
    `[S3Leaderboard] 💾 Caching leaderboard for competition ${leaderboard.competitionId.toString()}`,
  );

  try {
    const client = createS3Client();
    const body = JSON.stringify(leaderboard, null, 2);

    const currentKey = generateCurrentLeaderboardKey(leaderboard.competitionId);
    const snapshotKey = generateSnapshotLeaderboardKey(
      leaderboard.competitionId,
      new Date(leaderboard.calculatedAt),
    );

    logger.info(`[S3Leaderboard] 📝 Upload details:`, {
      bucket,
      currentKey,
      snapshotKey,
      sizeBytes: new TextEncoder().encode(body).length,
      entryCount: leaderboard.entries.length,
      version: leaderboard.version,
      calculatedAt: leaderboard.calculatedAt,
    });

    const startTime = Date.now();

    // Save to current location (overwrites)
    const currentCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: currentKey,
      Body: body,
      ContentType: "application/json",
      Metadata: {
        competitionId: leaderboard.competitionId.toString(),
        version: leaderboard.version,
        calculatedAt: leaderboard.calculatedAt,
        entryCount: leaderboard.entries.length.toString(),
        uploadedAt: new Date().toISOString(),
      },
    });

    await client.send(currentCommand);

    // Save to snapshot location (preserves history)
    const snapshotCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: snapshotKey,
      Body: body,
      ContentType: "application/json",
      Metadata: {
        competitionId: leaderboard.competitionId.toString(),
        version: leaderboard.version,
        calculatedAt: leaderboard.calculatedAt,
        entryCount: leaderboard.entries.length.toString(),
        uploadedAt: new Date().toISOString(),
      },
    });

    await client.send(snapshotCommand);

    const uploadTime = Date.now() - startTime;
    logger.info(
      `[S3Leaderboard] ✅ Successfully cached leaderboard for competition ${leaderboard.competitionId.toString()} in ${uploadTime.toString()}ms`,
    );
    logger.info(`[S3Leaderboard] 🔗 Current: s3://${bucket}/${currentKey}`);
    logger.info(`[S3Leaderboard] 🔗 Snapshot: s3://${bucket}/${snapshotKey}`);
  } catch (error) {
    logger.error(
      `[S3Leaderboard] ❌ Failed to cache leaderboard for competition ${leaderboard.competitionId.toString()}:`,
      error,
    );

    // Re-throw the error so the caller can handle it appropriately
    throw new Error(
      `Failed to cache leaderboard for competition ${leaderboard.competitionId.toString()}: ${getErrorMessage(error)}`,
      { cause: error },
    );
  }
}

// ============================================================================
// Load Leaderboard from S3
// ============================================================================

/**
 * Load current cached leaderboard from S3
 *
 * @param competitionId Competition ID to load leaderboard for
 * @returns Cached leaderboard or null if not found or invalid
 */
export async function loadCachedLeaderboard(
  competitionId: number,
): Promise<CachedLeaderboard | null> {
  const bucket = configuration.s3BucketName;

  if (bucket === undefined) {
    logger.warn(
      `[S3Leaderboard] ⚠️  S3_BUCKET_NAME not configured, cannot load cache for competition: ${competitionId.toString()}`,
    );
    return null;
  }

  const key = generateCurrentLeaderboardKey(competitionId);

  logger.info(
    `[S3Leaderboard] 📥 Loading cached leaderboard for competition ${competitionId.toString()}`,
  );

  try {
    const client = createS3Client();
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await client.send(command);

    if (!response.Body) {
      logger.warn(`[S3Leaderboard] No body in response for key: ${key}`);
      return null;
    }

    // Read the stream to a string
    const bodyString = await response.Body.transformToString();

    // Parse JSON
    let jsonData: unknown;
    try {
      jsonData = JSON.parse(bodyString);
    } catch (error) {
      logger.error(
        `[S3Leaderboard] Failed to parse JSON from S3 key ${key}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "s3-leaderboard-json-parse",
          competitionId: competitionId.toString(),
        },
      });
      return null;
    }

    // Validate against schema
    const result = CachedLeaderboardSchema.safeParse(jsonData);
    if (!result.success) {
      logger.error(
        `[S3Leaderboard] Cached leaderboard failed validation for competition ${competitionId.toString()}:`,
        result.error,
      );
      Sentry.captureException(result.error, {
        tags: {
          source: "s3-leaderboard-validation",
          competitionId: competitionId.toString(),
        },
      });
      return null;
    }

    logger.info(
      `[S3Leaderboard] ✅ Successfully loaded cached leaderboard for competition ${competitionId.toString()}`,
    );
    logger.info(
      `[S3Leaderboard] 📊 Cached at: ${result.data.calculatedAt}, Entries: ${result.data.entries.length.toString()}`,
    );

    return result.data;
  } catch (error) {
    // Check if it's a NoSuchKey error (file doesn't exist)
    // AWS SDK errors have the error code in the 'name' property
    const notFoundResult = AwsS3NotFoundErrorSchema.safeParse(error);

    if (notFoundResult.success) {
      logger.info(
        `[S3Leaderboard] No cached leaderboard found for competition ${competitionId.toString()}`,
      );
      return null;
    }

    logger.error(
      `[S3Leaderboard] ❌ Error loading cached leaderboard for competition ${competitionId.toString()}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: {
        source: "s3-leaderboard-load",
        competitionId: competitionId.toString(),
      },
    });
    return null;
  }
}

// ============================================================================
// Load Historical Leaderboard Snapshots from S3
// ============================================================================

function snapshotPrefix(competitionId: CompetitionId): string {
  return `leaderboards/competition-${competitionId.toString()}/snapshots/`;
}

/**
 * Schema for AWS ListObjectsV2 response items we care about.
 */
const S3ObjectListSchema = z.object({
  Contents: z
    .array(
      z.object({
        Key: z.string(),
      }),
    )
    .optional(),
});

const SNAPSHOT_FETCH_CHUNK_SIZE = 20;

async function fetchSnapshotByKey(
  bucket: string,
  key: string,
  competitionId: CompetitionId,
): Promise<CachedLeaderboard | null> {
  const start = Date.now();
  try {
    const client = createS3Client();
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await client.send(command);
    leaderboardSnapshotFetchDurationSeconds.observe(
      { operation: "get" },
      (Date.now() - start) / 1000,
    );

    if (!response.Body) {
      leaderboardSnapshotFetchTotal.inc({ status: "missing" });
      logger.warn(`[S3Leaderboard] No body for snapshot key ${key}`);
      return null;
    }

    const bodyString = await response.Body.transformToString();
    let jsonData: unknown;
    try {
      jsonData = JSON.parse(bodyString);
    } catch (parseError) {
      leaderboardSnapshotFetchTotal.inc({ status: "parse_error" });
      logger.warn(
        `[S3Leaderboard] ⚠️  Invalid JSON in snapshot ${key}:`,
        parseError,
      );
      return null;
    }

    const result = CachedLeaderboardSchema.safeParse(jsonData);
    if (!result.success) {
      leaderboardSnapshotFetchTotal.inc({ status: "parse_error" });
      logger.warn(
        `[S3Leaderboard] ⚠️  Snapshot ${key} failed validation:`,
        result.error.message,
      );
      return null;
    }

    leaderboardSnapshotFetchTotal.inc({ status: "success" });
    return result.data;
  } catch (error) {
    leaderboardSnapshotFetchDurationSeconds.observe(
      { operation: "get" },
      (Date.now() - start) / 1000,
    );

    const notFoundResult = AwsS3NotFoundErrorSchema.safeParse(error);
    if (notFoundResult.success) {
      leaderboardSnapshotFetchTotal.inc({ status: "missing" });
      return null;
    }

    leaderboardSnapshotFetchTotal.inc({ status: "parse_error" });
    logger.warn(
      `[S3Leaderboard] ⚠️  Failed to fetch snapshot ${key} for competition ${competitionId.toString()}:`,
      error,
    );
    return null;
  }
}

/**
 * Load every historical leaderboard snapshot for a competition.
 *
 * Reads all `leaderboards/competition-{id}/snapshots/YYYY-MM-DD.json` keys
 * from S3, validates each, and returns them sorted ascending by `calculatedAt`.
 *
 * Invalid or unreadable individual snapshots are skipped-and-logged (not
 * thrown) — a single corrupted file shouldn't break the whole chart.
 *
 * Returns `[]` when:
 * - `S3_BUCKET_NAME` env is not configured (matches `loadCachedLeaderboard`)
 * - the snapshots prefix has no objects yet
 * - listing or fetching fails entirely (logged + Sentry)
 */
export async function loadHistoricalLeaderboardSnapshots(
  competitionId: CompetitionId,
): Promise<CachedLeaderboard[]> {
  const bucket = configuration.s3BucketName;
  if (bucket === undefined) {
    logger.warn(
      `[S3Leaderboard] ⚠️  S3_BUCKET_NAME not configured, cannot load history for competition: ${competitionId.toString()}`,
    );
    return [];
  }

  const prefix = snapshotPrefix(competitionId);
  logger.info(
    `[S3Leaderboard] 📥 Loading historical snapshots from s3://${bucket}/${prefix}`,
  );

  let keys: string[];
  const listStart = Date.now();
  try {
    const client = createS3Client();
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
    });
    const response = await client.send(command);
    leaderboardSnapshotFetchDurationSeconds.observe(
      { operation: "list" },
      (Date.now() - listStart) / 1000,
    );

    const parsed = S3ObjectListSchema.safeParse(response);
    if (!parsed.success) {
      logger.error(
        `[S3Leaderboard] ❌ Unexpected ListObjectsV2 response shape for competition ${competitionId.toString()}`,
      );
      Sentry.captureException(parsed.error, {
        tags: {
          source: "s3-leaderboard-list-history",
          competitionId: competitionId.toString(),
        },
      });
      return [];
    }

    keys = (parsed.data.Contents ?? [])
      .map((obj) => obj.Key)
      .filter((key) => key.endsWith(".json"));
  } catch (error) {
    leaderboardSnapshotFetchDurationSeconds.observe(
      { operation: "list" },
      (Date.now() - listStart) / 1000,
    );
    logger.error(
      `[S3Leaderboard] ❌ Failed to list snapshots for competition ${competitionId.toString()}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: {
        source: "s3-leaderboard-list-history",
        competitionId: competitionId.toString(),
      },
    });
    return [];
  }

  if (keys.length === 0) {
    logger.info(
      `[S3Leaderboard] No historical snapshots found for competition ${competitionId.toString()}`,
    );
    return [];
  }

  // Bounded parallelism to avoid swamping S3 for season-long competitions.
  const fetchedChunks: (CachedLeaderboard | null)[] = [];
  for (let i = 0; i < keys.length; i += SNAPSHOT_FETCH_CHUNK_SIZE) {
    const chunkKeys = keys.slice(i, i + SNAPSHOT_FETCH_CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunkKeys.map((key) => fetchSnapshotByKey(bucket, key, competitionId)),
    );
    fetchedChunks.push(...chunkResults);
  }

  const valid: CachedLeaderboard[] = [];
  for (const snapshot of fetchedChunks) {
    if (snapshot !== null) {
      valid.push(snapshot);
    }
  }

  // Sort ascending by calculatedAt so consumers can rely on chronological order.
  valid.sort(
    (a, b) =>
      new Date(a.calculatedAt).getTime() - new Date(b.calculatedAt).getTime(),
  );

  logger.info(
    `[S3Leaderboard] ✅ Loaded ${valid.length.toString()}/${keys.length.toString()} valid snapshots for competition ${competitionId.toString()}`,
  );

  return valid;
}
