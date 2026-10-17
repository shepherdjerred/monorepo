import { z } from "zod";
import {
  PublicationSubtitleEvidenceSchema,
  PublicationSubtitleLineageSchema,
} from "#shared/publication-proof/subtitle-lineage.ts";
import {
  PublicationAuthorityReferenceSchema,
  ClosedCoordinatorObservationSchema,
} from "#shared/publication-proof/references.ts";
import {
  NativeRecoveryScopeSchema,
  NativeRecoveryFileSchema,
  NativeRecoveryFileEvidenceSchema,
  NativeRecoveryNetworkEvidenceSchema,
} from "#shared/native-recovery.ts";
import {
  NativeSubtitleSnapshotSchema,
  NativeFileIdentitySchema,
} from "#shared/native-subtitles.ts";
import { UpgradeCleanupPlanSchema } from "./archive-plan.ts";
import { FilePlanEntrySchema } from "#shared/file-plan.ts";
import {
  NativeTerminalDependencySchema,
  NativeTerminalEvidenceSchema,
} from "./terminal.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Path = z.string().min(1).max(4096);
const Ids = z
  .array(z.uuid())
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate IDs");
export const NativeArchiveSupersessionTargetSchema = z.strictObject({
  continuationId: z.uuid(),
  receiptId: z.uuid(),
  originalCleanupId: z.uuid(),
  version: z.int().nonnegative(),
  descriptorHash: Hash,
  coordinatorOperationId: z.uuid(),
  executionHash: Hash.nullable(),
});
const ArchiveParticipant = z.strictObject({
  assetId: z.uuid(),
  subtitleId: z.uuid().nullable(),
  libraryKind: z.enum(["movies", "tv"]),
  location: z.enum(["rollback", "quarantine"]),
  id: z.string().regex(/^[\w-]{1,100}$/u),
  canonicalPath: Path,
  checksum: Hash,
  sizeBytes: z.string().regex(/^\d+$/u),
  identity: NativeFileIdentitySchema,
});
export const NativeArchiveSupersessionEvidenceSchema = z.strictObject({
  continuationId: z.uuid(),
  descriptorHash: Hash,
  executionHash: Hash.nullable(),
  participants: z.array(ArchiveParticipant).min(1).max(101),
  absentJournals: z
    .array(
      z.strictObject({
        libraryKind: z.enum(["movies", "tv"]),
        canonicalPath: Path,
        ancestors: NativeFileIdentitySchema.shape.ancestors,
      }),
    )
    .min(1)
    .max(101),
});
export const NativeArchiveSupersessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  continuationId: z.uuid(),
  descriptorHash: Hash,
  replacingPlanId: z.uuid(),
  replacingReceiptId: z.uuid(),
  replacingPlanHash: Hash,
  target: NativeArchiveSupersessionTargetSchema,
  closedCoordinator: ClosedCoordinatorObservationSchema,
  evidence: NativeArchiveSupersessionEvidenceSchema,
  supersededAt: z.iso.datetime(),
});
export const PrepareNativeArchiveSchema = z.strictObject({
  restoreOperationId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  runtimeVersion: z.int().nonnegative(),
  activation: z.enum(["activate", "extend"]),
  cleanupIds: z
    .array(z.uuid())
    .min(1)
    .max(25)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate cleanup IDs"),
});
export const PriorNativeBindingSchema = z.strictObject({
  kind: z.literal("prior_native_binding"),
  receiptLifecycle: z.enum(["published", "superseded_archive"]),
  receiptId: z.uuid(),
  planHash: Hash,
  assetId: z.uuid(),
  bindingHash: Hash,
  physicalEvidenceHash: Hash,
  subtitleLineage: PublicationSubtitleLineageSchema.optional(),
});
export const NativeArchiveSubtitleSnapshotSchema =
  NativeSubtitleSnapshotSchema.extend({
    state: z.enum(["installed", "superseded"]),
  });
