import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "#src/storage/s3-client.ts";
import { z } from "zod";
import configuration from "#src/configuration.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { format } from "date-fns";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("storage-s3-prematch");

/**
 * Generate S3 key for prematch data.
 * Pattern: prematch/{date}/{gameId}/{assetType}.{ext}
 */
function generatePrematchS3Key(
  gameId: number,
  assetType: string,
  extension: string,
): string {
  const now = new Date();
  const dateStr = format(now, "yyyy/MM/dd");
  return `prematch/${dateStr}/${gameId.toString()}/${assetType}.${extension}`;
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
  returnUrl?: boolean;
};

/**
 * Save prematch content to S3 storage.
 */
export async function savePrematchToS3(
  config: SavePrematchToS3Config,
): Promise<string | undefined> {
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
    returnUrl,
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

  try {
    const client = createS3Client();
    const key = generatePrematchS3Key(gameId, assetType, extension);
    const StringSchema = z.string();
    const BytesSchema = z.instanceof(Uint8Array);

    const stringResult = StringSchema.safeParse(body);
    const bodyBuffer: Uint8Array = stringResult.success
      ? new TextEncoder().encode(stringResult.data)
      : BytesSchema.parse(body);
    const sizeBytes = bodyBuffer.length;

    logger.info(`[S3Storage] 📝 Upload details:`, {
      bucket,
      key,
      sizeBytes,
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
    logger.info(
      `[S3Storage] ✅ Saved ${errorContext} game ${gameIdStr} to S3 in ${uploadTime.toString()}ms`,
    );

    return returnUrl === true ? s3Url : undefined;
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
