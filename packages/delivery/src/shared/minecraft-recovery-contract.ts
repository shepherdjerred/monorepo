import { RecoveryIntentSchema } from "./recovery-intent.ts";
import { z } from "zod";
import { IdentifierSchema } from "./artifact-contract.ts";

export const MinecraftControllerReceiptSchema = z
  .object({
    namespace: z.literal("delivery-tsmc-controller"),
    name: z.literal("delivery-tsmc-controller-0"),
    uid: z.string().min(1),
    specFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.uuid(),
  })
  .strict();
export type MinecraftControllerReceipt = z.infer<
  typeof MinecraftControllerReceiptSchema
>;

export const RequestMinecraftRecoverySchema = z
  .object({
    requestId: IdentifierSchema,
    expectedEnvironmentGeneration: z.number().int().nonnegative(),
    reason: z.string().min(20).max(4000),
  })
  .strict();
export type RequestMinecraftRecovery = z.infer<
  typeof RequestMinecraftRecoverySchema
>;
export const MinecraftRecoveryIntentSchema = RecoveryIntentSchema.extend({
  controllerReceipt: MinecraftControllerReceiptSchema.nullable(),
});
export type MinecraftRecoveryIntent = z.infer<
  typeof MinecraftRecoveryIntentSchema
>;
// Completion is a request for an independent live inspection, never caller evidence.
export const CompleteMinecraftRecoverySchema = z
  .object({
    expectedEnvironmentGeneration: z.number().int().nonnegative(),
    snapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type CompleteMinecraftRecovery = z.infer<
  typeof CompleteMinecraftRecoverySchema
>;
export const FailMinecraftRecoverySchema = z
  .object({ message: z.string().min(1).max(4000) })
  .strict();
