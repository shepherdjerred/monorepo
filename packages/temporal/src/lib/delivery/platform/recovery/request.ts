import { z } from "zod";
import type {
  PlatformRecoveryContext,
  PlatformRecoveryIntent,
} from "@shepherdjerred/delivery/contract";
import type { DeliveryJobRequest } from "#shared/delivery-job.ts";

export const RecoveryActionSchema = z.enum(["inspect", "plan", "apply"]);
export const RecoveryJobInputSchema = z.strictObject({
  intentId: z.string().min(1),
  action: RecoveryActionSchema,
  attempt: z.number().int().min(1).max(20),
  expectedEnvironmentGeneration: z.number().int().nonnegative(),
  snapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  target: z.enum(["control-plane", "tofu"]),
  stack: z.string().optional(),
});
export type RecoveryAction = z.infer<typeof RecoveryActionSchema>;

/** No provider values, encrypted plans, caller-selected commands or mutable context enter a Pod spec. */
export function recoveryExecutionJob(
  context: PlatformRecoveryContext,
  input: {
    intent: PlatformRecoveryIntent;
    action: RecoveryAction;
    attempt: number;
  },
): DeliveryJobRequest {
  const detail = context.deployment;
  const pipeline = detail.pipeline.definition;
  const snapshot =
    detail.deployment.platformSnapshot ??
    detail.deployment.controlPlaneSnapshot;
  if (
    snapshot === null ||
    (pipeline.kind !== "tofu" && pipeline.kind !== "control-plane") ||
    !("runnerImage" in pipeline)
  )
    throw new Error("Recovery lacks an immutable supported platform source");
  return {
    deploymentId: input.intent.id,
    stageKey: `platform-recovery-${input.action}-${String(input.attempt)}`,
    recipe: "platform-recovery",
    runnerImage: pipeline.runnerImage,
    sourceRevision: snapshot.source.sourceRevision,
    input: RecoveryJobInputSchema.parse({
      intentId: input.intent.id,
      action: input.action,
      attempt: input.attempt,
      expectedEnvironmentGeneration: input.intent.expectedEnvironmentGeneration,
      snapshotFingerprint: input.intent.snapshotFingerprint,
      target: pipeline.kind,
      ...(pipeline.kind === "tofu" ? { stack: pipeline.stack } : {}),
    }),
  };
}
