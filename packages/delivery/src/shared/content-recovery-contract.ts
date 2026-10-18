import { z } from "zod";
import { IdentifierSchema } from "./artifact-contract.ts";
import { RecoveryIntentSchema } from "./recovery-intent.ts";
import { DispatchBarrierSchema as NativeDispatchBarrierSchema } from "./dispatch-barrier.ts";
export const DispatchBarrierSchema = NativeDispatchBarrierSchema.clone();
export type DispatchBarrier = z.infer<typeof DispatchBarrierSchema>;

const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
export const RequestContentRecoverySchema = z
  .object({
    requestId: IdentifierSchema,
    expectedEnvironmentGeneration: z.number().int().nonnegative(),
    reason: z.string().trim().min(20).max(4000),
  })
  .strict();
export type RequestContentRecovery = z.infer<
  typeof RequestContentRecoverySchema
>;

export const ContentRecoveryNativeReceiptSchema = z
  .object({
    action: z.enum(["original", "inspect", "repair"]),
    receipt: z
      .object({
        namespace: z.enum([
          "delivery-worker-jobs",
          "storm-forum",
          "storm-forum-beta",
        ]),
        name: z.string().min(1),
        uid: z.uuid(),
        specFingerprint: Fingerprint,
        requestId: z.string().min(1),
      })
      .strict(),
  })
  .strict();
export type ContentRecoveryNativeReceipt = z.infer<
  typeof ContentRecoveryNativeReceiptSchema
>;
export const ContentRecoveryIntentSchema = RecoveryIntentSchema.omit({
  workflowId: true,
  submittedAt: true,
}).extend({
  targetKind: z.enum(["static-site", "forum"]),
  nativeReceipts: z.array(ContentRecoveryNativeReceiptSchema).default([]),
  dispatchBarrier: DispatchBarrierSchema.nullable().default(null),
  barrierRestoredAt: z.iso.datetime().nullable().default(null),
});
export type ContentRecoveryIntent = z.infer<typeof ContentRecoveryIntentSchema>;

export const ContentRecoveryOwnershipSchema = z
  .object({
    expectedEnvironmentGeneration: z.number().int().nonnegative(),
    snapshotFingerprint: Fingerprint,
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
    quiescence: z.strictObject({
      deploymentUID: z.string().min(1),
      templateFingerprint: Fingerprint,
      replicas: z.literal(0),
      remainingPodUIDs: z.array(z.string()).max(0),
      journalFingerprint: Fingerprint,
    }),
    nativeJobs: z.array(
      ContentRecoveryNativeReceiptSchema.shape.receipt.extend({
        namespace: z.enum([
          "delivery-worker-jobs",
          "storm-forum",
          "storm-forum-beta",
        ]),
        status: z.enum(["Complete", "Failed", "Deleted"]),
        podsAbsent: z.boolean(),
        podsTerminal: z.literal(true),
      }),
    ),
  })
  .strict();
export type ContentRecoveryOwnership = z.infer<
  typeof ContentRecoveryOwnershipSchema
>;
export const AdmitContentRecoveryRepairSchema =
  ContentRecoveryOwnershipSchema.extend({
    activeRepairJobUIDs: z.array(z.uuid()).max(1).default([]),
  });
export type AdmitContentRecoveryRepair = z.infer<
  typeof AdmitContentRecoveryRepairSchema
>;
export const CompleteContentRecoverySchema =
  ContentRecoveryOwnershipSchema.extend({
    settlement: z
      .object({
        state: z.enum(["desired", "prior"]),
        fingerprint: Fingerprint,
      })
      .strict(),
    proofSummary: z.string().trim().min(20).max(2000),
  });
export type CompleteContentRecovery = z.infer<
  typeof CompleteContentRecoverySchema
>;
export const ContentSettlementFingerprintsSchema = z
  .object({ desired: Fingerprint, prior: Fingerprint.optional() })
  .strict();
export const ContentBarrierRestorationSchema =
  ContentRecoveryOwnershipSchema.pick({
    expectedEnvironmentGeneration: true,
    snapshotFingerprint: true,
    observedAt: true,
  }).extend({
    journalFingerprint: Fingerprint,
    deploymentUID: z.string().min(1),
    templateFingerprint: Fingerprint,
    replicas: z.literal(1),
    readyPodUIDs: z.array(z.string().min(1)).min(1),
  });
export type ContentBarrierRestoration = z.infer<
  typeof ContentBarrierRestorationSchema
>;
