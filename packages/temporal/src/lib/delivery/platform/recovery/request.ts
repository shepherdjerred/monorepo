import { z } from "zod";
import type {
  PlatformRecoveryContext,
  PlatformRecoveryIntent,
} from "@shepherdjerred/delivery/contract";
import {
  DeliveryJobArchiveSchema,
  type DeliveryJobRequest,
} from "#shared/delivery-job.ts";
import { modelRecipe } from "#lib/delivery/model/recipe.ts";
import { modelTofuSource } from "#lib/delivery/model/tofu.ts";
import { frozenRunnerImage } from "#lib/delivery/model/oracle-inputs.ts";

export const RecoveryActionSchema = z.enum(["inspect", "plan", "apply"]);
export const RecoveryJobInputSchema = z.strictObject({
  intentId: z.string().min(1),
  action: RecoveryActionSchema,
  attempt: z.number().int().min(1).max(20),
  expectedEnvironmentGeneration: z.number().int().nonnegative(),
  snapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  target: z.enum(["control-plane", "tofu"]),
  stack: z.string().optional(),
  /** A model tofu recipe's frozen stack archive, which the Job stages and verifies by digest (X8). */
  archive: DeliveryJobArchiveSchema.optional(),
});
export type RecoveryAction = z.infer<typeof RecoveryActionSchema>;

function jobInput(
  input: {
    intent: PlatformRecoveryIntent;
    action: RecoveryAction;
    attempt: number;
  },
  target: Pick<
    z.input<typeof RecoveryJobInputSchema>,
    "target" | "stack" | "archive"
  >,
) {
  return RecoveryJobInputSchema.parse({
    intentId: input.intent.id,
    action: input.action,
    attempt: input.attempt,
    expectedEnvironmentGeneration: input.intent.expectedEnvironmentGeneration,
    snapshotFingerprint: input.intent.snapshotFingerprint,
    ...target,
  });
}

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
  const job = {
    deploymentId: input.intent.id,
    stageKey: `platform-recovery-${input.action}-${String(input.attempt)}`,
    recipe: "platform-recovery" as const,
  };
  const model = modelRecipe(detail);
  // A model tofu recipe runs with the runner its admission froze, from the
  // stack archive its selection froze, as its own steps did.
  if (model?.kind === "tofu" && detail.deployment.platformSnapshot === null) {
    const source = modelTofuSource(detail, model);
    return {
      ...job,
      runnerImage: frozenRunnerImage(detail, model.runner),
      sourceRevision: source.sourceRevision,
      input: jobInput(input, {
        target: "tofu",
        stack: model.stack,
        archive: source.archive,
      }),
    };
  }
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
    ...job,
    runnerImage: pipeline.runnerImage,
    sourceRevision: snapshot.source.sourceRevision,
    input: jobInput(input, {
      target: pipeline.kind,
      ...(pipeline.kind === "tofu" ? { stack: pipeline.stack } : {}),
    }),
  };
}
