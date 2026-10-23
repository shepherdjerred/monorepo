import { RecoveryIntentSchema } from "./recovery-intent.ts";
import { z } from "zod";
import { IdentifierSchema } from "./artifact-contract.ts";
import {
  TofuPlanReceiptSchema,
  SavedPlanFieldsSchema,
  EncryptedTofuPlanSchema,
  validSavedPlanWindow,
} from "./platform-contract.ts";
const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Generation = z.number().int().nonnegative();
export const PlatformRecoveryPlanReceiptSchema = SavedPlanFieldsSchema.extend({
  schema: z.literal("delivery-tofu-recovery-plan/v1"),
  recoveryIntentId: IdentifierSchema,
}).refine(
  validSavedPlanWindow,
  "A saved recovery plan expires within 24 hours of creation",
);
export type PlatformRecoveryPlanReceipt = z.infer<
  typeof PlatformRecoveryPlanReceiptSchema
>;
export const RecordPlatformRecoveryPlanSchema = z
  .object({
    receipt: PlatformRecoveryPlanReceiptSchema,
    encryptedPlan: EncryptedTofuPlanSchema,
  })
  .strict();
export type RecordPlatformRecoveryPlan = z.infer<
  typeof RecordPlatformRecoveryPlanSchema
>;
export const PlatformRecoveryNativeReceiptSchema = z
  .object({
    action: z.enum(["inspect", "plan", "apply"]),
    receipt: TofuPlanReceiptSchema.shape.nativeJob,
  })
  .strict();
export type PlatformRecoveryNativeReceipt = z.infer<
  typeof PlatformRecoveryNativeReceiptSchema
>;
export const ApprovePlatformRecoveryPlanSchema = z
  .object({
    planFingerprint: Hash,
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().min(1).max(4000),
  })
  .strict();
export type ApprovePlatformRecoveryPlan = z.infer<
  typeof ApprovePlatformRecoveryPlanSchema
>;
export const PlatformRecoveryPlanApprovalSchema =
  ApprovePlatformRecoveryPlanSchema.extend({
    actorId: z.string().min(1),
    createdAt: z.iso.datetime(),
  });
export const RequestPlatformRecoverySchema = z
  .object({
    requestId: IdentifierSchema,
    expectedEnvironmentGeneration: Generation,
    reason: z.string().trim().min(20).max(4000),
  })
  .strict();
export type RequestPlatformRecovery = z.infer<
  typeof RequestPlatformRecoverySchema
>;
export const PlatformRecoveryIntentSchema = RecoveryIntentSchema.extend({
  nativeReceipts: z
    .array(PlatformRecoveryNativeReceiptSchema)
    .max(20)
    .default([]),
  planReceipt: PlatformRecoveryPlanReceiptSchema.nullable().default(null),
  planFingerprint: Hash.nullable().default(null),
  planApproval: PlatformRecoveryPlanApprovalSchema.nullable().default(null),
});
export type PlatformRecoveryIntent = z.infer<
  typeof PlatformRecoveryIntentSchema
>;
export const PlatformSettlementFingerprintsSchema = z
  .object({
    desired: Hash.optional(),
    prior: Hash.optional(),
    readonly: Hash.optional(),
    original: Hash.optional(),
  })
  .strict();
export const CompletePlatformRecoverySchema = z
  .object({
    expectedEnvironmentGeneration: Generation,
    snapshotFingerprint: Hash,
    observedAt: z.iso.datetime(),
    sourceWorkflow: z
      .object({
        workflowId: z.string().min(1),
        status: z.enum([
          "COMPLETED",
          "FAILED",
          "CANCELED",
          "TERMINATED",
          "TIMED_OUT",
        ]),
      })
      .strict(),
    nativeJobs: z
      .array(
        TofuPlanReceiptSchema.shape.nativeJob.extend({
          status: z.enum(["Complete", "Failed", "Deleted"]),
          podsAbsent: z.boolean(),
        }),
      )
      .max(20),
    settlement: z
      .object({
        state: z.enum(["desired", "prior", "readonly", "original"]),
        fingerprint: Hash,
      })
      .strict(),
    proofSummary: z.string().trim().min(20).max(4000),
  })
  .strict();
export type CompletePlatformRecovery = z.infer<
  typeof CompletePlatformRecoverySchema
>;
export const AdmitPlatformRecoveryApplySchema =
  CompletePlatformRecoverySchema.omit({
    settlement: true,
    proofSummary: true,
  }).extend({ planFingerprint: Hash.optional() });
export type AdmitPlatformRecoveryApply = z.infer<
  typeof AdmitPlatformRecoveryApplySchema
>;
export const FailPlatformRecoverySchema = z
  .object({ message: z.string().min(1).max(4000) })
  .strict();
