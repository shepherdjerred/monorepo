import { z } from "zod";
import {
  NativeRecoveryScopeSchema,
  NativeRecoveryFileSchema,
  NativeRecoveryNetworkEvidenceSchema,
  PrepareNativeRecoverySchema,
} from "#shared/native-recovery.ts";
import {
  NativeSubtitleSnapshotSchema,
  NativeSubtitleEvidenceSchema,
  NativeFileIdentitySchema,
} from "#shared/native-subtitles.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Path = z.string().min(1).max(4096);
export const NativeQuarantineJournalsSchema = z
  .array(
    z.strictObject({ libraryKind: z.enum(["movies", "tv"]), digest: Hash }),
  )
  .min(1)
  .max(2);
export const PrepareNativeQuarantineSchema = PrepareNativeRecoverySchema.extend(
  {
    lifecycleKind: z.literal("committed_quarantine"),
  },
);
export const NativeQuarantineSubtitleSchema =
  NativeSubtitleSnapshotSchema.extend({
    state: z.literal("quarantined"),
  });
export const NativeQuarantineFileSchema = NativeRecoveryFileSchema.extend({
  groupHash: Hash,
  quarantineId: z.uuid(),
  libraryPath: Path,
  subtitles: z.array(NativeQuarantineSubtitleSchema).max(100),
  sidecars: z
    .array(
      z.strictObject({
        subtitleId: z.uuid(),
        quarantineId: z.uuid(),
        libraryPath: Path,
        checksum: Hash,
      }),
    )
    .max(100),
});
export const NativeQuarantineDecisionSchema = z.strictObject({
  id: z.uuid(),
  mediaId: z.uuid(),
  version: z.int().nonnegative(),
  generation: z.int().nonnegative(),
  recoveryEpoch: z.int().nonnegative(),
  manifest: z.json(),
  manifestHash: Hash,
  evidence: z.json(),
  quarantinedAt: z.iso.datetime(),
  purgeAfter: z.iso.datetime(),
});
export const NativeQuarantineGroupSchema = z.strictObject({
  groupHash: Hash,
  mediaIds: z.array(z.uuid()).min(1).max(100),
  assetIds: z.array(z.uuid()).min(1).max(25),
  decisions: z.array(NativeQuarantineDecisionSchema).min(1).max(100),
});
export const NativeQuarantineScopeSchema = NativeRecoveryScopeSchema.extend({
  schemaVersion: z.literal(2),
  lifecycleKind: z.literal("committed_quarantine"),
  request: PrepareNativeQuarantineSchema,
  files: z.array(NativeQuarantineFileSchema).min(1).max(25),
  groups: z.array(NativeQuarantineGroupSchema).min(1).max(25),
});
export const NativeQuarantineNetworkEvidenceSchema =
  NativeRecoveryNetworkEvidenceSchema.extend({
    schemaVersion: z.literal(2),
    lifecycleKind: z.literal("committed_quarantine"),
    plex: z
      .array(
        z.strictObject({
          mediaId: z.uuid(),
          sectionId: z.string().min(1),
          canonicalPath: Path,
          state: z.literal("quarantined_absent"),
          identityHash: Hash,
          activePlayback: z.literal(false),
        }),
      )
      .max(1000),
  });
export const NativeQuarantineParticipantEvidenceSchema = z.strictObject({
  assetId: z.uuid(),
  subtitleId: z.uuid().nullable(),
  libraryKind: z.enum(["movies", "tv"]),
  libraryPath: Path,
  quarantineId: z.uuid(),
  canonicalPath: Path,
  quarantinePath: Path,
  checksum: Hash,
  sizeBytes: z.string().regex(/^\d+$/u),
  identity: NativeFileIdentitySchema,
  canonicalAbsence: z.strictObject({
    ancestors: NativeFileIdentitySchema.shape.ancestors,
  }),
  quarantineOperationId: z.string().min(1).max(255),
});
export const NativeQuarantineFileEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(2),
  lifecycleKind: z.literal("committed_quarantine"),
  planId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  workerPodUid: z.string().min(1),
  capturedAt: z.iso.datetime(),
  participants: z
    .array(NativeQuarantineParticipantEvidenceSchema)
    .min(1)
    .max(2525),
  embedded: z.array(NativeSubtitleEvidenceSchema).max(2500),
  journalDigest: Hash,
  groupJournals: z
    .array(
      z.strictObject({
        groupHash: Hash,
        journals: NativeQuarantineJournalsSchema,
      }),
    )
    .min(1)
    .max(25),
});
export const NativeQuarantineBindingSchema = z.strictObject({
  assetId: z.uuid(),
  beforeVersion: z.int().nonnegative(),
  assetVersion: z.int().nonnegative(),
  checksum: Hash,
  mediaIds: z.array(z.uuid()).min(1).max(100),
  ownershipEpoch: z.int().nonnegative(),
  subtitles: z
    .array(
      z.strictObject({
        id: z.uuid(),
        version: z.int().nonnegative(),
        videoVersion: z.int().nonnegative(),
        checksum: Hash.nullable(),
        storageKind: z.enum(["sidecar", "embedded"]),
      }),
    )
    .max(100),
});
export const NativeQuarantineContinuationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  allowedAction: z.literal("restore"),
  group: NativeQuarantineGroupSchema,
  files: z.array(NativeQuarantineFileSchema).min(1).max(25),
  participants: z
    .array(NativeQuarantineParticipantEvidenceSchema)
    .min(1)
    .max(2525),
  bindings: z.array(NativeQuarantineBindingSchema).min(1).max(25),
  journals: NativeQuarantineJournalsSchema,
});
export const NativeQuarantineRestorationSchema = z.strictObject({
  continuationId: z.uuid(),
  decisionId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  mediaIds: z.array(z.uuid()).min(1).max(100),
  generations: z.record(z.uuid(), z.int().nonnegative()),
  assets: z
    .array(
      z.strictObject({
        assetId: z.uuid(),
        assetVersion: z.int().nonnegative(),
        checksum: Hash,
      }),
    )
    .min(1)
    .max(25),
});
export type NativeQuarantineScope = z.infer<typeof NativeQuarantineScopeSchema>;
export type NativeQuarantineFile = z.infer<typeof NativeQuarantineFileSchema>;
export type NativeQuarantineFileEvidence = z.infer<
  typeof NativeQuarantineFileEvidenceSchema
>;
export type NativeQuarantineContinuation = z.infer<
  typeof NativeQuarantineContinuationSchema
>;
