import policyJson from "#policy" with { type: "json" };
import {
  BackupPolicySchema,
  type BackupCadence,
  type BackupPolicy,
  type BucketPolicy,
} from "./schemas.ts";

export const SEAWEEDFS_BACKUP_POLICY: BackupPolicy =
  BackupPolicySchema.parse(policyJson);

export function policyForCadence(
  policy: BackupPolicy,
  cadence: BackupCadence,
): BucketPolicy[] {
  return policy.buckets.filter(
    (bucket) =>
      bucket.mode === "protected" && bucket.cadences.includes(cadence),
  );
}

export function evaluateCoverage(
  liveBuckets: readonly string[],
  policy: BackupPolicy,
): { unclassified: string[]; missingProtected: string[] } {
  const live = new Set(liveBuckets);
  const classified = new Set(policy.buckets.map((bucket) => bucket.name));
  return {
    unclassified: liveBuckets.filter((bucket) => !classified.has(bucket)),
    missingProtected: policy.buckets
      .filter((bucket) => bucket.mode === "protected" && !live.has(bucket.name))
      .map((bucket) => bucket.name),
  };
}

export function objectIsProtected(key: string, policy: BucketPolicy): boolean {
  const normalized = key.toLocaleLowerCase("en-US");
  return !policy.excludeSuffixes.some((suffix) =>
    normalized.endsWith(suffix.toLocaleLowerCase("en-US")),
  );
}
