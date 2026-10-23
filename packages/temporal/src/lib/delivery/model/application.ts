import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import {
  forumReleaseOf,
  helmSource,
  helmValues,
  renderApplication as renderShared,
  type RenderArtifact,
  renderArtifactParameter,
  type RenderedApplication as RenderedBody,
} from "@shepherdjerred/delivery/model-contract";
import type { DeliverySelection } from "homelab/scripts/argocd/argocd-delivery.ts";
import { forumReleaseParameters } from "#lib/delivery/forum.ts";
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
 * A forum-bundle step's release inputs as Helm parameters: the chart's
 * release Job, named by this deployment, verifies and migrates the frozen
 * bundle. They come from the Application's own recipe, so a compound
 * recipe's other members receive none. An input an artifact parameter
 * already binds (the image) must render identically and is left to that
 * parameter.
 */
function forumInputs(
  detail: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
): Record<string, string> {
  const inputs = forumReleaseParameters(detail, recipe);
  for (const [path, parameter] of Object.entries(recipe.artifactParameters)) {
    const input = inputs[path];
    if (input === undefined) continue;
    const artifact = detail.versionSet.components[parameter.component];
    if (
      artifact === undefined ||
      renderArtifactParameter(parameter.format, artifact) !== input
    )
      throw new Error(
        `Forum release input ${path} differs from its artifact parameter`,
      );
  }
  return Object.fromEntries(
    Object.entries(inputs).filter(
      ([path]) => recipe.artifactParameters[path] === undefined,
    ),
  );
}

/**
 * The configuration an Application renders with: the frozen configuration
 * revision, plus the parameters its own steps derive from the deployment.
 */
export function renderConfiguration(
  detail: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
): Record<string, string> {
  return {
    ...detail.configuration.content,
    ...runtimeParameters(detail, recipe),
    ...forumInputs(detail, recipe),
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
    configuration: renderConfiguration(detail, recipe),
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

/**
 * The v1 selection a forum Application rendered from its recipe is, so the
 * sync reuses `forumSyncPrunes` and native Forum recovery renders the
 * chart's release Job unchanged: the selection's patch over the written
 * Application reproduces its source exactly, Helm values included. Null
 * when the recipe has no forum-bundle step.
 */
export function forumSelection(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
): DeliverySelection | null {
  if (forumReleaseOf(recipe) === undefined) return null;
  const rendered = renderApplication(current, recipe);
  const source = helmSource(recipe.application.source);
  if (source === null)
    throw new Error("A forum release syncs a Helm chart source");
  return {
    application: rendered.name,
    environmentId: rendered.environmentId,
    repository: source.repoURL,
    chart: source.chart,
    revision: rendered.revision,
    namespace: recipe.application.destination.namespace,
    parameters: helmValues(
      recipe,
      renderConfiguration(current, recipe),
      selectionArtifacts(current),
    ).parameters,
  };
}
