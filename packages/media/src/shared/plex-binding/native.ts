import { z } from "zod";
import { PublicationHashSchema as Hash } from "#shared/publication-proof/effects.ts";
import { PlexDecimalIdSchema } from "#shared/plex-events/contract.ts";
import { NativePublishedScopeSchema } from "#shared/native-recovery/lifecycle.ts";
import { NativeQuarantineScopeSchema } from "#shared/native-recovery/quarantine.ts";
import { NativeArchiveScopeSchema } from "#shared/native-recovery/archive.ts";
import { NativeCompensationScopeSchema } from "#shared/native-recovery/compensation.ts";
import { NativeRecoveryNetworkEvidenceSchema } from "#shared/native-recovery.ts";
import { NativeQuarantineNetworkEvidenceSchema } from "#shared/native-recovery/quarantine.ts";
import {
  NativeArchiveNetworkEvidenceSchema,
  NativeArchiveCleanupNetworkEvidenceSchema,
} from "#shared/native-recovery/archive.ts";
import {
  NativeCompensationNetworkEvidenceSchema,
  NativeCompensationExecutionNetworkEvidenceSchema,
} from "#shared/native-recovery/compensation.ts";
import {
  PlexAssociationV1Schema,
  type PlexBindingFreshness,
} from "./contract.ts";
import { PlexVerificationFactsSchema } from "./observations.ts";
import { NativeCompensationCatalogSchema } from "./native-catalog.ts";
import { PlexCanonicalTargetSchema } from "./canonical.ts";
import { plexScopeKey, plexSortedUnique } from "./contract.ts";

export const NativePlexLifecycleSchema = z.enum([
  "published",
  "committed_quarantine",
  "superseded_archive",
  "publication_compensation",
]);
export const NativePlexNetworkEvidenceSchema = z.union([
  NativeRecoveryNetworkEvidenceSchema,
  NativeQuarantineNetworkEvidenceSchema,
  NativeArchiveCleanupNetworkEvidenceSchema,
  NativeArchiveNetworkEvidenceSchema,
  NativeCompensationExecutionNetworkEvidenceSchema,
  NativeCompensationNetworkEvidenceSchema,
]);
const Parent = z.strictObject({
  planId: z.uuid(),
  scopeHash: Hash,
  recoveryEpoch: z.int().nonnegative(),
});
export const NativePlexParentSchema = z.discriminatedUnion("lifecycleKind", [
  Parent.extend({
    lifecycleKind: z.literal("published"),
    scope: NativePublishedScopeSchema,
  }),
  Parent.extend({
    lifecycleKind: z.literal("committed_quarantine"),
    scope: NativeQuarantineScopeSchema,
  }),
  Parent.extend({
    lifecycleKind: z.literal("superseded_archive"),
    scope: NativeArchiveScopeSchema,
  }),
  Parent.extend({
    lifecycleKind: z.literal("publication_compensation"),
    scope: NativeCompensationScopeSchema,
  }),
]);
const ReviewParent = Parent.extend({
  purpose: z.literal("native_review"),
  networkKind: z.literal("network"),
  lifecycleKind: NativePlexLifecycleSchema,
  operationId: z.uuid(),
});
const ExecutionParent = Parent.extend({
  purpose: z.literal("native_execution"),
  operationId: z.uuid(),
  continuationId: z.uuid(),
  descriptorHash: Hash,
  networkScopeHash: Hash,
  receipt: z.strictObject({
    receiptId: z.uuid(),
    planHash: Hash,
    selectionHash: Hash,
  }),
});
export const NativePlexProofParentSchema = z.union([
  ReviewParent,
  ExecutionParent.extend({
    networkKind: z.literal("archive_cleanup_network"),
    lifecycleKind: z.literal("superseded_archive"),
  }),
  ExecutionParent.extend({
    networkKind: z.literal("compensation_network"),
    lifecycleKind: z.literal("publication_compensation"),
  }),
]);
export const NativePlexObservationSchema = z
  .strictObject({
    purpose: z.enum(["native_review", "native_execution"]),
    parent: NativePlexProofParentSchema,
    present: z.array(PlexAssociationV1Schema).max(10_000),
    compensationCatalog: NativeCompensationCatalogSchema.optional(),
    canonicalTargets: z
      .array(PlexCanonicalTargetSchema)
      .min(1)
      .max(10_000)
      .refine((values) =>
        plexSortedUnique(values.map((value) => plexScopeKey(value.scope))),
      )
      .optional(),
    effectiveScope: z
      .union([NativeArchiveScopeSchema, NativeCompensationScopeSchema])
      .optional(),
    absent: z
      .array(
        z.strictObject({
          assetId: z.uuid(),
          sectionId: PlexDecimalIdSchema,
          canonicalPaths: z.array(z.string().min(1).max(4096)).min(1).max(2525),
          inventoryHash: Hash,
        }),
      )
      .max(2500),
    verification: PlexVerificationFactsSchema,
  })
  .refine(
    (value) => value.purpose === value.parent.purpose,
    "Native proof purpose changed",
  )
  .refine(
    (value) =>
      value.parent.lifecycleKind === "publication_compensation"
        ? value.present.length === 0 &&
          value.compensationCatalog !== undefined &&
          value.canonicalTargets === undefined
        : value.compensationCatalog === undefined &&
          value.canonicalTargets !== undefined,
    "Compensation requires catalog-only evidence; other lifecycles forbid it",
  )
  .refine(
    (value) =>
      value.parent.purpose === "native_execution"
        ? value.effectiveScope?.lifecycleKind === value.parent.lifecycleKind
        : value.effectiveScope === undefined,
    "Native execution requires its exact effective scope; reviews use the immutable plan scope",
  );
