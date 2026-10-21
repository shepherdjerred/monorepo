import type { App } from "cdk8s";
import {
  type PipelineDefinition,
  PipelineDefinitionSchema,
} from "@shepherdjerred/delivery/contract";
import {
  type RecipeDefinition,
  RecipeDefinitionSchema,
  recipeFromPipeline,
} from "@shepherdjerred/delivery/model-contract";
import type { CatalogCore } from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import { catalogEnvironmentOf } from "@shepherdjerred/ops-model/delivery-catalog/migration.ts";
import {
  type CatalogConfiguration,
  environmentService,
} from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";
import {
  COMPANION_APPLICATIONS,
  type CompanionApplication,
  companionChartName,
} from "@shepherdjerred/homelab/cdk8s/src/resources/companions/names.ts";
import {
  ENVIRONMENT_APPLICATIONS,
  ENVIRONMENT_MONITORS,
  ENVIRONMENT_TESTS,
  OPERATOR_RUN_STAGES,
  PLATFORM_LOCK_ENVIRONMENTS,
} from "@shepherdjerred/homelab/cdk8s/src/catalog/catalog-targets.ts";
import {
  type ApplicationManifest,
  applicationBody,
} from "@shepherdjerred/homelab/cdk8s/src/catalog/catalog-applications.ts";
import {
  chartImageParameters,
  splitUpstreamValues,
} from "@shepherdjerred/homelab/cdk8s/src/catalog/catalog-values.ts";

/**
 * Serialises each catalog environment's recipe and configuration revision
 * (Delivery model, 4.7 and 4.8) from the Application constructors, rendered
 * with transition rendering on: that is the state the window's final root
 * release applies, so Delivery adopts every Application without changing it.
 *
 * `recipeFromPipeline` supplies the bound fields (chart component, runner,
 * steps, probes, shared lock) from each v1 registration, or from the v1 shape
 * the constructor implies where none exists; the rendered Application supplies
 * the whole body. Upstream-chart `valuesObject` content becomes the
 * configuration revision, except values that pin an image, which become
 * artifact parameters bound to components (C2).
 */

export type CatalogRevisions = {
  recipe: { id: string; definition: RecipeDefinition };
  configuration: CatalogConfiguration;
};

export type V1Registration = {
  environment: {
    id: string;
    configuration: Record<string, string>;
  };
  pipeline: PipelineDefinition;
};

type ApplicationRecipeInput = {
  manifest: ApplicationManifest;
  pipeline: PipelineDefinition | undefined;
  parameters: Record<string, string>;
};

/** `recipeFromPipeline` for the bound fields; the constructor for the body. */
function applicationRecipe(input: ApplicationRecipeInput): RecipeDefinition {
  const { manifest } = input;
  const pipeline: PipelineDefinition = input.pipeline ?? {
    kind: "argocd",
    application: manifest.metadata.name,
    chartRepository: manifest.spec.source.repoURL,
    chartName: manifest.spec.source.chart,
    chartComponent: `chart:${manifest.spec.source.chart}`,
    namespace: manifest.spec.destination.namespace,
    parameters: {},
    artifactParameters: input.parameters,
  };
  const base = recipeFromPipeline(pipeline);
  if (base.kind !== "kubernetes-application")
    throw new Error(
      `${manifest.metadata.name} pipeline is not an Application recipe`,
    );
  return RecipeDefinitionSchema.parse({
    ...base,
    application: applicationBody(manifest),
    artifactParameters: input.parameters,
  });
}

function withOracleAndLock(
  environmentId: string,
  recipe: RecipeDefinition,
): RecipeDefinition {
  if (recipe.kind !== "kubernetes-application") return recipe;
  const monitor = ENVIRONMENT_MONITORS[environmentId];
  const tests = ENVIRONMENT_TESTS[environmentId];
  return RecipeDefinitionSchema.parse({
    ...recipe,
    ...(PLATFORM_LOCK_ENVIRONMENTS.has(environmentId)
      ? { sharedLock: "platform" }
      : {}),
    oracle: {
      ...recipe.oracle,
      ...(tests === undefined ? {} : { tests }),
      ...(monitor === undefined ? {} : { monitor }),
    },
  });
}

