import { z } from "zod";
import {
  PublicationSubtitleLineageSchema,
  PublicationSubtitleEvidenceSchema,
} from "#shared/publication-proof/subtitle-lineage.ts";
import {
  PublicationHashSchema as Hash,
  PublicationJournalSchema,
} from "#shared/publication-proof/effects.ts";
import {
  PublicationAssetSnapshotSchema,
  PublicationParticipantSchema,
} from "#shared/publication-proof/intent.ts";
import {
  NativeCompensationScopeSchema,
  NativeCompensationFileEvidenceSchema,
  NativeCompensationNetworkEvidenceSchema,
  CompensationTransitionRefSchema,
  CompensationSettlementSchema,
  NativeCompensationEffectRefsSchema,
} from "./compensation.ts";

export const NativeCompensationCompletionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  continuationId: z.uuid(),
  receiptId: z.uuid(),
  descriptorHash: Hash,
  recoveryEpoch: z.int().nonnegative(),
  transition: CompensationTransitionRefSchema,
  compensationEffects: NativeCompensationEffectRefsSchema,
  predecessorBindings: z
    .array(
      z.strictObject({
        before: PublicationAssetSnapshotSchema,
        after: PublicationAssetSnapshotSchema,
        participants: z.array(PublicationParticipantSchema).min(1),
      }),
    )
    .min(1)
    .max(25),
  retainedArtifacts: z.array(PublicationParticipantSchema),
  journals: z.array(PublicationJournalSchema),
  settlement: CompensationSettlementSchema,
  completedAt: z.iso.datetime(),
});
export const SettledNativeCompensationSchema = z.strictObject({
  continuationId: z.uuid(),
  descriptorHash: Hash,
  completionHash: Hash,
  settlement: CompensationSettlementSchema,
  retainedArtifacts: z.array(PublicationParticipantSchema),
  journals: z.array(PublicationJournalSchema),
  bindingHistoryHash: Hash,
  subtitleLineages: z
    .array(
      z.strictObject({
        assetId: z.uuid(),
        lineage: PublicationSubtitleLineageSchema,
      }),
    )
    .min(1)
    .max(25)
    .optional(),
});
export const SettledNativeCompensationEvidenceSchema = z.strictObject({
  continuationId: z.uuid(),
  descriptorHash: Hash,
  completionHash: Hash,
  physicalEvidenceHash: Hash,
  journalEvidenceHash: Hash,
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
export const NativeCompensationSelectionSchema = z.strictObject({
  scope: NativeCompensationScopeSchema,
  fileEvidence: NativeCompensationFileEvidenceSchema,
  networkEvidence: NativeCompensationNetworkEvidenceSchema,
  bindings: z.tuple([]),
  compensationAuthorization: z.strictObject({
    continuationId: z.uuid(),
    transition: CompensationTransitionRefSchema,
    allowedAction: z.literal("compensate"),
    mediaIds: z.array(z.uuid()).min(1).max(100),
    predecessorAssetIds: z.array(z.uuid()).min(1).max(25),
    descriptorHash: Hash,
    recoveryHoldBindings: z
      .array(
        z.strictObject({
          mediaId: z.uuid(),
          version: z.int().nonnegative(),
          recoveryEpoch: z.int().nonnegative(),
        }),
      )
      .min(1)
      .max(100),
  }),
});
export const NativeCompensationActivityInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  continuationId: z.uuid(),
  operationId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
});
export const NativeCompensationPublicationCommandSchema = z.strictObject({
  schemaVersion: z.literal(1),
  continuationId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  completionHash: Hash,
  bindingsHash: Hash,
  generations: z.record(z.uuid(), z.int().nonnegative()),
});
export const NativeCompensationVerifiedPublicationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  continuationId: z.uuid(),
  operationId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  completionHash: Hash,
  commandHash: Hash,
  bindingsHash: Hash,
  generations: z.record(z.uuid(), z.int().nonnegative()),
  serverMachineId: z.string().min(1),
  items: z
    .array(
      z.strictObject({
        mediaId: z.uuid(),
        assetId: z.uuid(),
        assetVersion: z.int().nonnegative(),
        checksum: Hash,
        canonicalPath: z.string().min(1).max(4096),
        sectionId: z.string().min(1),
        ratingKey: z.string().min(1),
        identityHash: Hash,
      }),
    )
    .min(1)
    .max(100),
  verifiedAt: z.iso.datetime(),
});
export const NativeCompensationFenceReleaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  continuationId: z.uuid(),
  transitionId: z.uuid(),
  settlingContinuationId: z.uuid(),
  settlingCompletionHash: Hash,
  publicationHash: Hash,
  releasedAt: z.iso.datetime(),
});
export const NativeCompensationContinuationViewSchema = z.strictObject({
  id: z.uuid(),
  transitionId: z.uuid(),
  version: z.int().nonnegative(),
  state: z.enum(["pending", "compensating", "protected", "compensated"]),
  publicationState: z.enum([
    "held",
    "ready",
    "publishing",
    "protected",
    "available",
  ]),
  fenceActive: z.boolean(),
  protectedReason: z.string().nullable(),
  currentPositiveMediaIds: z.array(z.uuid()).max(100),
  media: z
    .array(
      z.strictObject({
        id: z.uuid(),
        title: z.string(),
        availability: z.string(),
      }),
    )
    .min(1)
    .max(100),
});
export const NativeCompensationInventorySchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        transitionId: z.uuid(),
        attemptId: z.uuid(),
        birthEpoch: z.int().nonnegative(),
        media: z
          .array(z.strictObject({ id: z.uuid(), title: z.string() }))
          .min(1)
          .max(100),
        predecessors: z
          .array(z.strictObject({ assetId: z.uuid(), path: z.string() }))
          .max(100),
        successorAssetIds: z.array(z.uuid()).max(100),
        selectable: z.boolean(),
        protection: z.string().nullable(),
      }),
    )
    .max(25),
  nextCursor: z.uuid().nullable(),
});
export type NativeCompensationActivityInput = z.infer<
  typeof NativeCompensationActivityInputSchema
