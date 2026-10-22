import type {
  DeploymentDetail,
  TofuPlanReceipt,
} from "@shepherdjerred/delivery/contract";
import { tofuModelJobInput } from "#lib/delivery/platform/tofu-input.ts";
import type { TofuRecipe } from "./recipe.ts";

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

/** The plan step's Job input. */
export function modelPlanInput(
  current: Pick<DeploymentDetail, "versionSet">,
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
  );
}

/** The apply step's Job input: the saved plan this same deployment produced. */
export function modelApplyInput(
  current: Pick<DeploymentDetail, "versionSet" | "deployment">,
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
  );
}
