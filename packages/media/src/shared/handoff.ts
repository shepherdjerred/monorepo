import { z } from "zod";
import { EvidenceHashSchema } from "./migration.ts";
import { MigrationSelectionSchema } from "./migration-handoff.ts";
import {
  MountEvidenceSchema,
  QuiescenceEvidenceSchema,
} from "./legacy-observer.ts";
import { PublicReleaseAttributesSchema } from "./api.ts";
import {
  HandoffSubtitleSchema,
  HandoffSubtitleEvidenceSchema,
} from "./subtitle-handoff.ts";
import {
  SubtitlePolicyResolutionSchema,
  HandoffSubtitlePolicySchema,
} from "./subtitle-policy.ts";

export const PrepareHandoffSchema = z.strictObject({
  bundleReviewId: z.uuid(),
  bundleReviewVersion: z.int().nonnegative(),
  bundleHash: EvidenceHashSchema,
  reportHash: EvidenceHashSchema,
  recoveryEpoch: z.int().nonnegative(),
  runtimeVersion: z.int().nonnegative(),
  purpose: z.enum(["migration", "recovery"]),
  activation: z.enum(["activate", "extend"]),
  selected: MigrationSelectionSchema.min(1).max(100),
  subtitlePolicies: z
    .array(SubtitlePolicyResolutionSchema)
    .max(100)
    .default([]),
  profiles: z
    .array(
      z.strictObject({
        captureId: z.uuid(),
        sourceProfileId: z.string().regex(/^\d+$/u),
        profileId: z.uuid(),
        version: z.int().nonnegative(),
        snapshotHash: EvidenceHashSchema,
      }),
    )
    .max(25),
});
export const HandoffFileSchema = z.strictObject({
  provenanceKey: EvidenceHashSchema,
  captureId: z.uuid(),
  mediaIds: z.array(z.uuid()).min(1).max(100),
  sourcePath: z.string().min(1).max(4096),
  canonicalPath: z.string().min(1).max(4096),
  libraryKind: z.enum(["movies", "tv"]),
  sizeBytes: z.string().regex(/^\d+$/u),
  capturedChecksum: EvidenceHashSchema.nullable(),
  qualitySourceId: z.string().nullable(),
  existingAssetId: z.uuid().nullable(),
  existingAssetVersion: z.int().nonnegative().nullable(),
  assetId: z.uuid(),
});
export const HandoffScopeSchema = z.strictObject({
  request: PrepareHandoffSchema,
  media: z
    .array(
      z.strictObject({
        mediaId: z.uuid(),
        version: z.int().nonnegative(),
        generation: z.int().nonnegative().nullable(),
        profileId: z.uuid().nullable(),
        profileVersion: z.int().nonnegative().nullable(),
        monitored: z.boolean(),
      }),
    )
    .min(1)
    .max(100),
  claims: z
    .array(
      z.strictObject({
        provenanceKey: EvidenceHashSchema,
        userId: z.uuid(),
        mediaId: z.uuid(),
        includeFutureEpisodes: z.boolean(),
        subtitleLanguages: z.array(z.string()).max(20),
      }),
    )
    .max(100),
  files: z.array(HandoffFileSchema).max(25),
  subtitles: z.array(HandoffSubtitleSchema).max(100).default([]),
  subtitlePolicies: z.array(HandoffSubtitlePolicySchema).max(100).default([]),
  protected: z
    .array(
      z.strictObject({
        provenanceKey: EvidenceHashSchema,
        reason: z.string().min(1).max(100),
      }),
    )
    .max(100),
});
export const HandoffNetworkEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  planId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  quiescence: QuiescenceEvidenceSchema,
  mounts: MountEvidenceSchema,
  capturedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  claims: z
    .array(
      z.strictObject({
        userId: z.uuid(),
        userVersion: z.int().nonnegative(),
        mappingVersion: z.int().nonnegative(),
        credentialId: z.uuid(),
        credentialUpdatedAt: z.iso.datetime(),
        accountId: z.string().min(1),
        serverMachineId: z.string().min(1),
        permittedSectionIds: z.array(z.string().min(1)).max(100),
        permittedMediaKinds: z.array(z.enum(["movie", "series"])).max(2),
        identityHash: EvidenceHashSchema,
      }),
    )
    .max(100),
  plex: z
    .array(
      z.strictObject({
        mediaId: z.uuid(),
        ratingKey: z.string().min(1),
        sectionId: z.string().min(1),
        canonicalPath: z.string().min(1),
        identityHash: EvidenceHashSchema,
      }),
    )
    .max(1000),
  torrents: z
    .array(
      z.strictObject({
        provenanceKey: EvidenceHashSchema,
        infoHash: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
        wireId: z.string().regex(/^[a-f0-9]{40}$/u),
        observationHash: EvidenceHashSchema,
        identityHash: EvidenceHashSchema,
        cleanup: z.literal("protected_legacy_source"),
      }),
    )
    .max(100),
});
export const HandoffFileEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  planId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  workerPodUid: z.string().min(1),
  capturedAt: z.iso.datetime(),
  files: z
    .array(
      z.strictObject({
        assetId: z.uuid(),
        canonicalPath: z.string().min(1),
        checksum: EvidenceHashSchema,
        sizeBytes: z.string().regex(/^\d+$/u),
        identity: z.strictObject({
          device: z.string().regex(/^\d+$/u),
          inode: z.string().regex(/^\d+$/u),
          mtimeNs: z.string().regex(/^-?\d+$/u),
          ctimeNs: z.string().regex(/^-?\d+$/u),
          ancestors: z
            .array(
              z.strictObject({
                path: z.string().min(1).max(4096),
                device: z.string().regex(/^\d+$/u),
                inode: z.string().regex(/^\d+$/u),
              }),
            )
            .min(1)
            .max(256),
        }),
        properties: PublicReleaseAttributesSchema.extend({
          id: z.string(),
          providerId: z.string(),
          title: z.string(),
        }),
        journalDigest: EvidenceHashSchema,
        subtitles: z.array(HandoffSubtitleEvidenceSchema).max(100).default([]),
        unmanagedSidecars: z
          .array(
            z.strictObject({
              canonicalPath: z.string().min(1),
              reason: z.literal("subtitle_ownership_unconfirmed"),
            }),
          )
          .max(100),
      }),
    )
    .max(25),
});
export const ApplyHandoffSchema = z.strictObject({
  expectedVersion: z.int().nonnegative(),
  planHash: EvidenceHashSchema,
  recoveryEpoch: z.int().nonnegative(),
  runtimeVersion: z.int().nonnegative(),
  acknowledgeProtectedLegacySources: z.literal(true),
  acknowledgeRecoveryHolds: z.literal(true),
});
export const HandoffDetailSchema = z.strictObject({
  id: z.uuid(),
  state: z.string(),
  version: z.int().nonnegative(),
  scope: HandoffScopeSchema,
  plan: z.json().nullable(),
  planHash: EvidenceHashSchema.nullable(),
  expiresAt: z.iso.datetime().nullable(),
  receiptId: z.uuid().nullable(),
});
export type HandoffScope = z.infer<typeof HandoffScopeSchema>;
export type HandoffFile = z.infer<typeof HandoffFileSchema>;
