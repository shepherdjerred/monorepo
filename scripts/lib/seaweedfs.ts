/**
 * Connection constants for the homelab's SeaweedFS S3 endpoint.
 *
 * Their own module rather than a corner of `s3-static-site.ts`: the CI handoff
 * store needs the endpoint and nothing else, and importing it from the
 * static-site syncer pulled 485 lines of deploy logic into every consumer's
 * dependency graph — including the coverage pool of tests that never exercise
 * a byte of it.
 */

export const SEAWEEDFS_ENDPOINT = "https://seaweedfs-s3.tailnet-1a49.ts.net";

/**
 * Env vars every SeaweedFS-bound aws CLI call needs: SeaweedFS S3 requires
 * s3v4 signing, so the region is pinned to avoid mismatches with newer AWS CLI
 * versions that use CRT-based signing, and the WHEN_REQUIRED settings suppress
 * checksum headers AWS CLI v2 sends by default but SeaweedFS does not
 * understand.
 */
export const SEAWEEDFS_AWS_ENV: Record<string, string> = {
  AWS_DEFAULT_REGION: "us-east-1",
  AWS_REQUEST_CHECKSUM_CALCULATION: "WHEN_REQUIRED",
  AWS_RESPONSE_CHECKSUM_VALIDATION: "WHEN_REQUIRED",
};
