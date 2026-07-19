import type { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";

const logger = createLogger("storage-s3-put-retry");

/**
 * Now that S3 is the canonical raw store, a PutObject that fails on a transient
 * error (socket timeout, 5xx, connection reset) must not immediately surface as
 * total data loss — the ingest path re-throws and the caller drops the write.
 * Bound the blast radius of a flaky SeaweedFS/network moment with a small
 * exponential backoff before giving up. A persistent failure still throws.
 */
const MAX_PUT_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;

// A 4xx (bad request, access denied, no-such-bucket) is deterministic — retrying
// it just wastes time and hammers the endpoint. Only retry 5xx / network-level
// failures. Narrow the error shape with Zod rather than a type assertion.
const S3ErrorShapeSchema = z.object({
  name: z.string().optional(),
  $metadata: z.object({ httpStatusCode: z.number().optional() }).optional(),
});

function isRetryableError(error: unknown): boolean {
  const parsed = S3ErrorShapeSchema.safeParse(error);
  if (!parsed.success) {
    // A non-SDK error (e.g. a raw network Error with no $metadata) is most
    // likely a transient connection failure — retry it.
    return true;
  }
  const status = parsed.data.$metadata?.httpStatusCode;
  if (status !== undefined) {
    return status >= 500;
  }
  // No HTTP status means the request never reached the server (timeout, DNS,
  // connection reset) — transient, worth retrying.
  return true;
}

/**
 * Send a PutObjectCommand with a bounded exponential backoff on transient
 * errors. Deterministic (4xx) failures and the final attempt throw.
 */
export async function sendPutWithRetry(
  client: S3Client,
  command: PutObjectCommand,
  context: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_PUT_ATTEMPTS; attempt++) {
    try {
      await client.send(command);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_PUT_ATTEMPTS || !isRetryableError(error)) {
        throw error;
      }
      const delayMs = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      logger.warn(
        `[S3Storage] ⚠️  PutObject attempt ${attempt.toString()}/${MAX_PUT_ATTEMPTS.toString()} failed for ${context}; retrying in ${delayMs.toString()}ms: ${getErrorMessage(error)}`,
      );
      await Bun.sleep(delayMs);
    }
  }
  // Unreachable — the loop either returns or throws — but satisfies the compiler.
  throw lastError instanceof Error
    ? lastError
    : new Error(`PutObject failed for ${context}`);
}