export type CatalogRevisionInputs = {
  core: CatalogCore;
  app: App;
  applications: ReadonlyMap<string, ApplicationManifest>;
  registrations: readonly V1Registration[];
  /** Committed `desired-state.json` text per OpenTofu stack that has one. */
  desiredStates: Readonly<Record<string, string>>;
};

function v1Registration(
  inputs: CatalogRevisionInputs,
  environmentId: string,
): V1Registration | undefined {
  const matches = inputs.registrations.filter(
    (registration) =>
      registration.pipeline.kind !== "root-release" &&
      catalogEnvironmentOf(registration.environment.id) === environmentId,
  );
  if (matches.length > 1)
    throw new Error(`Several v1 registrations become ${environmentId}`);
  return matches[0];
}

function firstPartyImage(
  inputs: CatalogRevisionInputs,
  serviceId: string,
): string | undefined {
  const images = (
    inputs.core.services.find((service) => service.id === serviceId)
      ?.components ?? []
  ).filter(
    (component) =>
      component.producer === "first-party" &&
      component.name.startsWith("image:"),
  );
  return images.length === 1 ? images[0]?.name : undefined;
}

function applicationParameters(
  inputs: CatalogRevisionInputs,
  manifest: ApplicationManifest,
  serviceId: string,
): { parameters: Record<string, string>; values: Record<string, unknown> } {
  const values = manifest.spec.source.helm?.valuesObject;
  const repositoryChart = inputs.app.charts.some(
    (chart) => chart.node.id === manifest.spec.source.chart,
  );
  if (repositoryChart) {
    if (values !== undefined)
      throw new Error(
        `Repository chart Application ${manifest.metadata.name} carries values`,
      );
    return {
      parameters: chartImageParameters(
        inputs.app,
        manifest.spec.source.chart,
        firstPartyImage(inputs, serviceId),
      ),
      values: {},
    };
  }
  return splitUpstreamValues(manifest.metadata.name, values ?? {});
}

function configurationContent(
  registration: V1Registration | undefined,
  values: Record<string, unknown>,
): { content: Record<string, string>; forwardOnly: string[] } {
  const content: Record<string, string> = {
    ...registration?.environment.configuration,
  };
  const forwardOnly: string[] = [];
  const xenforo = content["forum.xenforoVersion"];
  if (xenforo !== undefined) {
    if (xenforo !== forumBundlePolicy.xenforoVersion)
      throw new Error(
        "The forum configuration and the forum bundle policy name different XenForo versions",
      );
    forwardOnly.push("forum.xenforoVersion");
  }
  if (Object.keys(values).length > 0)
    content["helm.valuesObject"] = JSON.stringify(values);
  return { content, forwardOnly };
}

function kubernetesRevisions(
  inputs: CatalogRevisionInputs,
  environmentId: string,
): {
  definition: RecipeDefinition;
  configuration: ReturnType<typeof configurationContent>;
} {
  const serviceId = environmentService(environmentId);
  const name = ENVIRONMENT_APPLICATIONS[environmentId] ?? serviceId;
  const manifest = inputs.applications.get(name);
  if (manifest === undefined)
    throw new Error(`${environmentId} names unrendered Application ${name}`);
  const registration = v1Registration(inputs, environmentId);
  const { parameters, values } = applicationParameters(
    inputs,
    manifest,
    serviceId,
  );
  const pipeline = registration?.pipeline;
  // A v1 parameter the rendered values do not carry (minecraft-tsmc's
  // `image.tag`) is Delivery-bound already; one the chart binds differently
  // is a broken contract.
  if (pipeline?.kind === "argocd")
    for (const [parameter, component] of Object.entries(
      pipeline.artifactParameters,
    )) {
      const derived = parameters[parameter];
      if (derived !== undefined && derived !== component)
        throw new Error(
          `${environmentId} v1 parameter ${parameter} binds ${component}; the chart binds ${derived}`,
        );
      parameters[parameter] = component;
    }
  const main = withOracleAndLock(
    environmentId,
    applicationRecipe({ manifest, pipeline, parameters }),
  );
  const configuration = configurationContent(registration, values);
  const companion = COMPANION_APPLICATIONS.find(
    (candidate: CompanionApplication) => candidate === name,
  );
  const stages = OPERATOR_RUN_STAGES[environmentId];
  if (stages !== undefined) {
    if (main.kind !== "kubernetes-application")
      throw new Error(`${environmentId} wraps a non-Application recipe`);
    return {
      definition: RecipeDefinitionSchema.parse({
        kind: "operator-run",
        wrapped: main,
        stages,
      }),
      configuration,
    };
  }
  if (companion === undefined) return { definition: main, configuration };
  const companionName = companionChartName(companion);
  const companionManifest = inputs.applications.get(companionName);
  if (companionManifest === undefined)
    throw new Error(`Companion Application ${companionName} is missing`);
  const companionRecipe = applicationRecipe({
    manifest: companionManifest,
    pipeline: undefined,
    parameters: {},
  });
  return {
    definition: RecipeDefinitionSchema.parse({
      kind: "compound",
      subRecipes: [
        {
          instance: `application:${companionName}`,
          definition: companionRecipe,
        },
        { instance: `application:${name}`, definition: main },
      ],
    }),
    configuration,
  };
}

