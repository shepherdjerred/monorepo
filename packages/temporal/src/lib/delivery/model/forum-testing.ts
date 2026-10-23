import { DeploymentDetailSchema } from "@shepherdjerred/delivery/contract";
import { requireModelRecipe } from "./recipe.ts";
import { artifact, detail, digest } from "./testing.ts";

/** Test fixtures for a model storm-forum release, upgrading XenForo 2.3.12 to 2.3.13. */
const forumChart = artifact({
  id: "chart/forum",
  component: "chart:storm-forum",
  kind: "chart",
  uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/storm-forum-1.0.1.tgz",
  version: "1.0.1",
  character: "b",
});

function forumArtifacts(character: string, xenforoVersion: string) {
  return {
    "image:storm-forum": {
      ...artifact({
        id: `image/${character}`,
        component: "image:storm-forum",
        kind: "image",
        uri: "docker.io/shepherdjerred/storm-forum",
        version: "1.0.0",
        character,
      }),
      serviceId: "storm-forum",
    },
    "archive:forum-bundle": {
      ...artifact({
        id: `bundle/${character}`,
        component: "archive:forum-bundle",
        kind: "archive",
        uri: `s3://storm-forum-releases/releases/${character.repeat(64)}.zip`,
        version: xenforoVersion,
        character,
      }),
      serviceId: "storm-forum",
      origin: {
        kind: "licensed-bundle",
        manifestDigest: digest("f"),
        xenforoVersion,
        producerSourceRevision: character.repeat(40),
      },
    },
  };
}

export const forumRecipe = {
  kind: "kubernetes-application",
  application: {
    name: "storm-forum",
    project: "default",
    destination: {
      server: "https://kubernetes.default.svc",
      namespace: "storm-forum",
    },
    source: {
      repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
      chart: "storm-forum",
    },
    lifecycle: "retain",
  },
  chartComponent: "chart:storm-forum",
  artifactParameters: {
    "delivery.image": { component: "image:storm-forum", format: "reference" },
  },
  runner: { service: "ci", component: "image:ci-base" },
  steps: [
    { kind: "apply-safety", instance: "application:storm-forum" },
    { kind: "sync", instance: "application:storm-forum" },
    {
      kind: "forum-bundle",
      instance: "application:storm-forum",
      pointOfNoReturn: true,
      imageComponent: "image:storm-forum",
      bundleComponent: "archive:forum-bundle",
    },
  ],
  oracle: { probes: [], tests: [] },
};

/** A running storm-forum deployment of `definition`, upgrading 2.3.12 to 2.3.13. */
export function forumDeployment(
  definition: unknown,
  stages: { key: string; status: "running" }[] = [],
  chart: ReturnType<typeof artifact> = forumChart,
) {
  const base = detail(definition, chart, stages);
  return DeploymentDetailSchema.parse({
    ...base,
    deployment: {
      ...base.deployment,
      serviceId: "storm-forum",
      environmentId: "storm-forum/prod",
    },
    versionSet: {
      ...base.versionSet,
      serviceId: "storm-forum",
      components: {
        ...base.versionSet.components,
        "chart:storm-forum": chart,
        ...forumArtifacts("c", "2.3.13"),
      },
    },
    previousAcceptedVersionSet: {
      ...base.versionSet,
      id: "version/0",
      serviceId: "storm-forum",
      components: {
        "chart:storm-forum": chart,
        ...forumArtifacts("a", "2.3.12"),
      },
    },
    configuration: {
      id: "config/1",
      content: { "forum.xenforoVersion": "2.3.13" },
    },
    previousAcceptedConfiguration: {
      id: "config/0",
      content: { "forum.xenforoVersion": "2.3.12" },
    },
  });
}

/** The forum deployment and its Application recipe. */
export function forumDetail(
  stages: { key: string; status: "running" }[] = [],
  chart: ReturnType<typeof artifact> = forumChart,
) {
  const current = forumDeployment(forumRecipe, stages, chart);
  const recipe = requireModelRecipe(current);
  if (recipe.kind !== "kubernetes-application")
    throw new Error("The forum recipe is a Kubernetes application");
  return { current, recipe };
}
