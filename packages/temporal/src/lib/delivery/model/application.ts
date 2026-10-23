import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import {
  renderApplication as renderShared,
  type RenderArtifact,
  type RenderedApplication as RenderedBody,
} from "@shepherdjerred/delivery/model-contract";
import type { KubernetesApplicationRecipe } from "./recipe.ts";
import { workerPoolParameters } from "#lib/delivery/workers/worker-pool.ts";
import { minecraftModelParameters } from "#lib/delivery/minecraft.ts";

export type RenderedApplication = {
  name: string;
  environmentId: string;
  /** The exact source revision the deployment binds (chart version or commit). */
  revision: string;
  /** The single source the readback must observe byte-for-byte. */
  source: RenderedBody["spec"]["source"];
  /** The full Application object Delivery writes (T2). */
  body: RenderedBody;
  /** The source artifact, verified before any effect. */
  sourceArtifact: { id: string; uri: string; digest: string; version: string };
};

/**
 * Parameters a step derives from the deployment's frozen runtime state,
 * for the Application whose recipe carries that step: the retained worker
 * hosts (E5) and the TSMC server's image repository.
 */
function runtimeParameters(
  detail: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
): Record<string, string> {
  const kinds = new Set(recipe.steps.map((step) => step.kind));
  return {
    ...(kinds.has("worker-rollout") ? workerPoolParameters(detail) : {}),
    ...(kinds.has("minecraft-upgrade") ? minecraftModelParameters(detail) : {}),
  };
}

/**
 * The Application a deployment writes, from the one shared renderer the
 * cold-start tool also uses, over the deployment's frozen selection.
 */
export function renderApplication(
  detail: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
): RenderedApplication {
  const components = detail.versionSet.components;
  const body = renderShared({
    recipe,
    environmentId: detail.deployment.environmentId,
    configuration: {
      ...detail.configuration.content,
      ...runtimeParameters(detail, recipe),
    },
    artifacts: selectionArtifacts(detail),
  });
  const sourceArtifact = components[recipe.chartComponent];
  if (sourceArtifact === undefined)
    throw new Error(`Selection lacks component ${recipe.chartComponent}`);
  return {
    name: body.metadata.name,
    environmentId: detail.deployment.environmentId,
    revision: body.spec.source.targetRevision,
    source: body.spec.source,
    body,
    sourceArtifact: {
      id: sourceArtifact.id,
      uri: sourceArtifact.uri,
      digest: sourceArtifact.digest,
      version: sourceArtifact.version,
    },
  };
}

/** The frozen selection's artifacts as the shared renderer reads them. */
export function selectionArtifacts(
  detail: DeploymentDetail,
): Record<string, RenderArtifact> {
  return Object.fromEntries(
    Object.entries(detail.versionSet.components).map(
      ([component, artifact]) => [
        component,
        {
          uri: artifact.uri,
          version: artifact.version,
          digest: artifact.digest,
        },
      ],
    ),
  );
}