export const NativeArchiveFileSchema = NativeRecoveryFileSchema.extend({
  role: z.enum(["selected_archive", "retained_archive", "current_playback"]),
  state: z.enum(["published", "superseded"]),
  edition: z.literal("default"),
  editionRootId: z.uuid(),
  sourcePath: Path.nullable(),
  supersededByAssetId: z.uuid().nullable(),
  plexPublishedAt: z.iso.datetime().nullable(),
  rollbackExpiresAt: z.iso.datetime().nullable(),
  coverage: z
    .array(
      z.strictObject({
        mediaId: z.uuid(),
        edition: z.literal("default"),
        current: z.boolean(),
      }),
    )
    .min(1)
    .max(100),
  subtitles: z.array(NativeArchiveSubtitleSnapshotSchema).max(100),
  authority: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("rebaseline") }),
    ...PublicationAuthorityReferenceSchema.options,
  ]),
});
export const NativeArchiveEdgeSchema = z.strictObject({
  id: z.uuid(),
  assetId: z.uuid(),
  successorAssetId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  expiresAt: z.iso.datetime(),
  state: z.literal("pending"),
  version: z.int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  manifest: UpgradeCleanupPlanSchema.nullable(),
  manifestHash: Hash.nullable(),
  derivedPlan: UpgradeCleanupPlanSchema,
  selected: z.boolean(),
  publicationAttempt: z.strictObject({
    id: z.uuid(),
    operationId: z.uuid(),
    recoveryEpoch: z.int().nonnegative(),
    state: z.literal("completed"),
    filePlanHash: Hash,
    entry: FilePlanEntrySchema,
  }),
  successorPublishedAt: z.iso.datetime(),
});
export const NativeArchiveTerminalDependencySchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("legacy_cleanup"),
      dependency: NativeTerminalDependencySchema,
    }),
    z.strictObject({
      kind: z.literal("archive_completion"),
      continuationId: z.uuid(),
      receiptId: z.uuid(),
      originalCleanupId: z.uuid(),
      descriptorHash: Hash,
      completionHash: Hash,
      dependency: NativeTerminalDependencySchema,
    }),
  ],
);
export const NativeArchiveScopeSchema = NativeRecoveryScopeSchema.extend({
  schemaVersion: z.literal(2),
  lifecycleKind: z.literal("superseded_archive"),
  request: PrepareNativeArchiveSchema,
  files: z.array(NativeArchiveFileSchema).min(1).max(25),
  edges: z.array(NativeArchiveEdgeSchema).min(1).max(25),
  terminalDependencies: z.array(NativeArchiveTerminalDependencySchema).max(25),
  currentPlayback: z
    .array(z.strictObject({ assetId: z.uuid(), mediaIds: Ids }))
    .min(1)
    .max(25),
  supersessions: z
    .array(NativeArchiveSupersessionTargetSchema)
    .min(1)
    .max(25)
    .optional(),
});
export const NativeArchiveFileEvidenceSchema =
  NativeRecoveryFileEvidenceSchema.extend({
    schemaVersion: z.literal(2),
    lifecycleKind: z.literal("superseded_archive"),
    terminalEvidence: z.array(NativeTerminalEvidenceSchema).max(25),
    artifactAbsences: z
      .array(
        z.strictObject({
          canonicalPath: Path,
          absentAncestors: NativeFileIdentitySchema.shape.ancestors,
        }),
      )
      .max(2525),
    supersessionEvidence: z
      .array(NativeArchiveSupersessionEvidenceSchema)
      .min(1)
      .max(25)
      .optional(),
    subtitleEvidence: z
      .array(
        z.strictObject({
          assetId: z.uuid(),
          evidence: PublicationSubtitleEvidenceSchema,
        }),
      )
      .min(1)
      .max(25)
      .optional(),
  });
export const NativeArchiveNetworkEvidenceSchema =
  NativeRecoveryNetworkEvidenceSchema.extend({
    schemaVersion: z.literal(2),
    lifecycleKind: z.literal("superseded_archive"),
    supersededCoordinators: z
      .array(
        z.strictObject({
          continuationId: z.uuid(),
          closedCoordinator: ClosedCoordinatorObservationSchema,
        }),
      )
      .min(1)
      .max(25)
      .optional(),
    plex: z.strictObject({
      currentPlayback: z
        .array(
          z.strictObject({
            assetId: z.uuid(),
            assetVersion: z.int().nonnegative(),
            checksum: Hash,
            mediaIds: Ids,
            items: NativeRecoveryNetworkEvidenceSchema.shape.plex,
          }),
        )
        .min(1)
        .max(25),
      archiveAbsence: z
        .array(
          z.strictObject({
            assetId: z.uuid(),
            sectionId: z.string().min(1),
            paths: z.array(Path).min(1).max(202),
            inventoryDigest: Hash,
          }),
        )
        .max(2500),
      inventory: z
        .array(
          z.strictObject({
            sectionId: z.string().min(1),
            kind: z.enum(["movie", "episode"]),
            itemCount: z.int().nonnegative(),
            digest: Hash,
          }),
        )
        .min(1)
        .max(100),
      playback: z.strictObject({
        state: z.literal("clear"),
        checkedAt: z.iso.datetime(),
        scopeHash: Hash,
      }),
    }),
  });
