import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import { attestationStageKey } from "@shepherdjerred/delivery/model-contract";
import type { OperatorRunRecipe } from "#lib/delivery/model/recipe.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { recordStage, stageOf } from "./stages.ts";

/**
 * The operator-run step: an attested operator tool outside the cluster
 * performs the effects; the executor records its intent, then waits until
 * every declared stage is attested (section 5).
 */
export async function awaitAttestations(
  current: DeploymentDetail,
  recipe: OperatorRunRecipe,
  key: string,
  record: typeof recordStage = recordStage,
): Promise<{ waiting: boolean }> {
  const operationId = deliveryOperationId(current.deployment.id);
  if (stageOf(current, key) === undefined)
    await record(current, key, "running", { operationId });
  const attested = new Set(
    current.stages
      .filter((stage) => stage.status === "succeeded")
      .map((stage) => stage.key),
  );
  const missing = recipe.stages.filter(
    (stage) => !attested.has(attestationStageKey(stage)),
  );
  if (missing.length > 0) return { waiting: true };
  await record(current, key, "succeeded", {
    operationId,
    evidence: [
      {
        kind: "attestation",
        operationId,
        summary: `Operator attested every declared stage: ${recipe.stages.join(", ")}`,
      },
    ],
  });
  return { waiting: false };
}
