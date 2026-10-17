import { z } from "zod";
import { NativeTorrentObservationSchema } from "./native-torrent.ts";
import {
  ApprovedStorageRootsSchema,
  CanonicalMountEvidenceSchema,
} from "./canonical-storage.ts";
import { QuiescenceEvidenceSchema } from "./legacy-observer.ts";
import { HandoffFileEvidenceSchema } from "./handoff.ts";
import {
  NativeSubtitleSnapshotSchema,
  NativeSubtitleEvidenceSchema,
  NativeSubtitlePolicySnapshotSchema,
} from "./native-subtitles.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const PrepareNativeRecoverySchema = z.strictObject({
  restoreOperationId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  runtimeVersion: z.int().nonnegative(),
  activation: z.enum(["activate", "extend"]),
  assetIds: z.array(z.uuid()).min(1).max(25),
});
export const NativeRecoveryFileSchema = z.strictObject({
  assetId: z.uuid(),
  assetVersion: z.int().nonnegative(),
  canonicalPath: z.string().min(1).max(4096),
  libraryKind: z.enum(["movies", "tv"]),
  checksum: Hash,
  sizeBytes: z.string().regex(/^\d+$/u),
  ownershipEpoch: z.int().nonnegative(),
  properties: z.json(),
  mediaIds: z.array(z.uuid()).min(1).max(100),
  subtitles: z.array(NativeSubtitleSnapshotSchema).max(100),
});
const Ancestor = z.strictObject({
  id: z.uuid(),
  version: z.int().nonnegative(),
  tmdbId: z.int().nullable(),
  externalIds: z.json(),
});
export const NativeRecoveryScopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  request: PrepareNativeRecoverySchema,
  media: z
    .array(
      z.strictObject({
        id: z.uuid(),
        title: z.string(),
        kind: z.enum(["movie", "episode"]),
        version: z.int().nonnegative(),
        tmdbId: z.int().nullable(),
        externalIds: z.json(),
        seasonNumber: z.int().nullable(),
        episodeNumber: z.int().nullable(),
        parent: Ancestor.extend({ parent: Ancestor.nullable() }).nullable(),
        intent: z.json().nullable(),
        profile: z.json().nullable(),
      }),
    )
    .min(1)
    .max(100),
  files: z.array(NativeRecoveryFileSchema).min(1).max(25),
  storageRoots: ApprovedStorageRootsSchema,
  subtitlePolicies: z.array(NativeSubtitlePolicySnapshotSchema).max(100),
  household: z.json(),
  lifecycle: z.json(),
  torrents: z
    .array(
      z.strictObject({
        id: z.uuid(),
        infoHash: z.string(),
        qbittorrentId: z.string().nullable(),
        state: z.string(),
        owned: z.boolean(),
        ownershipEpoch: z.int(),
        seedingPolicy: z.json(),
        observation: NativeTorrentObservationSchema,
        attempts: z.array(z.json()).max(100),
      }),
    )
    .max(25),
});
export const NativeRecoveryNetworkEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  planId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  capturedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  quiescence: QuiescenceEvidenceSchema,
  mounts: CanonicalMountEvidenceSchema,
  plex: z
    .array(
      z.strictObject({
        mediaId: z.uuid(),
        ratingKey: z.string().min(1),
        sectionId: z.string().min(1),
        canonicalPath: z.string().min(1),
        identityHash: Hash,
      }),
    )
    .max(1000),
  torrents: z
    .array(
      z.strictObject({
        torrentId: z.uuid(),
        infoHash: z.string(),
        wireId: z.string().nullable(),
        identityHash: Hash,
        sourceState: z.enum(["present", "removed"]),
      }),
    )
    .max(25),
});
export const NativeRecoveryFileEvidenceSchema = z.strictObject({
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
        checksum: Hash,
        sizeBytes: z.string().regex(/^\d+$/u),
        identity: HandoffFileEvidenceSchema.shape.files.element.shape.identity,
        properties: z.json(),
        journalDigest: Hash,
        subtitles: z.array(NativeSubtitleEvidenceSchema).max(100),
        sidecarInventory: z
          .array(
            z.strictObject({
              canonicalPath: z.string(),
              reason: z.literal("subtitle_ownership_unconfirmed"),
            }),
          )
          .max(100),
      }),
    )
    .max(25),
});
export const ApplyNativeRecoverySchema = z.strictObject({
  expectedVersion: z.int().nonnegative(),
  planHash: Hash,
  recoveryEpoch: z.int().nonnegative(),
  runtimeVersion: z.int().nonnegative(),
  acknowledgePhysicalOwnershipOnly: z.literal(true),
  acknowledgeRecoveryHolds: z.literal(true),
  acknowledgeSubtitlePolicies: z.literal(true),
});
export const NativeRecoveryDetailSchema = z.strictObject({
  id: z.uuid(),
  state: z.string(),
  version: z.int().nonnegative(),
  scope: NativeRecoveryScopeSchema,
  plan: z.json().nullable(),
  planHash: Hash.nullable(),
  expiresAt: z.iso.datetime().nullable(),
  receiptId: z.uuid().nullable(),
});
export const NativeRecoveryInventorySchema = z.strictObject({
  nextCursor: z.uuid().nullable(),
  prerequisites: z.array(z.string()),
  runtime: z.strictObject({
    mode: z.string(),
    recoveryEpoch: z.int(),
    version: z.int(),
  }),
  restoreOperationId: z.uuid().nullable(),
  assets: z
    .array(
      z.strictObject({
        id: z.uuid(),
        version: z.int(),
        titles: z.array(z.string()),
        state: z.string(),
        reasons: z.array(z.string()),
      }),
    )
    .max(100),
  plans: z
    .array(
      z.strictObject({
        id: z.uuid(),
        state: z.string(),
        createdAt: z.iso.datetime(),
      }),
    )
    .max(100),
});
export type NativeRecoveryScope = z.infer<typeof NativeRecoveryScopeSchema>;
export type NativeRecoveryFile = z.infer<typeof NativeRecoveryFileSchema>;
