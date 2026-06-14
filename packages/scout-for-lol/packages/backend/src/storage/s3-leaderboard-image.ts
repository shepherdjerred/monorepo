import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "#src/storage/s3-client.ts";
import configuration from "#src/configuration.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { z } from "zod";

// Mirrors the not-found shape handled in s3-leaderboard.ts.
const AwsS3NotFoundErrorSchema = z.object({
  name: z.enum(["NoSuchKey", "NotFound"]),
});

const logger = createLogger("storage-s3-leaderboard-image");

/**
 * S3 key for the current leaderboard chart PNG.
 * Format: leaderboards/competition-{id}/current.png
 */
function generateCurrentLeaderboardImageKey(competitionId: number): string {
  return `leaderboards/competition-${competitionId.toString()}/current.png`;
}

/**
 * S3 key for a historical leaderboard chart PNG snapshot.
 * Format: leaderboards/competition-{id}/snapshots/YYYY-MM-DD.png
 *
 * Mirrors the JSON snapshot key so a chart PNG sits next to the standings
 * JSON it was rendered from.
 */
function generateSnapshotLeaderboardImageKey(
  competitionId: number,
  date: Date,
): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `leaderboards/competition-${competitionId.toString()}/snapshots/${year.toString()}-${month}-${day}.png`;
}

/**
 * Save the rendered leaderboard chart PNG to S3.
 *
 * Writes to two locations, mirroring `saveCachedLeaderboard`:
 * 1. `current.png` (overwrites — the web "latest" view reads this)
 * 2. `snapshots/YYYY-MM-DD.png` (preserves a per-run history)
 *
 * @returns the current-image S3 key, or `null` when `S3_BUCKET_NAME` is not
 *   configured (best-effort: a missing chart never blocks a run).
 */
export async function saveLeaderboardImage(
  competitionId: number,
  calculatedAt: Date,
  png: Buffer,
): Promise<string | null> {
  const bucket = configuration.s3BucketName;
  if (bucket === undefined) {
    logger.warn(
      `[S3LeaderboardImage] ⚠️  S3_BUCKET_NAME not configured, skipping chart image for competition: ${competitionId.toString()}`,
    );
    return null;
  }

  const client = createS3Client();
  const currentKey = generateCurrentLeaderboardImageKey(competitionId);
  const snapshotKey = generateSnapshotLeaderboardImageKey(
    competitionId,
    calculatedAt,
  );
  const metadata = {
    competitionId: competitionId.toString(),
    calculatedAt: calculatedAt.toISOString(),
    uploadedAt: new Date().toISOString(),
  };

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: currentKey,
      Body: png,
      ContentType: "image/png",
      Metadata: metadata,
    }),
  );
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: snapshotKey,
      Body: png,
      ContentType: "image/png",
      Metadata: metadata,
    }),
  );

  logger.info(
    `[S3LeaderboardImage] ✅ Cached leaderboard chart for competition ${competitionId.toString()} (${png.length.toString()} bytes)`,
  );
  return currentKey;
}

/**
 * Load the current leaderboard chart PNG from S3.
 *
 * @returns the PNG bytes, or `null` if the bucket is unconfigured, the image
 *   does not exist yet, or the read fails.
 */
export async function loadLeaderboardImage(
  competitionId: number,
): Promise<Buffer | null> {
  const bucket = configuration.s3BucketName;
  if (bucket === undefined) {
    return null;
  }

  const key = generateCurrentLeaderboardImageKey(competitionId);
  try {
    const client = createS3Client();
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!response.Body) {
      return null;
    }
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (error) {
    const notFoundResult = AwsS3NotFoundErrorSchema.safeParse(error);
    if (notFoundResult.success) {
      return null;
    }
    logger.error(
      `[S3LeaderboardImage] ❌ Error loading leaderboard chart for competition ${competitionId.toString()}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: {
        source: "s3-leaderboard-image-load",
        competitionId: competitionId.toString(),
      },
    });
    return null;
  }
}
