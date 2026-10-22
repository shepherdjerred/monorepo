import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import {
  renderApplication as renderShared,
  type RenderedApplication as RenderedBody,
} from "@shepherdjerred/delivery/model-contract";
import type { KubernetesApplicationRecipe } from "./recipe.ts";

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
    configuration: detail.configuration.content,
    artifacts: Object.fromEntries(
      Object.entries(components).map(([component, artifact]) => [
        component,
        {
          uri: artifact.uri,
          version: artifact.version,
          digest: artifact.digest,
        },
      ]),
    ),
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
