import type { App } from "cdk8s";
import {
  type PipelineDefinition,
  PipelineDefinitionSchema,
} from "@shepherdjerred/delivery/contract";
import {
  type ArtifactParameter,
  type RecipeDefinition,
  RecipeDefinitionSchema,
  recipeFromPipeline,
} from "@shepherdjerred/delivery/model-contract";
import type { CatalogCore } from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import { catalogEnvironmentOf } from "@shepherdjerred/ops-model/delivery-catalog/migration.ts";
import { ENVIRONMENT_APPLICATIONS } from "@shepherdjerred/ops-model/delivery-catalog/applications.ts";
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
  FOLLOWING_COMPANIONS,
} from "@shepherdjerred/homelab/cdk8s/src/resources/companions/names.ts";
import {
  CHANNEL_RECIPES,
  NODE_RECIPES,
  ENVIRONMENT_MONITORS,
  ENVIRONMENT_TESTS,
  OPERATOR_RUN_STAGES,
  PLATFORM_LOCK_ENVIRONMENTS,
} from "@shepherdjerred/homelab/cdk8s/src/catalog/catalog-targets.ts";
import {
  sourceComponent,
  type ApplicationManifest,
  applicationBody,
} from "@shepherdjerred/homelab/cdk8s/src/catalog/catalog-applications.ts";
import {
  artifactParameter,
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
  parameters: Record<string, ArtifactParameter>;
};

/**
 * A v1 pipeline names only HTTPS chart repositories. An Application with no
 * v1 registration whose source is an OCI repository or a Git path takes the
 * adapter's step skeleton from this placeholder; its source and binding are
 * the rendered Application's.
 */
const SKELETON_REPOSITORY = "https://skeleton.invalid/";

