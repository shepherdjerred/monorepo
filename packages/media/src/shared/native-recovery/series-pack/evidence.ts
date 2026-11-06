import { z } from "zod";
import {
  NativeCompensationFileEvidenceSchema,
  NativeCompensationNetworkEvidenceSchema,
  NativeCompensationStepSchema,
} from "#shared/native-recovery/compensation.ts";
import {
  PhysicalPathStateSchema,
  PublicationHashSchema as Hash,
} from "#shared/publication-proof/effects.ts";
import { ClosedCoordinatorObservationSchema } from "#shared/publication-proof/references.ts";
import { PlexAccessSchema } from "#shared/plex-binding/contract.ts";
import { SeriesPackNativeCompensationScopeV3Schema } from "./scope.ts";

export const SeriesPackNativeFileEvidenceV3Schema = z.strictObject({
  ...NativeCompensationFileEvidenceSchema.omit({ schemaVersion: true }).shape,
  schemaVersion: z.literal(3),
  protocol: z.literal("series_pack_publication_v3"),
  inverseNamespace: PhysicalPathStateSchema.refine(
    (row) => row.root === "control" && row.state === "absent",
    "Owner review must prove the future inverse namespace absent",
  ),
  acknowledgedRaw: z.array(z.string().min(1).max(262_144)).max(10_000),
  effectPrefixRaw: z.string().min(1).max(4_194_304),
});

/** The original acquisition coordinator must really be closed even on first recovery. */
export const SeriesPackNativeAcquisitionClosedV1Schema = z
  .strictObject({
    operationId: z.uuid(),
    attemptId: z.uuid(),
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
    (proof) => proof.workflowId === `media-acquire-${proof.attemptId}`,
    "Acquisition Workflow identity changed",
  );

export const SeriesPackNativeNetworkEvidenceV3Schema = z.strictObject({
  ...NativeCompensationNetworkEvidenceSchema.omit({
    schemaVersion: true,
    previousWorkflowClosed: true,
  }).shape,
  schemaVersion: z.literal(3),
  protocol: z.literal("series_pack_publication_v3"),
  access: PlexAccessSchema,
  originalWorkflowClosed: ClosedCoordinatorObservationSchema,
  originalAcquisitionClosed: SeriesPackNativeAcquisitionClosedV1Schema,
  previousWorkflowClosed: ClosedCoordinatorObservationSchema.nullable(),
});

export const SeriesPackNativeDescriptorV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  protocol: z.literal("series_pack_publication_v3"),
  allowedAction: z.literal("compensate"),
  scope: SeriesPackNativeCompensationScopeV3Schema,
  approvedFileEvidence: SeriesPackNativeFileEvidenceV3Schema,
  steps: z.array(NativeCompensationStepSchema),
});

/** A distinct strict parent; literal native-Plex v1 objects are not extended. */
export const SeriesPackNativePlexParentV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  protocol: z.literal("series_pack_publication_v3"),
  lifecycleKind: z.literal("publication_compensation"),
  purpose: z.enum(["native_review", "native_execution"]),
  networkKind: z.enum(["network", "compensation_network"]),
  planId: z.uuid(),
  scopeHash: Hash,
  recoveryEpoch: z.int().nonnegative(),
  operationId: z.uuid(),
  continuationId: z.uuid().nullable(),
  descriptorHash: Hash.nullable(),
});
const ObservationRef = z.strictObject({
  observationId: z.uuid(),
  evidenceHash: Hash,
});
export const SeriesPackNativePlexBatchV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    protocol: z.literal("series_pack_publication_v3"),
    batchId: z.uuid(),
    parent: SeriesPackNativePlexParentV2Schema,
    network: ObservationRef,
    plex: ObservationRef,
    identityHash: Hash,
    identityRaw: z.string().min(1).max(4_194_304),
    scopeRaw: z.string().min(1).max(4_194_304),
    networkRaw: z.string().min(1).max(4_194_304),
    plexRaw: z.string().min(1).max(4_194_304),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    sessionsCheckedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .refine((row) => {
    const start = Date.parse(row.startedAt);
    const complete = Date.parse(row.completedAt);
    const sessions = Date.parse(row.sessionsCheckedAt);
    const expires = Date.parse(row.expiresAt);
    return (
      start <= sessions &&
      sessions <= complete &&
      complete < expires &&
      expires - start <= 60_000 &&
      (row.parent.purpose === "native_execution"
        ? row.parent.continuationId !== null &&
          row.parent.descriptorHash !== null &&
          row.parent.networkKind === "compensation_network"
        : row.parent.continuationId === null &&
          row.parent.descriptorHash === null &&
          row.parent.networkKind === "network")
    );
  }, "Native pack paired proof must retain its real original timing and parent");
export const SeriesPackNativePlexRefV2Schema = z.strictObject({
  batchId: z.uuid(),
  batchHash: Hash,
  parent: SeriesPackNativePlexParentV2Schema,
  network: ObservationRef,
  plex: ObservationRef,
  identityHash: Hash,
});
export const SeriesPackNativePlexEnvelopeV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  protocol: z.literal("series_pack_publication_v3"),
  parent: SeriesPackNativePlexParentV2Schema,
  batchId: z.uuid(),
  network: ObservationRef,
  observation: SeriesPackNativeNetworkEvidenceV3Schema.shape.plex,
});
export const SeriesPackNativeFinishedV4Schema = z.strictObject({
  schemaVersion: z.literal(4),
  lifecycleKind: z.literal("publication_compensation"),
  protocol: z.literal("series_pack_publication_v3"),
  scopeHash: Hash,
  plex: SeriesPackNativePlexRefV2Schema,
  networkIdentityHash: Hash,
  files: SeriesPackNativeFileEvidenceV3Schema.omit({
    capturedAt: true,
    workerPodUid: true,
  }),
});

export type SeriesPackNativeFileEvidenceV3 = z.infer<
  typeof SeriesPackNativeFileEvidenceV3Schema
>;
export type SeriesPackNativeNetworkEvidenceV3 = z.infer<
  typeof SeriesPackNativeNetworkEvidenceV3Schema
>;
export type SeriesPackNativeDescriptorV2 = z.infer<
  typeof SeriesPackNativeDescriptorV2Schema
>;
export type SeriesPackNativePlexRefV2 = z.infer<
  typeof SeriesPackNativePlexRefV2Schema
>;
