import { z } from "zod";

export const BackupCadenceSchema = z.enum(["six-hourly", "daily"]);
export type BackupCadence = z.infer<typeof BackupCadenceSchema>;

const RetentionSchema = z.strictObject({
  sixHourly: z.number().int().positive(),
  daily: z.number().int().positive(),
  weekly: z.number().int().positive(),
  monthly: z.number().int().positive(),
  candidateMinimumAgeDays: z.number().int().positive(),
  candidateDelayDays: z.number().int().positive(),
  objectLockDays: z.number().int().positive(),
});

export const BucketPolicySchema = z
  .strictObject({
    name: z.string().min(1),
    mode: z.enum(["protected", "excluded"]),
    cadences: z.array(BackupCadenceSchema),
    excludeSuffixes: z.array(z.string().min(1)),
    reason: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (value.mode === "protected" && value.cadences.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["cadences"],
        message: "Protected buckets require at least one cadence",
      });
    }
    if (value.mode === "excluded" && value.cadences.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["cadences"],
        message: "Excluded buckets cannot declare backup cadences",
      });
    }
  });

export const BackupPolicySchema = z
  .strictObject({
    $schema: z.string().optional(),
    version: z.literal(1),
    retention: RetentionSchema,
    buckets: z.array(BucketPolicySchema).min(1),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const [index, bucket] of value.buckets.entries()) {
      if (seen.has(bucket.name)) {
        context.addIssue({
          code: "custom",
          path: ["buckets", index, "name"],
          message: `Duplicate bucket policy for ${bucket.name}`,
        });
      }
      seen.add(bucket.name);
    }
    if (
      value.retention.candidateMinimumAgeDays < value.retention.objectLockDays
    ) {
      context.addIssue({
        code: "custom",
        path: ["retention", "candidateMinimumAgeDays"],
        message: "GC candidates cannot be younger than the object lock",
      });
    }
  });
export type BackupPolicy = z.infer<typeof BackupPolicySchema>;
export type BucketPolicy = z.infer<typeof BucketPolicySchema>;

export const ObjectHeadersSchema = z.strictObject({
  cacheControl: z.string().optional(),
  contentDisposition: z.string().optional(),
  contentEncoding: z.string().optional(),
  contentLanguage: z.string().optional(),
  contentType: z.string().optional(),
  expires: z.iso.datetime().optional(),
  metadata: z.record(z.string(), z.string()),
});
export type ObjectHeaders = z.infer<typeof ObjectHeadersSchema>;

export const ManifestEntrySchema = z.strictObject({
  schemaVersion: z.literal(1),
  sourceBucket: z.string().min(1),
  sourceKey: z.string(),
  sourceSize: z.number().int().nonnegative(),
  sourceEtag: z.string().min(1),
  sourceLastModified: z.iso.datetime(),
  backupObjectKey: z.string().startsWith("objects/"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  headers: ObjectHeadersSchema,
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const BucketManifestDescriptorSchema = z.strictObject({
  bucket: z.string().min(1),
  key: z.string().startsWith("snapshots/manifests/"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  objectCount: z.number().int().nonnegative(),
  sourceBytes: z.number().int().nonnegative(),
  protectedBytes: z.number().int().nonnegative(),
  copiedObjects: z.number().int().nonnegative(),
  reusedObjects: z.number().int().nonnegative(),
  copiedBytes: z.number().int().nonnegative(),
  durationSeconds: z.number().nonnegative(),
});

export const CompletionMarkerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  snapshotId: z.string().regex(/^\d{8}T\d{6}\.\d{3}Z-[a-f0-9]{12}$/),
  cadence: BackupCadenceSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  manifests: z.array(BucketManifestDescriptorSchema).min(1),
});
export type CompletionMarker = z.infer<typeof CompletionMarkerSchema>;

export const GcCandidateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  objectKey: z.string().startsWith("objects/"),
  objectLastModified: z.iso.datetime(),
  firstObservedUnreferencedAt: z.iso.datetime(),
});
export type GcCandidate = z.infer<typeof GcCandidateSchema>;

export const GcCandidateSetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  candidates: z.array(GcCandidateSchema),
});
export type GcCandidateSet = z.infer<typeof GcCandidateSetSchema>;

export const BackupEnvironmentSchema = z.object({
  SEAWEEDFS_BACKUP_SOURCE_ENDPOINT: z.url(),
  SEAWEEDFS_BACKUP_SOURCE_ACCESS_KEY_ID: z.string().min(1),
  SEAWEEDFS_BACKUP_SOURCE_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BACKUP_ENDPOINT: z.url(),
  R2_BACKUP_ACCESS_KEY_ID: z.string().min(1),
  R2_BACKUP_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BACKUP_BUCKET: z.string().min(1).default("seaweedfs-backups"),
});

export const RestoreEnvironmentSchema = z.object({
  SEAWEEDFS_RESTORE_ENDPOINT: z.url(),
  SEAWEEDFS_RESTORE_ACCESS_KEY_ID: z.string().min(1),
  SEAWEEDFS_RESTORE_SECRET_ACCESS_KEY: z.string().min(1),
});
