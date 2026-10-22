import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import {
  AdmissionSnapshotSchema,
  renderArtifactParameter,
} from "@shepherdjerred/delivery/model-contract";
import { deliveryArgoParameters } from "homelab/scripts/argocd/argocd-delivery.ts";
import { DELIVERY_ENVIRONMENT_ANNOTATION } from "#lib/delivery/argo-client.ts";
import type { KubernetesApplicationRecipe } from "./recipe.ts";

/** ArgoCD's finalizer that cascades deletion to the Application's resources. */
export const CASCADE_FINALIZER = "resources-finalizer.argocd.argoproj.io";

export type RenderedApplication = {
  name: string;
  environmentId: string;
  /** The exact source revision the deployment binds (chart version or commit). */
  revision: string;
  /** The single source the readback must observe byte-for-byte. */
  source: Record<string, unknown>;
  /** The full Application object Delivery writes (T2). */
  body: {
    apiVersion: "argoproj.io/v1alpha1";
    kind: "Application";
    metadata: Record<string, unknown>;
    spec: Record<string, unknown>;
  };
  /** The source artifact, verified before any effect. */
  sourceArtifact: { id: string; uri: string; digest: string; version: string };
};

function requireArtifact(
  detail: DeploymentDetail,
  component: string,
): RenderedApplication["sourceArtifact"] & { kind: string } {
  const artifact = detail.versionSet.components[component];
  if (artifact === undefined)
    throw new Error(`Selection lacks component ${component}`);
  return artifact;
}

/** Helm values: configuration revision content plus artifact parameters by path form (A5). */
function parameters(
  detail: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
): Record<string, string> {
  const admission = AdmissionSnapshotSchema.parse(
    detail.deployment.admissionSnapshot,
  );
  const values: Record<string, string> = { ...detail.configuration.content };
  for (const [path, value] of Object.entries(recipe.artifactParameters)) {
    const artifact =
      typeof value === "string"
        ? requireArtifact(detail, value)
        : admission.references[path];
    if (artifact?.kind !== "image" || artifact.uri.includes("@"))
      throw new Error(
        `Artifact parameter ${path} is not bound to an immutable image repository`,
      );
    values[path] = renderArtifactParameter(path, artifact);
  }
  return values;
}

function finalizers(recipe: KubernetesApplicationRecipe): string[] {
  const declared = recipe.application.metadata.finalizers.filter(
    (entry) => entry !== CASCADE_FINALIZER,
  );
  return recipe.application.lifecycle === "cascade"
    ? [...declared, CASCADE_FINALIZER]
    : declared;
}

/**
 * The whole Application from the frozen recipe, selection, configuration and
 * admission snapshot. Automation is off while a deployment owns the target;
 * self-heal on the accepted exact source is enabled only after acceptance (T4).
 */
export function renderApplication(
  detail: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
): RenderedApplication {
  const body = recipe.application;
  const sourceArtifact = requireArtifact(detail, recipe.chartComponent);
  // A Helm source names its chart; a Git source names a path (4.7).
  const source: Record<string, unknown> =
    "chart" in body.source
      ? {
          repoURL: body.source.repoURL,
          chart: body.source.chart,
          targetRevision: sourceArtifact.version,
          helm: {
            ...body.source.helm,
            parameters: deliveryArgoParameters(parameters(detail, recipe)),
          },
        }
      : {
          repoURL: body.source.repoURL,
          path: body.source.path,
          targetRevision: sourceArtifact.version,
        };
  const environmentId = detail.deployment.environmentId;
  return {
    name: body.name,
    environmentId,
    revision: sourceArtifact.version,
    source,
    sourceArtifact: {
      id: sourceArtifact.id,
      uri: sourceArtifact.uri,
      digest: sourceArtifact.digest,
      version: sourceArtifact.version,
    },
    body: {
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: {
        name: body.name,
        namespace: "argocd",
        labels: body.metadata.labels,
        annotations: {
          ...body.metadata.annotations,
          [DELIVERY_ENVIRONMENT_ANNOTATION]: environmentId,
        },
        finalizers: finalizers(recipe),
      },
      spec: {
        project: body.project,
        destination: body.destination,
        source,
        syncPolicy: {
          automated: { enabled: false },
          ...(body.syncOptions.length === 0
            ? {}
            : { syncOptions: body.syncOptions }),
        },
        ...(body.ignoreDifferences.length === 0
          ? {}
          : { ignoreDifferences: body.ignoreDifferences }),
        ...(body.revisionHistoryLimit === undefined
          ? {}
          : { revisionHistoryLimit: body.revisionHistoryLimit }),
      },
    },
  };
}
