import { S3Client } from "@aws-sdk/client-s3";

/**
 * Creates a configured S3Client for use with S3-compatible storage (like SeaweedFS).
 *
 * Uses forcePathStyle: true to ensure path-style addressing is used instead of
 * virtual-hosted-style. This is required for most S3-compatible storage systems.
 *
 * Example:
 * - Path-style: http://endpoint/bucket/key (what we use)
 * - Virtual-hosted-style: http://bucket.endpoint/key (AWS default, doesn't work with SeaweedFS)
 */
export function createS3Client(): S3Client {
  return new S3Client({
    forcePathStyle: true,
    // Bound every S3 call. Without these, a blackholed endpoint (or the
    // SDK's IMDS credential probe under bun) hangs the await forever —
    // observed hanging runReport for 180s+ in CI. With timeouts, a dead
    // endpoint becomes a thrown error that best-effort call sites catch.
    requestHandler: {
      connectionTimeout: 3000,
      requestTimeout: 15_000,
    },
    // Checksum only when an operation requires one. By default the SDK
    // checksums every request body, which it cannot do for a streamed file:
    // a replay PUT (`Body: Bun.file(...)`) failed with "Unable to calculate
    // hash for flowing readable stream". SeaweedFS also doesn't understand
    // the default checksum headers (see `scripts/lib/seaweedfs.ts`). Callers
    // that need integrity verify it themselves — a replay's SHA-256 is
    // checked before it is stored.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}
