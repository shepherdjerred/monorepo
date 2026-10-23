import { configurationDocument } from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import {
  renderArtifactParameter,
  type RecipeDefinition,
} from "./recipe-contract.ts";

/**
 * The one renderer of the ArgoCD Application a `kubernetes-application`
 * recipe describes for a selection (T2). Pure and I/O-free: the executor's
 * create and update path and the cold-start tool both call it, so a cold
 * start renders exactly the object Delivery would write.
 */

/** Ownership marker Delivery writes into every Application body it manages. */
export const DELIVERY_ENVIRONMENT_ANNOTATION =
  "delivery.shepherdjerred.com/environment";
/** ArgoCD's finalizer that cascades deletion to the Application's resources. */
export const RESOURCES_FINALIZER = "resources-finalizer.argocd.argoproj.io";
/** The operation-info key that carries a request identity into ArgoCD (T5). */
export const REQUEST_INFO = "ci.sjer.red/request-id";

export type RenderArtifact = { uri: string; version: string; digest: string };

/**
 * Helm parameters as literal strings: sorted, forced to strings, and with
 * strvals' separators escaped so JSON values survive intact.
 */
export function helmParameters(values: Readonly<Record<string, string>>) {
  return Object.entries(values)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({
      name,
      value: value.replaceAll(/[\\{},]/gu, String.raw`\$&`),
      forceString: true as const,
    }));
}

function selected(
  artifacts: Readonly<Record<string, RenderArtifact>>,
  component: string,
): RenderArtifact {
  const artifact = artifacts[component];
  if (artifact === undefined)
    throw new Error(
      `The selected set revision has no artifact for ${component}`,
    );
  return artifact;
}

type KubernetesRecipe = Extract<
  RecipeDefinition,
  { kind: "kubernetes-application" }
>;

function source(
  recipe: KubernetesRecipe,
  configuration: Readonly<Record<string, string>>,
  artifacts: Readonly<Record<string, RenderArtifact>>,
) {
  const body = recipe.application.source;
  const revision = selected(artifacts, recipe.chartComponent).version;
  if (!("chart" in body)) {
    if (Object.keys(configuration).length > 0)
      throw new Error("A Git source takes no Helm configuration");
    // ArgoCD syncs exactly the acquired commit, never a tag or branch that
    // could move under the selection.
    if (!/^[a-f0-9]{40}$/u.test(revision))
      throw new Error(
        `A Git source syncs an exact commit; ${recipe.chartComponent} has version ${revision}`,
      );
    return { repoURL: body.repoURL, path: body.path, targetRevision: revision };
  }
  const values = helmValues(recipe, configuration, artifacts);
  return {
    repoURL: body.repoURL,
    chart: body.chart,
    targetRevision: revision,
    helm: {
      ...body.helm,
      ...(values.valuesObject === undefined
        ? {}
        : { valuesObject: values.valuesObject }),
      parameters: helmParameters(values.parameters),
    },
  };
}

/**
 * The Helm values a Helm-source recipe renders before strvals escaping:
 * configuration parameters plus artifact parameters in their formats, and
 * the configuration's `helm.valuesObject`.
 */
export function helmValues(
  recipe: KubernetesRecipe,
  configuration: Readonly<Record<string, string>>,
  artifacts: Readonly<Record<string, RenderArtifact>>,
): { parameters: Record<string, string>; valuesObject: unknown } {
  const document = configurationDocument(configuration);
  const parameters: Record<string, string> = { ...document.helm.parameters };
  for (const [path, parameter] of Object.entries(recipe.artifactParameters)) {
    if (parameters[path] !== undefined)
      throw new Error(
        `Configuration sets ${path}, which the artifact parameter binds`,
      );
    parameters[path] = renderArtifactParameter(
      parameter.format,
      selected(artifacts, parameter.component),
    );
  }
  return { parameters, valuesObject: document.helm.valuesObject };
}

/**
 * The full Application for one environment's selection: the recipe body,
 * the source artifact's version as the source revision, Helm values from the
 * configuration's `helm.valuesObject`, and parameters from the configuration
 * and the artifact parameters in their formats. Automation stays off while a
 * deployment owns the target; self-heal on the accepted exact source is the
 * adapter's decision after acceptance (T4).
 *
 * `initialSync` adds the sync operation an operator-created Application
 * needs to converge during a cold start, carrying its request identity
 * (T5); Delivery takes the Application over on its next deployment.
 */
export function renderApplication(input: {
  recipe: RecipeDefinition;
  environmentId: string;
  configuration: Readonly<Record<string, string>>;
  artifacts: Readonly<Record<string, RenderArtifact>>;
  initialSync?: { requestId: string };
}) {
  const { recipe } = input;
  if (recipe.kind !== "kubernetes-application")
    throw new Error(
      `A ${recipe.kind} recipe does not describe an ArgoCD Application`,
    );
  const body = recipe.application;
  const rendered = source(recipe, input.configuration, input.artifacts);
  const finalizers = body.metadata.finalizers.filter(
    (finalizer) => finalizer !== RESOURCES_FINALIZER,
  );
  return {
    apiVersion: "argoproj.io/v1alpha1" as const,
    kind: "Application" as const,
    metadata: {
      name: body.name,
      namespace: "argocd",
      labels: body.metadata.labels,
      annotations: {
        ...body.metadata.annotations,
        [DELIVERY_ENVIRONMENT_ANNOTATION]: input.environmentId,
      },
      finalizers:
        body.lifecycle === "cascade"
          ? [...finalizers, RESOURCES_FINALIZER]
          : finalizers,
    },
    spec: {
      project: body.project,
      destination: body.destination,
      source: rendered,
      syncPolicy: {
        automated: { enabled: false },
        syncOptions: body.syncOptions,
      },
      ignoreDifferences: body.ignoreDifferences,
      ...(body.revisionHistoryLimit === undefined
        ? {}
        : { revisionHistoryLimit: body.revisionHistoryLimit }),
    },
    ...(input.initialSync === undefined
      ? {}
      : {
          operation: {
            initiatedBy: { username: "delivery-cold-start" },
            info: [{ name: REQUEST_INFO, value: input.initialSync.requestId }],
            sync: { revision: rendered.targetRevision },
          },
        }),
  };
}
export type RenderedApplication = ReturnType<typeof renderApplication>;