function staticSiteRevisions(
  inputs: CatalogRevisionInputs,
  environmentId: string,
): RecipeDefinition {
  const registration = v1Registration(inputs, environmentId);
  if (registration?.pipeline.kind !== "static-site")
    throw new Error(`${environmentId} has no reviewed static-site pipeline`);
  return recipeFromPipeline(registration.pipeline);
}

/** The v1 runner digest `recipeFromPipeline` replaces with the `ci` runner reference. */
function v1RunnerImage(inputs: CatalogRevisionInputs): string {
  for (const registration of inputs.registrations)
    if (registration.pipeline.kind === "root-release")
      return registration.pipeline.runnerImage;
  throw new Error("No v1 platform registration carries the runner image");
}

function tofuRevisions(
  inputs: CatalogRevisionInputs,
  environmentId: string,
): {
  definition: RecipeDefinition;
  configuration: ReturnType<typeof configurationContent>;
} {
  const stack = TofuStackSchema.parse(
    environmentService(environmentId).slice("tofu-".length),
  );
  const desiredState = inputs.desiredStates[stack];
  return {
    definition: recipeFromPipeline(
      PipelineDefinitionSchema.parse({
        kind: "tofu",
        stack,
        runnerImage: v1RunnerImage(inputs),
      }),
    ),
    configuration: {
      content:
        desiredState === undefined
          ? {}
          : { "desired-state.json": desiredState },
      forwardOnly: [],
    },
  };
}

/** Every catalog environment's revisions, keyed by environment id. */
export function catalogRevisions(
  inputs: CatalogRevisionInputs,
): Map<string, CatalogRevisions> {
  const revisions = new Map<string, CatalogRevisions>();
  for (const environment of inputs.core.environments) {
    const serviceId = environmentService(environment.id);
    const service = inputs.core.services.find(
      (candidate) => candidate.id === serviceId,
    );
    if (service === undefined)
      throw new Error(`${environment.id} has no catalog service`);
    const archives = service.components.filter((component) =>
      component.name.startsWith("archive:"),
    );
    const isTofu = serviceId.startsWith("tofu-");
    const isSite =
      !isTofu &&
      archives.length === 1 &&
      service.components.length === 1 &&
      archives[0]?.name === `archive:${serviceId}`;
    const generated = isTofu
      ? tofuRevisions(inputs, environment.id)
      : isSite
        ? {
            definition: staticSiteRevisions(inputs, environment.id),
            configuration: { content: {}, forwardOnly: [] },
          }
        : kubernetesRevisions(inputs, environment.id);
    revisions.set(environment.id, {
      recipe: {
        id: environment.recipeRevisionId,
        definition: generated.definition,
      },
      configuration: {
        id: environment.configurationRevisionId,
        ...generated.configuration,
      },
    });
  }
  return revisions;
}
