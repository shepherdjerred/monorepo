import { createS3Client } from "#src/storage/s3-client.ts";
import configuration from "#src/configuration.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { format } from "date-fns";
import { createLogger } from "#src/logger.ts";
import {
  putContentAddressedObject,
  type StoredObject,
} from "#src/storage/object-integrity.ts";

const logger = createLogger("storage-s3-prematch");

/**
 * Generate S3 key for prematch data.
 * Pattern: prematch/{date}/{gameId}/{assetType}.{ext}
 */
function generatePrematchS3Key(
  resourceId: string,
  assetType: string,
  extension: string,
  keyDate: Date,
): string {
  const dateStr = format(keyDate, "yyyy/MM/dd");
  return `prematch/${dateStr}/${resourceId}/${assetType}.${extension}`;
}

type SavePrematchToS3Config = {
  gameId: number;
  assetType: string;
  extension: string;
  body: string | Uint8Array;
  contentType: string;
  metadata: Record<string, string>;
  logEmoji: string;
  logMessage: string;
  errorContext: string;
  /** Stable source timestamp for idempotent match-keyed assets. */
  keyDate?: Date;
  /** Full natural identity when a numeric game ID is not globally unique. */
  resourceId?: string;
};

/**
 * Save prematch content to S3 storage.
 *
 * Resolves to `undefined` only when no bucket is configured. Real uploads are
 * content-addressed on the same terms as `saveToS3`; see `object-integrity.ts`.
 */
export async function savePrematchToS3(
  config: SavePrematchToS3Config,
): Promise<StoredObject | undefined> {
  const {
    gameId,
    assetType,
    extension,
    body,
    contentType,
    metadata,
    logEmoji,
    logMessage,
    errorContext,
    keyDate,
    resourceId,
  } = config;
  const bucket = configuration.s3BucketName;
  const gameIdStr = gameId.toString();

  if (bucket === undefined) {
    logger.warn(
      `[S3Storage] ⚠️  S3_BUCKET_NAME not configured, skipping ${errorContext} save for game: ${gameIdStr}`,
    );
    return undefined;
  }

  logger.info(`[S3Storage] ${logEmoji} ${logMessage}: game ${gameIdStr}`);

  const startTime = Date.now();
  const key = generatePrematchS3Key(
    resourceId ?? gameIdStr,
    assetType,
    extension,
    keyDate ?? new Date(),
  );

  try {
    const stored = await putContentAddressedObject({
      client: createS3Client(),
      bucket,
      key,
      body,
      contentType,
      metadata,
      errorContext,
      retryContext: `${errorContext} game ${gameIdStr}`,
    });

    const uploadTime = Date.now() - startTime;
    logger.info(
      `[S3Storage] ✅ Saved ${errorContext} game ${gameIdStr} to S3 in ${uploadTime.toString()}ms`,
    );
    return stored;
  } catch (error) {
    logger.error(
      `[S3Storage] ❌ Failed to save ${errorContext} game ${gameIdStr} to S3:`,
      error,
    );
    throw new Error(
      `Failed to save ${errorContext} game ${gameIdStr} to S3: ${getErrorMessage(error)}`,
      { cause: error },
    );
  }
}
