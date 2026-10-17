import { z } from "zod";
import {
  NativeRecoveryScopeSchema,
  NativeRecoveryNetworkEvidenceSchema,
} from "#shared/native-recovery.ts";
import {
  PublicationIntentSchema,
  PublicationEntryIntentSchema,
  PublicationParticipantSchema,
} from "#shared/publication-proof/intent.ts";
import {
  PublicationEffectSchema,
  PublicationEffectRefSchema,
  PublicationHashSchema as Hash,
} from "#shared/publication-proof/effects.ts";
import { NativeArchiveNetworkEvidenceSchema } from "./archive.ts";
import { ClosedCoordinatorObservationSchema } from "#shared/publication-proof/references.ts";

export const PrepareNativeCompensationSchema = z.strictObject({
  lifecycleKind: z.literal("publication_compensation"),
  restoreOperationId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  runtimeVersion: z.int().nonnegative(),
  activation: z.enum(["activate", "extend"]),
  transitionId: z.uuid(),
});
export const ApplyNativeCompensationSchema = z.strictObject({
  expectedVersion: z.int().nonnegative(),
  planHash: Hash,
  recoveryEpoch: z.int().nonnegative(),
  runtimeVersion: z.int().nonnegative(),
  acknowledgeCompensationOnly: z.literal(true),
  acknowledgeRecoveryHolds: z.literal(true),
  acknowledgeSuccessorRetained: z.literal(true),
});
export const RevokedReservationSchema = z.strictObject({
  mediaId: z.uuid(),
  edition: z.literal("default"),
  attemptId: z.uuid(),
  generation: z.int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export const InterruptedPublicationWorkSchema = z.strictObject({
  transitionId: z.uuid(),
  intentHash: Hash,
  attemptId: z.uuid(),
  birthEpoch: z.int().nonnegative(),
  filePlanHash: Hash,
  attemptSnapshotHash: Hash,
  reservations: z.array(RevokedReservationSchema).max(100),
  reservationSetHash: Hash,
});
export const CompensationSettlementSchema =
  InterruptedPublicationWorkSchema.omit({ reservations: true }).extend({
    releasedReservations: z.array(RevokedReservationSchema).max(100),
  });
export const CompensationTransitionRefSchema =
  InterruptedPublicationWorkSchema.pick({
    transitionId: true,
    intentHash: true,
    attemptId: true,
    birthEpoch: true,
    filePlanHash: true,
  });
export const NativeCompensationScopeSchema = NativeRecoveryScopeSchema.omit({
  subtitlePolicies: true,
}).extend({
  schemaVersion: z.literal(2),
  lifecycleKind: z.literal("publication_compensation"),
  request: PrepareNativeCompensationSchema,
  transition: CompensationTransitionRefSchema,
  intent: PublicationIntentSchema,
  interruptedWork: InterruptedPublicationWorkSchema,
  entries: z.array(PublicationEntryIntentSchema).min(1).max(25),
  previousCompensation: z
    .strictObject({
      continuationId: z.uuid(),
      descriptorHash: Hash,
      executionHash: Hash.nullable(),
      coordinatorOperationId: z.uuid(),
    })
    .nullable(),
  requiredAbsences: z
    .array(
      z.strictObject({
        assetId: z.uuid(),
        libraryKind: z.enum(["movies", "tv"]),
        canonicalPath: z.string().min(1).max(4096),
      }),
    )
    .max(2525),
});
export const NativeCompensationStepSchema = z.strictObject({
  stepId: z.string().regex(/^[\w-]{1,100}$/u),
  entryOperationId: z.string().regex(/^[\w-]{1,100}$/u),
  kind: z.enum(["rollback_video", "restore_sidecar", "unlink_redundant"]),
  operationId: z.string().regex(/^[\w-]{1,100}$/u),
  assetId: z.uuid(),
  subtitleId: z.uuid().nullable(),
  libraryKind: z.enum(["movies", "tv"]),
  sourcePath: z.string().min(1).max(4096),
  targetPath: z.string().min(1).max(4096).nullable(),
  checksum: Hash,
  previousChecksum: Hash.nullable(),
  retainedSuccessorPath: z.string().min(1).max(4096).nullable(),
});
export const NativeCompensationFileEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(2),
  lifecycleKind: z.literal("publication_compensation"),
  planId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  workerPodUid: z.string().min(1),
  capturedAt: z.iso.datetime(),
  transitionId: z.uuid(),
  intentHash: Hash,
  acknowledgedEffects: z.array(PublicationEffectSchema),
  effectPrefixHash: Hash,
  participants: z.array(PublicationParticipantSchema).min(1),
  steps: z.array(NativeCompensationStepSchema),
  journalDigests: z
    .array(
      z.strictObject({ libraryKind: z.enum(["movies", "tv"]), digest: Hash }),
    )
    .min(1)
    .max(2),
});
export const NativeCompensationNetworkEvidenceSchema =
  NativeRecoveryNetworkEvidenceSchema.extend({
    schemaVersion: z.literal(2),
    lifecycleKind: z.literal("publication_compensation"),
    previousWorkflowClosed: ClosedCoordinatorObservationSchema.nullable(),
    plex: z.strictObject({
      canonicalPaths: z
        .array(
          z.strictObject({
            assetId: z.uuid(),
            mediaIds: z.array(z.uuid()).min(1).max(100),
            canonicalPath: z.string().min(1).max(4096),
            sectionId: z.string().min(1),
            items: z
              .array(
                z.strictObject({
                  ratingKey: z.string().min(1),
                  identityHash: Hash,
                }),
              )
              .max(100),
          }),
        )
        .max(25),
      retainedAbsence:
        NativeArchiveNetworkEvidenceSchema.shape.plex.shape.archiveAbsence,
      inventory: NativeArchiveNetworkEvidenceSchema.shape.plex.shape.inventory,
      playback: NativeArchiveNetworkEvidenceSchema.shape.plex.shape.playback,
    }),
  });
