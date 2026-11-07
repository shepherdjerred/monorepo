import { z } from "zod";
import type { NativeCompensationActivityInputSchema } from "#shared/native-recovery/compensation-runtime.ts";
import {
  NativeCompensationCompletionSchema,
  NativeCompensationPublicationCommandSchema,
  NativeCompensationVerifiedPublicationSchema,
  NativeCompensationFenceReleaseSchema,
} from "#shared/native-recovery/compensation-runtime.ts";
import { NativeCompensationExecutionSchema } from "#shared/native-recovery/compensation.ts";
import { SeriesPackNativeCompensationScopeV3Schema } from "./scope.ts";
import {
  SeriesPackNativeFileEvidenceV3Schema,
  SeriesPackNativeNetworkEvidenceV3Schema,
  SeriesPackNativePlexRefV2Schema,
} from "./evidence.ts";
import { PublicationHashSchema as Hash } from "#shared/publication-proof/effects.ts";

export const SeriesPackNativeReviewV1Schema = z.strictObject({
  planId: z.uuid(),
  operationId: z.uuid(),
});
export const SeriesPackNativeApplyV1Schema =
  SeriesPackNativeReviewV1Schema.extend({ planHash: Hash });
export const SeriesPackNativeSelectionV4Schema = z.strictObject({
  schemaVersion: z.literal(4),
  lifecycleKind: z.literal("publication_compensation"),
  protocol: z.literal("series_pack_publication_v3"),
  finishedRaw: z.string().min(1).max(4_194_304),
  scope: SeriesPackNativeCompensationScopeV3Schema,
  fileEvidence: SeriesPackNativeFileEvidenceV3Schema,
  networkEvidence: SeriesPackNativeNetworkEvidenceV3Schema,
  plex: z.strictObject({
    approved: SeriesPackNativePlexRefV2Schema,
    applied: SeriesPackNativePlexRefV2Schema,
  }),
  compensationAuthorization: z.strictObject({
    continuationId: z.uuid(),
    descriptorHash: Hash,
    descriptorRaw: z.string().min(1).max(4_194_304),
    mediaIds: z.array(z.uuid()).min(1).max(100),
    predecessorAssetIds: z.array(z.uuid()).min(1).max(25),
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
export const SeriesPackNativeExecutionV2Schema = z.strictObject({
  ...NativeCompensationExecutionSchema.omit({ schemaVersion: true }).shape,
  schemaVersion: z.literal(2),
  protocol: z.literal("series_pack_publication_v3"),
  admittedByOperationId: z.uuid(),
  admittedAt: z.iso.datetime(),
  inverseNamespace: SeriesPackNativeFileEvidenceV3Schema.shape.inverseNamespace,
});
export const SeriesPackNativeCompletionV2Schema = z.strictObject({
  ...NativeCompensationCompletionSchema.omit({ schemaVersion: true }).shape,
  schemaVersion: z.literal(2),
  protocol: z.literal("series_pack_publication_v3"),
  executionPlex: SeriesPackNativePlexRefV2Schema,
});
export const SeriesPackNativePublicationCommandV2Schema = z.strictObject({
  ...NativeCompensationPublicationCommandSchema.omit({ schemaVersion: true })
    .shape,
  schemaVersion: z.literal(2),
  protocol: z.literal("series_pack_publication_v3"),
  completionRaw: z.string().min(1).max(4_194_304),
  bindingsRaw: z.string().min(1).max(4_194_304),
});
export const SeriesPackNativeVerifiedPublicationV2Schema = z.strictObject({
  ...NativeCompensationVerifiedPublicationSchema.omit({ schemaVersion: true })
    .shape,
  schemaVersion: z.literal(2),
  protocol: z.literal("series_pack_publication_v3"),
  commandRaw: z.string().min(1).max(4_194_304),
});
export const SeriesPackNativeFenceReleaseV2Schema = z.strictObject({
  ...NativeCompensationFenceReleaseSchema.omit({ schemaVersion: true }).shape,
  schemaVersion: z.literal(2),
  protocol: z.literal("series_pack_publication_v3"),
  publicationRaw: z.string().min(1).max(4_194_304),
});
export type SeriesPackNativeActivityV1 = z.infer<
  typeof NativeCompensationActivityInputSchema
>;
export type SeriesPackNativeReviewV1 = z.infer<
  typeof SeriesPackNativeReviewV1Schema
>;
export type SeriesPackNativeApplyV1 = z.infer<
  typeof SeriesPackNativeApplyV1Schema
>;
export type SeriesPackNativeCompletionV2 = z.infer<
  typeof SeriesPackNativeCompletionV2Schema
>;
