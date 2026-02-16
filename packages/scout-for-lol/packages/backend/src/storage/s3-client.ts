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
  });
}