export const NativeCompensationExecutionNetworkEvidenceSchema =
  NativeCompensationNetworkEvidenceSchema.extend({
    continuationId: z.uuid(),
    operationId: z.uuid(),
    descriptorHash: Hash,
  });
export const FinishedNativeCompensationSchema = z.strictObject({
  schemaVersion: z.literal(2),
  lifecycleKind: z.literal("publication_compensation"),
  scopeHash: Hash,
  network: z.strictObject({ identityHash: Hash }),
  files: NativeCompensationFileEvidenceSchema.omit({
    capturedAt: true,
    workerPodUid: true,
  }),
});
export const NativeCompensationDescriptorSchema = z.strictObject({
  schemaVersion: z.literal(1),
  allowedAction: z.literal("compensate"),
  scope: NativeCompensationScopeSchema,
  approvedFileEvidence: NativeCompensationFileEvidenceSchema,
  steps: z.array(NativeCompensationStepSchema),
});
export const NativeCompensationExecutionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  continuationId: z.uuid(),
  descriptorHash: Hash,
  recoveryEpoch: z.int().nonnegative(),
  transition: CompensationTransitionRefSchema,
  effectPrefixHash: Hash,
  participants: z.array(PublicationParticipantSchema).min(1),
});
export const NativeCompensationEffectRefsSchema = z.array(
  PublicationEffectRefSchema,
);
export type PrepareNativeCompensation = z.infer<
  typeof PrepareNativeCompensationSchema
>;
export type ApplyNativeCompensation = z.infer<
  typeof ApplyNativeCompensationSchema
>;
export type RevokedReservation = z.infer<typeof RevokedReservationSchema>;
export type InterruptedPublicationWork = z.infer<
  typeof InterruptedPublicationWorkSchema
>;
export type CompensationSettlement = z.infer<
  typeof CompensationSettlementSchema
>;
export type NativeCompensationScope = z.infer<
  typeof NativeCompensationScopeSchema
>;
export type NativeCompensationFileEvidence = z.infer<
  typeof NativeCompensationFileEvidenceSchema
>;
export type NativeCompensationNetworkEvidence = z.infer<
  typeof NativeCompensationNetworkEvidenceSchema
>;
export type NativeCompensationDescriptor = z.infer<
  typeof NativeCompensationDescriptorSchema
>;
export type NativeCompensationExecution = z.infer<
  typeof NativeCompensationExecutionSchema
>;
export type NativeCompensationStep = z.infer<
  typeof NativeCompensationStepSchema
>;
export type FinishedNativeCompensation = z.infer<
  typeof FinishedNativeCompensationSchema
>;
export type NativeCompensationExecutionNetworkEvidence = z.infer<
  typeof NativeCompensationExecutionNetworkEvidenceSchema
>;
