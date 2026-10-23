import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import {
  helmValues,
  stepRecipeOf,
} from "@shepherdjerred/delivery/model-contract";
import { DeliverySelectionSchema } from "homelab/scripts/argocd/argocd-delivery.ts";
import { workerPoolParameters } from "#lib/delivery/workers/worker-pool.ts";
import { selectionArtifacts } from "./application.ts";

/**
 * The exact chart selection a model worker rollout syncs: the recipe's Helm
 * values and the retained-host pool, as the image-provenance Job renders it
 * to prove the control plane stays isolated from the worker ramp.
 */
export function modelWorkerChartSelection(detail: DeploymentDetail) {
  const recipe = stepRecipeOf(detail.pipeline.definition, "worker-rollout");
  if (recipe === null) throw new Error("Recipe has no worker-rollout step");
  const source = recipe.application.source;
  if (!("chart" in source))
    throw new Error("A worker rollout deploys a Helm chart source");
  const values = helmValues(
    recipe,
    { ...detail.configuration.content, ...workerPoolParameters(detail) },
    selectionArtifacts(detail),
  );
  if (values.valuesObject !== undefined)
    throw new Error(
      "The control-plane proof renders Helm parameters; a helm.valuesObject configuration cannot be proved",
    );
  const chart = detail.versionSet.components[recipe.chartComponent];
  if (chart?.kind !== "chart")
    throw new Error("Selection lacks the worker recipe's chart artifact");
  return {
    selection: DeliverySelectionSchema.parse({
      application: recipe.application.name,
      environmentId: detail.deployment.environmentId,
      repository: source.repoURL,
      chart: source.chart,
      revision: chart.version,
      namespace: recipe.application.destination.namespace,
      parameters: values.parameters,
    }),
    chart,
  };
}
