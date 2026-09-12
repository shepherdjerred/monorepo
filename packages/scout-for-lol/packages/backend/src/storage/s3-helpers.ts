import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "#src/storage/s3-client.ts";
import configuration from "#src/configuration.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import type { MatchId } from "@scout-for-lol/data/index.ts";
import { format } from "date-fns";
import { createLogger } from "#src/logger.ts";
import {
  putContentAddressedObject,
  type StoredObject,
} from "#src/storage/object-integrity.ts";
import { validateS3Metadata } from "#src/storage/s3-metadata.ts";

const logger = createLogger("storage-s3-helpers");

/**
 * Generate S3 key (path) for a file with game-centric hierarchy
 * All assets for a game are grouped under games/{date}/{matchId}/
 * This makes it easy to find all assets related to a single game.
 *
 * The layout mirrors `@scout-for-lol/domain`'s `buildMatchArtifactObjectKey`,
 * and `s3-helpers.contract.test.ts` pins the two together. They differ in one
 * respect that is deliberately NOT reconciled here: this builder formats the
 * date in the host's local zone, the domain builder normalizes to UTC, and the
 * deployment sets `TZ=America/Los_Angeles`. Moving this path to UTC is a
 * store-wide re-partition that also requires widening the reconstructed
 * prefixes in `s3-query.ts`, so it is tracked separately rather than folded
 * into the receipts work.
 */
export function generateS3Key(
  matchId: MatchId,
  assetType: string,
  extension: string,
  keyDate: Date,
): string {
  const dateStr = format(keyDate, "yyyy/MM/dd");

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
  additionalLogDetails?: Record<string, unknown>;
  keyDate?: Date;
};

/**
 * Generic function to save content to S3.
 *
 * Resolves to `undefined` only when no bucket is configured — the dev/test
 * no-op. Every real upload is content-addressed: the SHA-256 of the body is
 * computed before the put, stored on the object as user metadata, and returned
 * so the caller can record it. See `object-integrity.ts` for exactly what the
 * post-put ETag comparison verifies.
 */
export async function saveToS3(
  config: SaveToS3Config,
): Promise<StoredObject | undefined> {
  const bucket = configuration.s3BucketName;
  if (bucket === undefined) {
    logger.warn(
      `[S3Storage] ⚠️  S3_BUCKET_NAME not configured, skipping ${config.errorContext} save for match: ${config.matchId}`,
    );
    return undefined;
  }

  logger.info(
    `[S3Storage] ${config.logEmoji} ${config.logMessage}: ${config.matchId}`,
  );

  const key = generateS3Key(
    config.matchId,
    config.assetType,
    config.extension,
    config.keyDate ?? new Date(),
  );
  const startTime = Date.now();

  try {
    const stored = await putContentAddressedObject({
      client: createS3Client(),
      bucket,
      key,
      body: config.body,
      contentType: config.contentType,
      metadata: config.metadata,
      errorContext: config.errorContext,
      retryContext: `${config.errorContext} ${config.matchId}`,
      ...(config.additionalLogDetails === undefined
        ? {}
        : { logDetails: config.additionalLogDetails }),
    });

    const uploadTime = Date.now() - startTime;
    logger.info(
      `[S3Storage] ✅ Successfully saved ${config.errorContext} ${config.matchId} to S3 in ${uploadTime.toString()}ms`,
    );
    logger.info(`[S3Storage] 🔗 S3 location: ${stored.url}`);
    return stored;
  } catch (error) {
    logger.error(
      `[S3Storage] ❌ Failed to save ${config.errorContext} ${config.matchId} to S3:`,
      error,
    );
    throw new Error(
      `Failed to save ${config.errorContext} ${config.matchId} to S3: ${getErrorMessage(error)}`,
      { cause: error },
    );
  }
}

/**
 * Generate S3 key for failed validation payloads
 * Stored under failed-validations/{date}/{matchId}/ for easy identification
 */
function generateFailedValidationS3Key(
  matchId: MatchId,
  assetType: string,
): string {
  const now = new Date();
  const dateStr = format(now, "yyyy/MM/dd");
  return `failed-validations/${dateStr}/${matchId}/${assetType}.json`;
}

/**
 * The shape this function actually reads off a validation failure. A `ZodError`
 * satisfies it, and so does a hand-built completeness report — the payload that
 * omitted a field Riot always sends for a matchmade game is just as much a
 * failed validation, and deserves the same debug artifact.
 */
export type ValidationIssueReport = {
  issues: readonly {
    path: readonly PropertyKey[];
    message: string;
    code: string;
  }[];
};

type SaveFailedPayloadConfig = {
  matchId: MatchId;
  assetType: "match" | "timeline";
  rawPayload: unknown;
  validationError: ValidationIssueReport;
};

/**
 * Save a failed validation payload to S3 for debugging
 * Stores the raw API response with metadata about the validation failure
 */
export async function saveFailedPayloadToS3(
  config: SaveFailedPayloadConfig,
): Promise<void> {
  const { matchId, assetType, rawPayload, validationError } = config;
  const bucket = configuration.s3BucketName;

  if (bucket === undefined) {
    logger.warn(
      `[S3Storage] ⚠️  S3_BUCKET_NAME not configured, skipping failed payload save for match: ${matchId}`,
    );
    return;
  }

  logger.info(`[S3Storage] 💥 Saving failed ${assetType} payload: ${matchId}`);

  try {
    const client = createS3Client();
    const key = generateFailedValidationS3Key(matchId, assetType);

    // Extract the first few validation issues for metadata (limited to avoid hitting S3 metadata size limits)
    const firstIssues = validationError.issues.slice(0, 5).map((issue) => ({
      path: issue.path.map(String).join("."),
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
      Metadata: validateS3Metadata({
        matchId: matchId,
        assetType: assetType,
        validationStatus: "failed",
        issueCount: validationError.issues.length.toString(),
        firstIssuePath: firstIssues[0]?.path ?? "unknown",
        firstIssueMessage: firstIssues[0]?.message ?? "unknown",
        uploadedAt: new Date().toISOString(),
      }),
    });

    await client.send(command);
    logger.info(
      `[S3Storage] ✅ Saved failed ${assetType} payload to s3://${bucket}/${key}`,
    );
  } catch (error) {
    // Don't throw - this is a best-effort debug save
    logger.error(
      `[S3Storage] ❌ Failed to save failed payload for ${matchId}:`,
      error,
    );
  }
}
