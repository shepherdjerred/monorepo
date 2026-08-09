import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "#src/storage/s3-client.ts";
import configuration from "#src/configuration.ts";
import * as Sentry from "@sentry/bun";
import { createLogger } from "#src/logger.ts";
import { z } from "zod";
import { validateS3Metadata } from "#src/storage/s3-metadata.ts";
import {
  VisualizationSnapshotSchema,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";

// Mirrors the not-found shape handled in s3-leaderboard.ts.
const AwsS3NotFoundErrorSchema = z.object({
  name: z.enum(["NoSuchKey", "NotFound"]),
});

const logger = createLogger("storage-s3-report-run");

/**
 * S3 key for a report run's rendered chart PNG.
 * Format: reports/report-{reportId}/runs/{runId}.png
 */
function generateReportRunImageKey(reportId: number, runId: number): string {
  return `reports/report-${reportId.toString()}/runs/${runId.toString()}.png`;
}

function generateReportRunVisualizationKey(
  reportId: number,
  runId: number,
): string {
  return `reports/report-${reportId.toString()}/runs/${runId.toString()}.visualization.json`;
}

export async function saveReportRunVisualization(
  reportId: number,
  runId: number,
  snapshot: VisualizationSnapshot,
): Promise<{ key: string; size: number } | null> {
  const bucket = configuration.s3BucketName;
  if (bucket === undefined) return null;
  const key = generateReportRunVisualizationKey(reportId, runId);
  const body = Buffer.from(
    JSON.stringify(VisualizationSnapshotSchema.parse(snapshot)),
  );
  try {
    await createS3Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "application/json",
        Metadata: validateS3Metadata({
          reportId: reportId.toString(),
          runId: runId.toString(),
          artifact: "visualization-snapshot-v1",
          uploadedAt: new Date().toISOString(),
        }),
      }),
    );
    return { key, size: body.length };
  } catch (error) {
    logger.error(`[S3ReportRun] Failed to upload visualization ${key}:`, error);
    Sentry.captureException(error, {
      tags: {
        source: "s3-report-run-visualization-upload",
        reportId: reportId.toString(),
        runId: runId.toString(),
      },
    });
    throw error;
  }
}

export async function loadReportRunVisualization(
  reportId: number,
  runId: number,
): Promise<VisualizationSnapshot | null> {
  const bucket = configuration.s3BucketName;
  if (bucket === undefined) return null;
  const key = generateReportRunVisualizationKey(reportId, runId);
  try {
    const response = await createS3Client().send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!response.Body) return null;
    return VisualizationSnapshotSchema.parse(
      JSON.parse(await response.Body.transformToString()),
    );
  } catch (error) {
    if (AwsS3NotFoundErrorSchema.safeParse(error).success) return null;
    logger.error(`[S3ReportRun] Failed to load visualization ${key}:`, error);
    Sentry.captureException(error, {
      tags: {
        source: "s3-report-run-visualization-load",
        reportId: reportId.toString(),
        runId: runId.toString(),
      },
    });
    return null;
  }
}

/**
 * Persist a report run's rendered chart PNG to S3.
 *
 * @returns the S3 key, or `null` when `S3_BUCKET_NAME` is not configured
 *   (best-effort: a missing image never fails a run — the text body is still
 *   stored on the ReportRun row).
 */
export async function saveReportRunImage(
  reportId: number,
  runId: number,
  png: Buffer,
): Promise<string | null> {
  const bucket = configuration.s3BucketName;
  if (bucket === undefined) {
    logger.warn(
      `[S3ReportRun] ⚠️  S3_BUCKET_NAME not configured, skipping image for report ${reportId.toString()} run ${runId.toString()}`,
    );
    return null;
  }

  const key = generateReportRunImageKey(reportId, runId);
  const client = createS3Client();
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: png,
        ContentType: "image/png",
        Metadata: validateS3Metadata({
          reportId: reportId.toString(),
          runId: runId.toString(),
          uploadedAt: new Date().toISOString(),
        }),
      }),
    );
  } catch (error) {
    logger.error(
      `[S3ReportRun] ❌ Failed to upload report run image ${key} — image will be missing but run continues:`,
      error,
    );
    Sentry.captureException(error, {
      tags: {
        source: "s3-report-run-image-upload",
        reportId: reportId.toString(),
        runId: runId.toString(),
      },
    });
    return null;
  }
  logger.info(
    `[S3ReportRun] ✅ Stored report run image ${key} (${png.length.toString()} bytes)`,
  );
  return key;
}

/**
 * Load a report run's chart PNG from S3.
 *
 * @returns the PNG bytes, or `null` if the bucket is unconfigured, the image
 *   does not exist, or the read fails.
 */
export async function loadReportRunImage(
  reportId: number,
  runId: number,
): Promise<Buffer | null> {
  const bucket = configuration.s3BucketName;
  if (bucket === undefined) {
    return null;
  }

  const key = generateReportRunImageKey(reportId, runId);
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
      `[S3ReportRun] ❌ Error loading report run image for report ${reportId.toString()} run ${runId.toString()}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: {
        source: "s3-report-run-image-load",
        reportId: reportId.toString(),
        runId: runId.toString(),
      },
    });
    return null;
  }
}
