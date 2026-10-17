import { z } from "zod";
import { PublicationHashSchema as Hash } from "./effects.ts";
import { PublicationSubtitleLineageSchema } from "./subtitle-lineage.ts";

export const NativePhysicalGrantReferenceSchema = z.strictObject({
  kind: z.literal("prior_native_binding"),
  receiptLifecycle: z.enum(["published", "superseded_archive"]),
  receiptId: z.uuid(),
  planHash: Hash,
  assetId: z.uuid(),
  bindingHash: Hash,
  physicalEvidenceHash: Hash,
  subtitleLineage: PublicationSubtitleLineageSchema.optional(),
});
export const CompensationPhysicalReferenceSchema = z.strictObject({
  kind: z.literal("compensation_completion"),
  continuationId: z.uuid(),
  receiptId: z.uuid(),
  planHash: Hash,
  descriptorHash: Hash,
  completionHash: Hash,
  assetId: z.uuid(),
  bindingHash: Hash,
  physicalEvidenceHash: Hash,
  subtitleLineage: PublicationSubtitleLineageSchema.optional(),
});
export const PublicationTransitionReferenceSchema = z.strictObject({
  kind: z.literal("publication_transition_binding"),
  transitionId: z.uuid(),
  intentHash: Hash,
  outcomeHash: Hash,
  assetId: z.uuid(),
  bindingHash: Hash,
  physicalEvidenceHash: Hash,
  subtitleLineage: PublicationSubtitleLineageSchema.optional(),
});
export const PublicationAuthorityReferenceSchema = z.discriminatedUnion(
  "kind",
  [
    NativePhysicalGrantReferenceSchema,
    CompensationPhysicalReferenceSchema,
    PublicationTransitionReferenceSchema,
  ],
);
export const ClosedCoordinatorObservationSchema = z
  .strictObject({
    operationId: z.uuid(),
    workflowId: z.string().min(1),
    runId: z.string().min(1),
    status: z.enum([
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "TERMINATED",
      "TIMED_OUT",
    ]),
    observedAt: z.iso.datetime(),
  })
  .refine(
    (proof) => proof.workflowId === `media-operation-${proof.operationId}`,
    "Coordinator workflow identity changed",
  );
export type PublicationAuthorityReference = z.infer<
  typeof PublicationAuthorityReferenceSchema
>;
export type CompensationPhysicalReference = z.infer<
  typeof CompensationPhysicalReferenceSchema
>;
export type ClosedCoordinatorObservation = z.infer<
  typeof ClosedCoordinatorObservationSchema
>;
