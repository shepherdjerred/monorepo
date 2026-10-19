import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import type { Database } from "#infrastructure/database.ts";
import { testExecutor, testOperator, testPublisher } from "./seed.ts";

/** Real persisted CI qualification and registration, with a small explicit source catalog. */
export async function platformFixture(
  database: Database,
  delegated = true,
  withRootChild = false,
) {
  const catalog = new ServiceIndex({
    platformDeliveryDelegated: delegated,
    services: [
      {
        id: "gitops",
        title: "Disposable platform source catalog",
        kind: "platform",
        namespaces: ["argocd"],
        argoApps: withRootChild ? ["apps", "argocd"] : ["apps"],
        charts: [],
        images: [],
        bootstrapImages: [],
        aliases: [],
        bugsinkProjects: [],
        analyticsSites: [],
        grafanaDashboards: [],
        deploy: [],
      },
    ],
  });
  const delivery = new Delivery(database, 1, catalog);
  const rootArtifacts = {
    apps: "platform/chart/apps/1",
    ...(withRootChild ? { argocd: "platform/chart/argocd/1" } : {}),
  };
  const sourceRevision = "9".repeat(40);
  const published = await delivery.publish(
    {
      requestId: "platform/source/1",
      serviceId: "gitops",
      sourceRevision,
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/900",
      verifiedAt: new Date().toISOString(),
      platformChanges: {
        root: true,
        rootArtifacts,
        tofuStacks: [
          "seaweedfs",
          "tailscale",
          "arr",
          "github",
          "posthog",
          "cloudflare",
          "openai",
          "anthropic",
          "discord",
          "cloudflare-tokens",
        ],
        sites: [],
      },
      artifacts: Object.entries(rootArtifacts).map(([name, artifactId]) => ({
        id: artifactId,
        kind: "chart",
        component: `chart:${name}`,
        uri: `https://chartmuseum.tailnet-1a49.ts.net/charts/${name}-2.0.0-900.tgz`,
        version: "2.0.0-900",
        digest: `sha256:${"a".repeat(64)}`,
      })),
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 900 },
  );
  await delivery.qualify(published.buildId, "verified", testExecutor);
  const runnerImage = `docker.io/shepherdjerred/ci-base@sha256:${"f".repeat(64)}`;
  await delivery.registerPipeline(
    "platform/root/1",
    { kind: "root-release", runnerImage },
    testOperator,
  );
  const rootEnvironment = await delivery.registerEnvironment(
    {
      id: "gitops/root",
      serviceId: "gitops",
      name: "Root",
      application: "apps",
      pipelineRevisionId: "platform/root/1",
      configurationRevision: "platform/1",
      configuration: {},
      automatic: false,
    },
    testOperator,
  );
  const stacks = TofuStackSchema.options.filter((stack) =>
    [
      "seaweedfs",
      "tailscale",
      "arr",
      "github",
      "posthog",
      "cloudflare",
      "openai",
      "anthropic",
      "discord",
      "cloudflare-tokens",
    ].includes(stack),
  );
  for (const stack of stacks) {
    await delivery.registerPipeline(
      `platform/tofu:${stack}/1`,
      { kind: "tofu", stack, runnerImage },
      testOperator,
    );
    await delivery.registerEnvironment(
      {
        id: `gitops/tofu:${stack}`,
        serviceId: "gitops",
        name: stack,
        pipelineRevisionId: `platform/tofu:${stack}/1`,
        configurationRevision: "platform/1",
        configuration: {},
        automatic: false,
      },
      testOperator,
    );
  }
  return {
    delivery,
    catalog,
    rootEnvironment,
    rootArtifacts,
    sourceBuildId: published.buildId,
    sourceRevision,
    runnerImage,
    environmentIds: [
      rootEnvironment.id,
      ...stacks.map((stack) => `gitops/tofu:${stack}`),
    ],
  };
}