export const NativePlexObservationRefSchema = z.strictObject({
  observationId: z.uuid(),
  evidenceHash: Hash,
});
export const NativePlexNetworkEnvelopeSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    parent: NativePlexProofParentSchema,
    batchId: z.uuid(),
    network: NativePlexObservationRefSchema,
    observation: NativePlexObservationSchema,
  })
  .refine(
    (value) =>
      value.parent.planId === value.observation.parent.planId &&
      value.parent.scopeHash === value.observation.parent.scopeHash &&
      value.parent.recoveryEpoch === value.observation.parent.recoveryEpoch &&
      value.parent.lifecycleKind === value.observation.parent.lifecycleKind &&
      JSON.stringify(value.parent) === JSON.stringify(value.observation.parent),
    "Native Plex envelope parent changed",
  );
export const NativePlexProofRefSchema = z.strictObject({
  batchId: z.uuid(),
  batchHash: Hash,
  parent: NativePlexProofParentSchema,
  network: NativePlexObservationRefSchema,
  plex: NativePlexObservationRefSchema,
  identityHash: Hash,
});
export const NativePlexProofTimingSchema = z
  .strictObject({
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    sessionsCheckedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .refine((value) => {
    const start = Date.parse(value.startedAt);
    const end = Date.parse(value.completedAt);
    const session = Date.parse(value.sessionsCheckedAt);
    const expiry = Date.parse(value.expiresAt);
    return (
      start <= session &&
      session <= end &&
      end < expiry &&
      expiry - start <= 60_000
    );
  }, "Native paired proof exceeded its original deadline");
export const NativePlexProofBatchSchema =
  NativePlexProofTimingSchema.safeExtend({
    schemaVersion: z.literal(1),
    batchId: z.uuid(),
    parent: NativePlexProofParentSchema,
    network: NativePlexObservationRefSchema,
    plex: NativePlexObservationRefSchema,
    identityHash: Hash,
  });
export const NativePlexSelectionRefsSchema = z
  .strictObject({
    approved: NativePlexProofRefSchema,
    applied: NativePlexProofRefSchema,
  })
  .refine((value) => {
    const a = value.approved.parent,
      b = value.applied.parent;
    return (
      a.purpose === "native_review" &&
      b.purpose === "native_review" &&
      a.operationId !== b.operationId &&
      value.approved.batchId !== value.applied.batchId &&
      a.planId === b.planId &&
      a.scopeHash === b.scopeHash &&
      a.recoveryEpoch === b.recoveryEpoch &&
      a.lifecycleKind === b.lifecycleKind &&
      value.approved.identityHash === value.applied.identityHash
    );
  }, "Native applied proof changed the approved identity");
export type NativePlexParent = z.infer<typeof NativePlexParentSchema>;
export type NativePlexObservation = z.infer<typeof NativePlexObservationSchema>;
export type NativePlexProofParent = z.infer<typeof NativePlexProofParentSchema>;
export type NativePlexProofRef = z.infer<typeof NativePlexProofRefSchema>;
export type NativePlexProofBatch = z.infer<typeof NativePlexProofBatchSchema>;
export type NativePlexProofTiming = z.infer<typeof NativePlexProofTimingSchema>;
export type NativePlexSelectionRefs = z.infer<
  typeof NativePlexSelectionRefsSchema
>;
export type NativePlexNetworkEvidence = z.infer<
  typeof NativePlexNetworkEvidenceSchema
>;
export type VerifiedNativePlex = {
  observation: NativePlexObservation;
  freshness: PlexBindingFreshness;
};
