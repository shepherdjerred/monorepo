import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "@shepherdjerred/scout-backend/storage/s3-client.ts";
import { z, type ZodError } from "zod";
import configuration from "@shepherdjerred/scout-backend/configuration.ts";
import { getErrorMessage } from "@shepherdjerred/scout-backend/utils/errors.ts";
import type { MatchId } from "@shepherdjerred/scout-data/index";
import { format } from "date-fns";
import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";

const logger = createLogger("storage-s3-helpers");

/**
 * Generate S3 key (path) for a file with game-centric hierarchy
 * All assets for a game are grouped under games/{date}/{matchId}/
 * This makes it easy to find all assets related to a single game.
 */
function generateS3Key(matchId: MatchId, assetType: string, extension: string): string {
  const now = new Date();
  const dateStr = format(now, "yyyy/MM/dd");

  return `games/${dateStr}/${matchId}/${assetType}.${extension}`;
}

type SaveToS3Config = {
  matchId: MatchId;
  assetType: string;
  extension: string;
  body: string | Uint8Array;
  contentType: string;
  metadata: Record<string, string>;
  logEmoji: string;
  logMessage: string;
  errorContext: string;
  returnUrl?: boolean;
  additionalLogDetails?: Record<string, unknown>;
};

/**
 * Generic function to save content to S3
 */
export async function saveToS3(config: SaveToS3Config): Promise<string | undefined> {
  const {
    matchId,
    assetType,
    extension,
    body,
    contentType,
    metadata,
    logEmoji,
    logMessage,
    errorContext,
    returnUrl,
    additionalLogDetails,
  } = config;
  const bucket = configuration.s3BucketName;

  if (!bucket) {
    logger.warn(`[S3Storage] ⚠️  S3_BUCKET_NAME not configured, skipping ${errorContext} save for match: ${matchId}`);
    return undefined;
  }

  logger.info(`[S3Storage] ${logEmoji} ${logMessage}: ${matchId}`);

  try {
    const client = createS3Client();
    const key = generateS3Key(matchId, assetType, extension);
    const StringSchema = z.string();
    const BytesSchema = z.instanceof(Uint8Array);

    // Try to validate as string first, then bytes
    let bodyBuffer: Uint8Array;
    const stringResult = StringSchema.safeParse(body);
    if (stringResult.success) {
      bodyBuffer = new TextEncoder().encode(stringResult.data);
    } else {
      bodyBuffer = BytesSchema.parse(body);
    }
    const sizeBytes = bodyBuffer.length;

    logger.info(`[S3Storage] 📝 Upload details:`, {
      bucket,
      key,
      sizeBytes,
      ...additionalLogDetails,
    });

    const startTime = Date.now();

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bodyBuffer,
      ContentType: contentType,
      Metadata: {
        ...metadata,
        uploadedAt: new Date().toISOString(),
      },
    });

    await client.send(command);

    const uploadTime = Date.now() - startTime;
    const s3Url = `s3://${bucket}/${key}`;
    logger.info(`[S3Storage] ✅ Successfully saved ${errorContext} ${matchId} to S3 in ${uploadTime.toString()}ms`);
    logger.info(`[S3Storage] 🔗 S3 location: ${s3Url}`);

    return returnUrl ? s3Url : undefined;
  } catch (error) {
    logger.error(`[S3Storage] ❌ Failed to save ${errorContext} ${matchId} to S3:`, error);
    throw new Error(`Failed to save ${errorContext} ${matchId} to S3: ${getErrorMessage(error)}`);
  }
}

/**
 * Generate S3 key for failed validation payloads
 * Stored under failed-validations/{date}/{matchId}/ for easy identification
 */
function generateFailedValidationS3Key(matchId: MatchId, assetType: string): string {
  const now = new Date();
  const dateStr = format(now, "yyyy/MM/dd");
  return `failed-validations/${dateStr}/${matchId}/${assetType}.json`;
}

type SaveFailedPayloadConfig = {
  matchId: MatchId;
  assetType: "match" | "timeline";
  rawPayload: unknown;
  validationError: ZodError;
};

/**
 * Save a failed validation payload to S3 for debugging
 * Stores the raw API response with metadata about the validation failure
 */
export async function saveFailedPayloadToS3(config: SaveFailedPayloadConfig): Promise<void> {
  const { matchId, assetType, rawPayload, validationError } = config;
  const bucket = configuration.s3BucketName;

  if (!bucket) {
    logger.warn(`[S3Storage] ⚠️  S3_BUCKET_NAME not configured, skipping failed payload save for match: ${matchId}`);
    return;
  }

  logger.info(`[S3Storage] 💥 Saving failed ${assetType} payload: ${matchId}`);

  try {
    const client = createS3Client();
    const key = generateFailedValidationS3Key(matchId, assetType);

    // Extract the first few validation issues for metadata (limited to avoid hitting S3 metadata size limits)
    const firstIssues = validationError.issues.slice(0, 5).map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    }));

    const body = JSON.stringify(rawPayload, null, 2);
    const bodyBuffer = new TextEncoder().encode(body);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bodyBuffer,
      ContentType: "application/json",
      Metadata: {
        matchId: matchId,
        assetType: assetType,
        validationStatus: "failed",
        issueCount: validationError.issues.length.toString(),
        firstIssuePath: firstIssues[0]?.path ?? "unknown",
        firstIssueMessage: firstIssues[0]?.message ?? "unknown",
        uploadedAt: new Date().toISOString(),
      },
    });

    await client.send(command);
    logger.info(`[S3Storage] ✅ Saved failed ${assetType} payload to s3://${bucket}/${key}`);
  } catch (error) {
    // Don't throw - this is a best-effort debug save
    logger.error(`[S3Storage] ❌ Failed to save failed payload for ${matchId}:`, error);
  }
}