const SubtitleVersion = z.strictObject({
  version: z.int().nonnegative(),
  ownershipEpoch: z.int().nonnegative(),
  videoVersion: z.int().nonnegative(),
});
export const NativeArchiveBindingSchema = z.strictObject({
  assetId: z.uuid(),
  beforeVersion: z.int().nonnegative(),
  assetVersion: z.int().nonnegative(),
  checksum: Hash,
  mediaIds: Ids,
  ownershipEpoch: z.int().nonnegative(),
  subtitles: z
    .array(
      z.strictObject({
        id: z.uuid(),
        before: SubtitleVersion,
        after: SubtitleVersion,
        qualityStatus: NativeSubtitleSnapshotSchema.shape.qualityStatus,
      }),
    )
    .max(100),
  physicalIdentityHash: Hash,
});
export const NativeArchiveContinuationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  allowedAction: z.literal("expire_archive"),
  selectedCleanupId: z.uuid(),
  scope: NativeArchiveScopeSchema,
  fileEvidence: NativeArchiveFileEvidenceSchema,
  bindings: z.array(NativeArchiveBindingSchema).max(25),
  reusedBindings: z.array(PublicationAuthorityReferenceSchema).max(25),
});
export const CleanupNativeArchiveInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("cleanup_native_archive"),
  operationId: z.uuid(),
  continuationId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  generations: z.record(z.uuid(), z.int().nonnegative()),
});
export const NativeArchiveCleanupNetworkEvidenceSchema =
  NativeArchiveNetworkEvidenceSchema.extend({
    continuationId: z.uuid(),
    operationId: z.uuid(),
  });
export const NativeArchiveExecutionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  continuationId: z.uuid(),
  descriptorHash: Hash,
  recoveryEpoch: z.int().nonnegative(),
  participants: z
    .array(
      z.strictObject({
        assetId: z.uuid(),
        subtitleId: z.uuid().nullable(),
        libraryKind: z.enum(["movies", "tv"]),
        location: z.enum(["rollback", "quarantine"]),
        id: z.string().regex(/^[\w-]{1,100}$/u),
        canonicalPath: Path,
        checksum: Hash,
        sizeBytes: z.string().regex(/^\d+$/u),
        identity: NativeFileIdentitySchema,
      }),
    )
    .min(1)
    .max(101),
});
export const NativeArchiveCompletionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  continuationId: z.uuid(),
  receiptId: z.uuid(),
  originalCleanupId: z.uuid(),
  descriptorHash: Hash,
  recoveryEpoch: z.int().nonnegative(),
  asset: NativeArchiveBindingSchema.omit({
    subtitles: true,
    physicalIdentityHash: true,
  }),
  subtitles: z
    .array(
      z.strictObject({
        id: z.uuid(),
        before: SubtitleVersion,
        after: SubtitleVersion,
        qualityStatus: NativeSubtitleSnapshotSchema.shape.qualityStatus,
        checksum: Hash.nullable(),
      }),
    )
    .max(100),
  journals: z
    .array(
      z.strictObject({
        operationId: z.string().min(1).max(255),
        kind: z.literal("purge"),
        source: Path,
        target: Path,
        sha256: Hash,
        previousSha256: z.null(),
        phase: z.literal("complete"),
        manifestHash: Hash,
      }),
    )
    .min(1)
    .max(101),
  absences: z
    .array(
      z.strictObject({
        canonicalPath: Path,
        ancestors: NativeFileIdentitySchema.shape.ancestors,
      }),
    )
    .min(1)
    .max(101),
  completedAt: z.iso.datetime(),
});
export type NativeArchiveScope = z.infer<typeof NativeArchiveScopeSchema>;
export type NativeArchiveFile = z.infer<typeof NativeArchiveFileSchema>;
export type NativeArchiveEdge = z.infer<typeof NativeArchiveEdgeSchema>;
export type NativeArchiveFileEvidence = z.infer<
  typeof NativeArchiveFileEvidenceSchema
>;
export type NativeArchiveNetworkEvidence = z.infer<
  typeof NativeArchiveNetworkEvidenceSchema
>;
export type NativeArchiveBinding = z.infer<typeof NativeArchiveBindingSchema>;
export type PriorNativeBinding = z.infer<typeof PriorNativeBindingSchema>;
export type NativeArchiveContinuation = z.infer<
  typeof NativeArchiveContinuationSchema
>;
export type CleanupNativeArchiveInput = z.infer<
  typeof CleanupNativeArchiveInputSchema
>;
export type NativeArchivePrepareInput = { planId: string; operationId: string };
export type NativeArchiveApplyInput = NativeArchivePrepareInput & {
  planHash: string;
};
export type NativeArchiveCleanupResult = {
  status: "cleaned" | "protected";
  reason?: string;
};
export type NativeArchiveNetworkActivities = {
  observeNativeArchive: (input: NativeArchivePrepareInput) => Promise<void>;
  observeNativeArchiveCleanup: (
    input: CleanupNativeArchiveInput,
  ) => Promise<{ status: "ready" | "protected" | "cleaned"; reason?: string }>;
  nativeArchiveCleanupState: (
    input: CleanupNativeArchiveInput,
  ) => Promise<{ state: string; expiresAt: string }>;
};
export type NativeArchiveFileActivities = {
  prepareNativeArchiveFiles: (
    input: NativeArchivePrepareInput,
  ) => Promise<void>;
  applyNativeArchiveFiles: (input: NativeArchiveApplyInput) => Promise<void>;
  cleanupNativeArchiveFiles: (
    input: CleanupNativeArchiveInput,
  ) => Promise<NativeArchiveCleanupResult>;
};
