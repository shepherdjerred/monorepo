import { createHash } from "node:crypto";
import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import { DeliverySelectionSchema } from "homelab/scripts/argocd/argocd-delivery.ts";
import { forumReleaseParameters } from "./forum.ts";

/** Stable UUID accepted by the existing identity-bound Argo sync command. */
export function deliveryOperationId(deploymentId: string): string {
  const hash = createHash("sha256")
    .update(`delivery:${deploymentId}:reconcile`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function deliverySelection(detail: DeploymentDetail) {
  const pipeline = detail.pipeline.definition;
  if (pipeline.kind !== "argocd")
    throw new Error(
      "This pipeline requires its specialized deployment adapter",
    );
  const chart = detail.versionSet.components[pipeline.chartComponent];
  if (chart?.kind !== "chart")
    throw new Error("Version set lacks its exact deployment chart");
  if (detail.environment.application !== pipeline.application)
    throw new Error("Pipeline Application differs from registered environment");
  const parameters = {
    ...pipeline.parameters,
    ...detail.deployment.configuration,
  };
  for (const [parameter, component] of Object.entries(
    pipeline.artifactParameters,
  )) {
    const artifact = detail.versionSet.components[component];
    if (artifact?.kind !== "image" || artifact.uri.includes("@"))
      throw new Error(
        `Component ${component} is not an immutable image repository reference`,
      );
    parameters[parameter] = `${artifact.uri}@${artifact.digest}`;
  }
  Object.assign(parameters, forumReleaseParameters(detail));
  const selection = DeliverySelectionSchema.parse({
    application: pipeline.application,
    environmentId: detail.deployment.environmentId,
    repository: pipeline.chartRepository,
    chart: pipeline.chartName,
    revision: chart.version,
    ...(pipeline.namespace === undefined
      ? {}
      : { namespace: pipeline.namespace }),
    parameters,
  });
  const chartUrl = new URL(
    `charts/${selection.chart}-${selection.revision}.tgz`,
    `${selection.repository.replace(/\/$/u, "")}/`,
  ).href;
  if (chart.uri !== chartUrl)
    throw new Error(
      "Chart artifact URI does not match its registered repository/name/version",
    );
  return {
    selection,
    chart,
    operationId: deliveryOperationId(detail.deployment.id),
  };
}