>;
export type NativeCompensationCompletion = z.infer<
  typeof NativeCompensationCompletionSchema
>;
export type NativeCompensationSelection = z.infer<
  typeof NativeCompensationSelectionSchema
>;
export type NativeCompensationPublicationCommand = z.infer<
  typeof NativeCompensationPublicationCommandSchema
>;
export type NativeCompensationVerifiedPublication = z.infer<
  typeof NativeCompensationVerifiedPublicationSchema
>;
export type NativeCompensationFenceRelease = z.infer<
  typeof NativeCompensationFenceReleaseSchema
>;
export type NativeCompensationInventory = z.infer<
  typeof NativeCompensationInventorySchema
>;
export type NativeCompensationPrepareInput = {
  planId: string;
  operationId: string;
};
export type NativeCompensationApplyInput = NativeCompensationPrepareInput & {
  planHash: string;
};
export type NativeCompensationExecutionContext = {
  signal: AbortSignal;
  assertActive: () => void;
  checkpoint: (name: string) => Promise<void>;
};
export type NativeCompensationFileActivities = {
  prepareNativeCompensationFiles: (
    input: NativeCompensationPrepareInput,
  ) => Promise<void>;
  applyNativeCompensationFiles: (
    input: NativeCompensationApplyInput,
  ) => Promise<void>;
  compensateNativePublicationFiles: (
    input: NativeCompensationActivityInput,
  ) => Promise<{ status: "compensated" | "protected"; reason: string | null }>;
};
export type NativeCompensationNetworkActivities = {
  observeNativeCompensation: (
    input: NativeCompensationPrepareInput,
  ) => Promise<void>;
  observeNativeCompensationExecution: (
    input: NativeCompensationActivityInput,
  ) => Promise<{
    status: "ready" | "compensated" | "protected";
    reason: string | null;
  }>;
  publishCompensatedMedia: (input: NativeCompensationActivityInput) => Promise<{
    status: "available" | "waiting" | "blocked";
    reason: string | null;
  }>;
  nativeCompensationState: (input: NativeCompensationActivityInput) => Promise<{
    state: "pending" | "compensating" | "protected" | "compensated";
    publicationVerified: boolean;
  }>;
};
