import { z } from "zod";
import {
  EvidenceHashSchema,
  SourceKindSchema,
  MigrationReportEntrySchema,
} from "./migration.ts";

export const CaptureBindingSchema = z.strictObject({
  captureId: z.uuid(),
  captureHash: EvidenceHashSchema,
  sourceKind: SourceKindSchema,
  sourceInstanceId: EvidenceHashSchema,
});
export const CrossSourceAssociationSchema = z.strictObject({
  managerCaptureHash: EvidenceHashSchema,
  sourceMediaId: z.string().regex(/^[\w:.-]{1,200}$/u),
  torrentCaptureHash: EvidenceHashSchema,
  canonicalHash: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
  wireId: z.string().regex(/^[a-f0-9]{40}$/u),
  evidenceHash: EvidenceHashSchema,
  confidence: z.enum(["exact", "ambiguous", "unknown"]),
});
const RootPath = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^\/(?!.*(?:\.\.|[?#\r\n\0])).*$/u);
export const MigrationRootMappingSchema = z.strictObject({
  captureId: z.uuid(),
  sourceMountIdentity: EvidenceHashSchema,
  sourceRoot: RootPath,
  canonicalRoot: RootPath,
  verified: z.literal(false),
});
/** A complete source bundle can contain protected records; only separately proved selections may be adopted. */
export const MigrationBundleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  bundleHash: EvidenceHashSchema,
  captures: z.array(CaptureBindingSchema).min(1).max(20),
  associations: z.array(CrossSourceAssociationSchema).max(50_000),
  requiredSources: z.array(SourceKindSchema).min(1).max(6),
  complete: z.boolean(),
  stable: z.boolean(),
  rootMappings: z.array(MigrationRootMappingSchema).max(100),
});
export const BundleReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  bundleHash: EvidenceHashSchema,
  reportHash: EvidenceHashSchema,
  complete: z.boolean(),
  stable: z.boolean(),
  entries: z
    .array(
      MigrationReportEntrySchema.extend({ captureHash: EvidenceHashSchema }),
    )
    .max(50_000),
  mayTransferOwnership: z.literal(false),
});
export const MigrationSelectionSchema = z
  .array(
    z.strictObject({
      provenanceKey: EvidenceHashSchema,
      evidenceHash: EvidenceHashSchema,
    }),
  )
  .max(1000);
export const CreateBundleSchema = z.strictObject({
  captureIds: z.array(z.uuid()).min(1).max(20),
  rootMappings: z.array(MigrationRootMappingSchema).max(100).default([]),
});
export const ReviewBundleSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  reportHash: EvidenceHashSchema,
  bundleHash: EvidenceHashSchema,
  recoveryEpoch: z.number().int().nonnegative(),
  runtimeVersion: z.number().int().nonnegative(),
  action: z.enum(["approve", "revoke"]),
  selected: MigrationSelectionSchema,
  acknowledgeNoOwnershipTransfer: z.literal(true),
});
export const BundleReviewSchema = z.strictObject({
  id: z.uuid(),
  bundleId: z.uuid(),
  manifest: MigrationBundleSchema,
  report: BundleReportSchema,
  selection: MigrationSelectionSchema,
  recoveryEpoch: z.number().int().nonnegative(),
  runtimeVersion: z.number().int().nonnegative(),
  status: z.enum(["protected", "awaiting_review", "approved", "revoked"]),
  version: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export const BundleReviewListSchema = z
  .array(
    z.strictObject({
      id: z.uuid(),
      reportHash: EvidenceHashSchema,
      status: z.enum(["protected", "awaiting_review", "approved", "revoked"]),
      version: z.number().int().nonnegative(),
      createdAt: z.iso.datetime(),
    }),
  )
  .max(100);
/** Request references trusted stored live proof; callers cannot submit 'quiescent' or 'owned' booleans. */
export const ApplyMigrationSelectionSchema = z.strictObject({
  proposalId: z.uuid(),
  reportHash: EvidenceHashSchema,
  bundleHash: EvidenceHashSchema,
  expectedRecoveryEpoch: z.number().int().nonnegative(),
  expectedRuntimeVersion: z.number().int().nonnegative(),
  liveProofId: z.uuid(),
  selected: z
    .array(
      z.strictObject({
        provenanceKey: EvidenceHashSchema,
        evidenceHash: EvidenceHashSchema,
      }),
    )
    .min(1)
    .max(1000),
});
