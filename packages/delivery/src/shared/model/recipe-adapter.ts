import type { z } from "zod";
import { tofuStackPolicy } from "@shepherdjerred/ops-model/platform-policy.ts";
import type { PipelineDefinitionSchema } from "#shared/pipeline-contract.ts";
import {
  type KubernetesStep,
  type ProbeSchema,
  type RecipeDefinition,
  RecipeDefinitionSchema,
  type RunnerReference,
  type TofuStepKindSchema,
} from "./recipe-contract.ts";

type PipelineDefinition = z.infer<typeof PipelineDefinitionSchema>;
type Probe = z.infer<typeof ProbeSchema>;
type TofuStepKind = z.infer<typeof TofuStepKindSchema>;

const CI_RUNNER: RunnerReference = {
  service: "ci",
  component: "image:ci-base",
};
const CLUSTER = "https://kubernetes.default.svc";
const CHART_REPOSITORY = "https://chartmuseum.tailnet-1a49.ts.net";

/** v1 static archives are named `site:<bucket>`; the model names every archive `archive:` (4.3). */
function archiveComponentName(component: string): string {
  return component.startsWith("site:")
    ? `archive:${component.slice("site:".length)}`
    : component;
}

type ApplicationFields = {
  name: string;
  namespace: string;
  repository: string;
  chart: string;
  chartComponent: string;
  artifactParameters?: Record<string, string>;
  sharedLock?: "platform";
};

function kubernetesApplication(
  body: ApplicationFields,
  steps: KubernetesStep[],
  probes: Probe[],
): RecipeDefinition {
  const instance = `application:${body.name}`;
  return RecipeDefinitionSchema.parse({
    kind: "kubernetes-application",
    application: {
      name: body.name,
      project: "default",
      destination: { server: CLUSTER, namespace: body.namespace },
      source: { repoURL: body.repository, chart: body.chart },
      lifecycle: "retain",
    },
    chartComponent: body.chartComponent,
    artifactParameters: body.artifactParameters ?? {},
    runner: CI_RUNNER,
    steps: [
      { kind: "apply-safety", instance },
      { kind: "sync", instance },
      ...steps,
    ],
    ...(body.sharedLock === undefined ? {} : { sharedLock: body.sharedLock }),
    oracle: { probes, tests: [] },
  });
}

function argocdSteps(
  definition: Extract<PipelineDefinition, { kind: "argocd" }>,
): KubernetesStep[] {
  const instance = `application:${definition.application}`;
  const steps: KubernetesStep[] = [];
  if (definition.workerRollout !== undefined) {
    steps.push({
      kind: "worker-rollout",
      instance: `worker-pool:${definition.workerRollout.target}`,
      pointOfNoReturn: false,
      target: definition.workerRollout.target,
      imageComponent: definition.workerRollout.imageComponent,
    });
  }
  if (definition.scoutSite !== undefined) {
    steps.push({
      kind: "static-site",
      instance: `bucket:${definition.scoutSite.bucket}`,
      pointOfNoReturn: false,
      policy: {
        ...definition.scoutSite,
        archiveComponent: archiveComponentName(
          definition.scoutSite.archiveComponent,
        ),
      },
    });
  }
  if (definition.trmnlPlugins !== undefined) {
    steps.push({
      kind: "archive",
      instance,
      pointOfNoReturn: false,
      archiveComponent: definition.trmnlPlugins.archiveComponent,
    });
  }
  if (definition.forumRelease !== undefined) {
    steps.push({
      kind: "forum-bundle",
      instance,
      pointOfNoReturn: true,
      imageComponent: definition.forumRelease.imageComponent,
      bundleComponent: definition.forumRelease.bundleComponent,
    });
  }
  if (definition.minecraftUpgrade !== undefined) {
    steps.push({
      kind: "minecraft-upgrade",
      instance,
      pointOfNoReturn: true,
      imageComponent: definition.minecraftUpgrade.imageComponent,
      releaseMode:
        definition.minecraftUpgrade.releaseMode ?? "verified-restore",
    });
  }
  return steps;
}

function tofuRecipe(
  definition: Extract<PipelineDefinition, { kind: "tofu" }>,
): RecipeDefinition {
  const { mode } = tofuStackPolicy(definition.stack);
  if (mode === "validate-only") {
    throw new Error(
      `Stack ${definition.stack} is validate-only and has no target (section 7)`,
    );
  }
  const instance = `stack:${definition.stack}`;
  const kinds: TofuStepKind[] =
    mode === "reviewed-plan" ? ["plan", "approve", "apply"] : ["plan", "apply"];
  const tofu = {
    kind: "tofu",
    stack: definition.stack,
    archiveComponent: `archive:tofu-${definition.stack}`,
    runner: CI_RUNNER,
    steps: kinds.map((kind) => ({ kind, instance })),
    sharedLock: "platform",
  };
  return RecipeDefinitionSchema.parse(
    mode === "operator-only"
      ? { kind: "operator-run", wrapped: tofu, stages: kinds }
      : tofu,
  );
}

/**
 * Map a v1 pipeline definition onto the model's recipe. Runner digests
 * become the `ci` service's `image:ci-base` reference (C2); the fixed v1
 * blocks become ordered steps; `verification` becomes an oracle probe. Helm
 * `parameters` are configuration under P4, so the caller folds them into the
 * configuration revision first; the root release is kept readable as the
 * `apps` Application it synced (P1) although X6 retires it; `manual` has no
 * target and no counterpart.
 */
export function recipeFromPipeline(
  definition: PipelineDefinition,
): RecipeDefinition {
  switch (definition.kind) {
    case "argocd": {
      if (Object.keys(definition.parameters).length > 0) {
        throw new Error(
          `Pipeline ${definition.application} carries Helm parameters; they are configuration (P4) and must move to the configuration revision before conversion`,
        );
      }
      return kubernetesApplication(
        {
          name: definition.application,
          namespace: definition.namespace ?? definition.application,
          repository: definition.chartRepository,
          chart: definition.chartName,
          chartComponent: definition.chartComponent,
          artifactParameters: definition.artifactParameters,
        },
        argocdSteps(definition),
        definition.verification === undefined ? [] : [definition.verification],
      );
    }
    case "control-plane":
      return kubernetesApplication(
        {
          name: definition.application,
          namespace: definition.namespace,
          repository: definition.chartRepository,
          chart: definition.chartName,
          chartComponent: definition.chartComponent,
          sharedLock: "platform",
        },
        [],
        [],
      );
    case "root-release":
      return kubernetesApplication(
        {
          name: "apps",
          namespace: "argocd",
          repository: CHART_REPOSITORY,
          chart: "apps",
          chartComponent: "chart:apps",
          sharedLock: "platform",
        },
        [],
        [],
      );
    case "static-site": {
      const { kind: _kind, ...policy } = definition;
      return RecipeDefinitionSchema.parse({
        kind: "static-site",
        ...policy,
        archiveComponent: archiveComponentName(policy.archiveComponent),
      });
    }
    case "tofu":
      return tofuRecipe(definition);
    case "manual":
      throw new Error(
        `Manual pipelines have no target and no recipe counterpart: ${definition.reason}`,
      );
  }
}
