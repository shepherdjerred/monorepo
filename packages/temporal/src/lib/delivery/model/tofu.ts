import type {
  DeploymentDetail,
  TofuPlanReceipt,
} from "@shepherdjerred/delivery/contract";
import {
  TOFU_DESIRED_STATE_KEY,
  tofuModelJobInput,
} from "#lib/delivery/platform/tofu-input.ts";
import type { DeliveryJobRequest } from "#shared/delivery-job.ts";
import { frozenRunnerImage } from "./oracle-inputs.ts";
import type { TofuRecipe } from "./recipe.ts";

/**
 * The exact native Job a model Tofu step runs. The step executor creates it
 * and recovery reconstructs it from the same frozen deployment, so both
 * name one Job.
 */
export function modelTofuJobRequest(
  current: DeploymentDetail,
  step: {
    recipe: TofuRecipe;
    key: string;
    kind: "tofu-plan" | "tofu-apply";
    jobInput: unknown;
  },
): DeliveryJobRequest {
  return {
    deploymentId: current.deployment.id,
    stageKey: step.key,
    recipe: step.kind,
    runnerImage: frozenRunnerImage(current, step.recipe.runner),
    sourceRevision: modelTofuSource(current, step.recipe).sourceRevision,
    input: step.jobInput,
  };
}

/** The stack archive the deployment's set revision selects, which every Tofu step runs from (X8). */
export function modelTofuSource(
  current: Pick<DeploymentDetail, "versionSet">,
  recipe: TofuRecipe,
) {
  const archive = current.versionSet.components[recipe.archiveComponent];
  if (archive?.kind !== "archive")
    throw new Error(
      `Selection lacks the ${recipe.archiveComponent} stack archive`,
    );
  return {
    archive: { uri: archive.uri, digest: archive.digest },
    sourceBuildId: archive.buildId,
    sourceRevision: archive.sourceRevision,
  };
}

/** The frozen configuration's desired state, which a platform stack's Jobs receive with their input (X8). */
export function modelTofuDesiredState(
  current: Pick<DeploymentDetail, "configuration">,
): string | undefined {
  return current.configuration.content[TOFU_DESIRED_STATE_KEY];
}

/** The plan step's Job input. */
export function modelPlanInput(
  current: Pick<DeploymentDetail, "versionSet" | "configuration">,
  recipe: TofuRecipe,
): unknown {
  const source = modelTofuSource(current, recipe);
  return tofuModelJobInput(
    {
      kind: "plan",
      stack: recipe.stack,
      sourceBuildId: source.sourceBuildId,
      sourceRevision: source.sourceRevision,
    },
    source.archive,
    modelTofuDesiredState(current),
  );
}

/** The apply step's Job input: the saved plan this same deployment produced. */
export function modelApplyInput(
  current: Pick<
    DeploymentDetail,
    "versionSet" | "deployment" | "configuration"
  >,
  recipe: TofuRecipe,
  plan: TofuPlanReceipt,
): unknown {
  const source = modelTofuSource(current, recipe);
  return tofuModelJobInput(
    {
      kind: "apply",
      stack: recipe.stack,
      sourceRevision: source.sourceRevision,
      planDeploymentId: current.deployment.id,
      plan,
    },
    source.archive,
    modelTofuDesiredState(current),
  );
}
