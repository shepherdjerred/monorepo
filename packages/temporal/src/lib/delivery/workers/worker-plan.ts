import {
  WorkerRolloutPlanSchema,
  type DeploymentDetail,
  type EvidenceInput,
  type WorkerRolloutPlan,
} from "@shepherdjerred/delivery/contract";
import { stepRecipeOf } from "@shepherdjerred/delivery/model-contract";
import { z } from "zod";
import { frozenRunnerImage } from "#lib/delivery/model/oracle-inputs.ts";

const PLAN_ADAPTER = "worker-rollout-plan";
const PlanEvidenceSchema = z.strictObject({
  adapter: z.literal(PLAN_ADAPTER),
  plan: WorkerRolloutPlanSchema,
});

/** The routing plan the preflight Job derived, recorded as its stage evidence. */
export function workerPlanEvidence(
  plan: WorkerRolloutPlan,
  operationId: string,
): EvidenceInput {
  return {
    kind: "preflight",
    operationId,
    summary: JSON.stringify({ adapter: PLAN_ADAPTER, plan }),
  };
}

/**
 * The plan a settled preflight recorded. A resumed rollout routes by it,
 * never by a plan derived again from routing it may already have moved.
 */
export function recordedWorkerPlan(
  detail: DeploymentDetail,
): WorkerRolloutPlan {
  const stage = detail.stages.find(
    (entry) => entry.key === "worker-preflight" && entry.status === "succeeded",
  );
  if (stage === undefined)
    throw new Error("Worker preflight has not settled; no plan is recorded");
  const plans = detail.evidence
    .filter(
      (entry) =>
        entry.kind === "preflight" &&
        entry.operationId === stage.operationId &&
        entry.summary.startsWith(`{"adapter":"${PLAN_ADAPTER}"`),
    )
    .map((entry) => PlanEvidenceSchema.parse(JSON.parse(entry.summary)).plan);
  const [plan, ...others] = plans;
  if (plan === undefined || others.length > 0)
    throw new Error("Worker preflight must record exactly one routing plan");
  if (plan.deploymentId !== detail.deployment.id)
    throw new Error("Recorded worker plan belongs to another deployment");
  return plan;
}

/**
 * The runner a worker Job runs on: the v1 pipeline's pinned runner, or the
 * runner admission froze for the model recipe that rolls the pool (A5).
 */
export function workerRunnerImage(detail: DeploymentDetail): string {
  const definition = detail.pipeline.definition;
  if (definition.kind === "argocd") {
    if (definition.workerRollout === undefined)
      throw new Error("Pipeline declares no worker rollout");
    return definition.workerRollout.runnerImage;
  }
  const recipe = stepRecipeOf(definition, "worker-rollout");
  if (recipe === null) throw new Error("Recipe has no worker-rollout step");
  return frozenRunnerImage(detail, recipe.runner);
}