/** `recipeFromPipeline` for the steps and the bound fields; the constructor for the body and its source. */
function applicationRecipe(input: ApplicationRecipeInput): RecipeDefinition {
  const { manifest } = input;
  const { source } = manifest.spec;
  const chart = "chart" in source ? source.chart : manifest.metadata.name;
  const pipeline: PipelineDefinition = input.pipeline ?? {
    kind: "argocd",
    application: manifest.metadata.name,
    chartRepository: source.repoURL.startsWith("https://")
      ? source.repoURL
      : SKELETON_REPOSITORY,
    chartName: chart,
    chartComponent: `chart:${chart}`,
    namespace: manifest.spec.destination.namespace,
    parameters: {},
    artifactParameters: Object.fromEntries(
      Object.entries(input.parameters).map(([path, { component }]) => [
        path,
        component,
      ]),
    ),
  };
  const base = recipeFromPipeline(pipeline);
  if (base.kind !== "kubernetes-application")
    throw new Error(
      `${manifest.metadata.name} pipeline is not an Application recipe`,
    );
  return RecipeDefinitionSchema.parse({
    ...base,
    application: applicationBody(manifest),
    chartComponent: sourceComponent(manifest),
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
  /**
   * The committed recipe of each independent static site, by environment.
   * Delivery v2 retired their v1 registrations (#4009), so the reviewed v2
   * recipe is the source; the generator only checks it.
   */
  siteRecipes: Readonly<Record<string, unknown>>;
  /** The CI runner image (`ci/ci-image/DIGEST`) a v1 Tofu pipeline names. */
  runnerImage: string;
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
): {
  parameters: Record<string, ArtifactParameter>;
  values: Record<string, unknown>;
} {
  const { source } = manifest.spec;
  // A Git path takes no Helm values or parameters.
  if (!("chart" in source)) return { parameters: {}, values: {} };
  const values = source.helm?.valuesObject;
  const repositoryChart = inputs.app.charts.some(
    (chart) => chart.node.id === source.chart,
  );
  if (repositoryChart) {
    if (values !== undefined)
      throw new Error(
        `Repository chart Application ${manifest.metadata.name} carries values`,
      );
    return {
      parameters: chartImageParameters(
        inputs.app,
        source.chart,
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
    // A JSON pointer into the configuration's structured view (F3), where
    // every content key but `helm.valuesObject` is a Helm parameter.
    forwardOnly.push("/helm/parameters/forum.xenforoVersion");
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
      if (derived !== undefined && derived.component !== component)
        throw new Error(
          `${environmentId} v1 parameter ${parameter} binds ${component}; the chart binds ${derived.component}`,
        );
      parameters[parameter] ??= artifactParameter(parameter, component);
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
  const following = FOLLOWING_COMPANIONS[name];
  if (companion === undefined && following === undefined)
    return { definition: main, configuration };
  return {
    definition: compoundRecipe(inputs, { companion, following, name }, main),
    configuration,
  };
}

/**
 * A leading companion's Application before its upstream Application and, for
 * a following chart whose objects need the upstream's CRDs, one after it.
 */
function compoundRecipe(
  inputs: CatalogRevisionInputs,
  sides: {
    readonly companion: CompanionApplication | undefined;
    readonly following: string | undefined;
    readonly name: string;
  },
  main: RecipeDefinition,
): RecipeDefinition {
  const { companion, following, name } = sides;
  const sideRecipe = (application: string) => {
    const manifest = inputs.applications.get(application);
    if (manifest === undefined)
      throw new Error(`Companion Application ${application} is missing`);
    return {
      instance: `application:${application}`,
      definition: applicationRecipe({
        manifest,
        pipeline: undefined,
        parameters: {},
      }),
    };
  };
  return RecipeDefinitionSchema.parse({
    kind: "compound",
    subRecipes: [
      ...(companion === undefined
        ? []
        : [sideRecipe(companionChartName(companion))]),
      { instance: `application:${name}`, definition: main },
      ...(following === undefined ? [] : [sideRecipe(following)]),
    ],
  });
}

/** A channel's artifact is its own component, never part of a site. */
const CHANNEL_COMPONENTS: ReadonlySet<string> = new Set(
  Object.values(CHANNEL_RECIPES).map((recipe) => recipe.artifactComponent),
);

/** The recipe kind an environment takes: a channel, a Tofu stack, a static site or Applications. */
function environmentRevisions(
  inputs: CatalogRevisionInputs,
  environmentId: string,
  serviceComponents: readonly { name: string }[],
): {
  definition: RecipeDefinition;
  configuration: ReturnType<typeof configurationContent>;
} {
  const fixed = CHANNEL_RECIPES[environmentId] ?? NODE_RECIPES[environmentId];
  if (fixed !== undefined)
    return {
      definition: RecipeDefinitionSchema.parse(fixed),
      configuration: { content: {}, forwardOnly: [] },
    };
  const serviceId = environmentService(environmentId);
  if (serviceId.startsWith("tofu-"))
    return tofuRevisions(inputs, environmentId);
  const components = serviceComponents.filter(
    (component) => !CHANNEL_COMPONENTS.has(component.name),
  );
  if (components.length === 1 && components[0]?.name === `archive:${serviceId}`)
    return {
      definition: staticSiteRevisions(inputs, environmentId),
      configuration: { content: {}, forwardOnly: [] },
    };
  return kubernetesRevisions(inputs, environmentId);
}

function staticSiteRevisions(
  inputs: CatalogRevisionInputs,
  environmentId: string,
): RecipeDefinition {
  const committed = inputs.siteRecipes[environmentId];
  if (committed === undefined)
    throw new Error(`${environmentId} has no reviewed static-site recipe`);
  const definition = RecipeDefinitionSchema.parse(committed);
  const serviceId = environmentService(environmentId);
  if (
    definition.kind !== "static-site" ||
    definition.bucket !== serviceId ||
    definition.archiveComponent !== `archive:${serviceId}`
  )
    throw new Error(
      `${environmentId} must publish bucket ${serviceId} from archive:${serviceId}`,
    );
  return definition;
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
        // The recipe replaces it with the `ci` runner reference.
        runnerImage: inputs.runnerImage,
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
    const generated = environmentRevisions(
      inputs,
      environment.id,
      service.components,
    );
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
