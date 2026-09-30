import { createSignedS3Request } from "@shepherdjerred/s3-signed-request";
import { z } from "zod/v4";

const S3ErrorShapeSchema = z.object({
  name: z.string().optional(),
  code: z.string().optional(),
  $metadata: z.object({ httpStatusCode: z.number().optional() }).optional(),
});

export type S3ErrorShape = z.infer<typeof S3ErrorShapeSchema>;

/**
 * Parse the AWS SDK error shape callers need for status/code/name dispatch.
 * Returns undefined for anything else (plain Errors, strings, null), so
 * callers fail closed to "not a recognized S3 error".
 */
export function parseS3ErrorShape(error: unknown): S3ErrorShape | undefined {
  const parsed = S3ErrorShapeSchema.safeParse(error);
  return parsed.success ? parsed.data : undefined;
}

const TRANSIENT_STORAGE_ERROR_PATTERN =
  /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)\b/i;

function isTransientStorageFailure(error: unknown): boolean {
  const shape = parseS3ErrorShape(error);
  if (shape === undefined) {
    return false;
  }
  const statusCode = shape.$metadata?.httpStatusCode;
  if (
    statusCode !== undefined &&
    (statusCode === 408 || statusCode === 429 || statusCode >= 500)
  ) {
    return true;
  }
  // The structured `code` is the only reliable carrier: Bun's AWS SDK reports a
  // mid-request socket close as `TimeoutError` / "The socket connection was
  // closed unexpectedly", with ECONNRESET only on `code`.
  const code = shape.code ?? "";
  return TRANSIENT_STORAGE_ERROR_PATTERN.test(
    error instanceof Error ? `${code} ${error.name} ${error.message}` : code,
  );
}

/**
 * Allowlist for retrying S3-backed metric restoration: only transport
 * failures and retryable statuses. Everything else — notably S3 AccessDenied
 * from a broken credential or bucket policy — is permanent and must fail fast
 * with a single error instead of retrying forever.
 *
 * Walks the error and its `.cause` chain (the same traversal
 * `collectErrorMessages` uses for activity failures) because an HTTP handler
 * may wrap the connection failure: the transport code and `$metadata` can live
 * one or more levels below a generic outer error.
 */
export function isTransientStorageError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (isTransientStorageFailure(current)) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

export type S3PutObjectConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | undefined;
  endpoint: string;
  bucket: string;
  key: string;
  region: string;
  forcePathStyle: boolean;
  contentType: string;
};

export async function putS3Object(
  config: S3PutObjectConfig,
  body: string,
): Promise<void> {
  const request = createSignedS3Request(config, {
    method: "PUT",
    key: config.key,
    body,
    contentType: config.contentType,
  });
  const response = await fetch(request);

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `S3 upload failed (${String(response.status)}): ${responseBody}`,
    );
  }
}
