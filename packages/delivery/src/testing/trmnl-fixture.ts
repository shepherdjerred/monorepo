import {
  ServiceIndex,
  SERVICE_CATALOG,
} from "@shepherdjerred/ops-model/catalog.ts";
import type { Database } from "#infrastructure/database.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import type { PipelineDefinition } from "#shared/contract.ts";
import { testExecutor, testOperator, testPublisher } from "./seed.ts";

/** The TRMNL dashboard release and its fixed plugin archive dependency. */
export const TRMNL_PIPELINE: PipelineDefinition = {
  kind: "argocd",
  application: "trmnl-dashboard",
  namespace: "trmnl-dashboard",
  chartName: "trmnl-dashboard",
  chartRepository: "https://chartmuseum.tailnet-1a49.ts.net",
  chartComponent: "chart:trmnl-dashboard",
  parameters: {},
  artifactParameters: { "delivery.image": "image:trmnl-dashboard" },
  trmnlPlugins: { archiveComponent: "archive:trmnl-plugins" },
};

/** A Delivery whose reviewed infrastructure delegates trmnl-dashboard/prod. */
export function trmnlDelivery(database: Database) {
  return new Delivery(
    database,
    1,
    new ServiceIndex({
      ...SERVICE_CATALOG,
      deliveryDelegations: {
        ...SERVICE_CATALOG.deliveryDelegations,
        "trmnl-dashboard": "trmnl-dashboard/prod",
      },
    }),
  );
}

/** Publishes, qualifies and requests one TRMNL release on trmnl-dashboard/prod. */
export async function requestTrmnlRelease(delivery: Delivery) {
  const build = await delivery.publish(
    {
      requestId: "trmnl/build",
      serviceId: "trmnl-dashboard",
      sourceRevision: "e".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/90",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "trmnl/image",
          component: "image:trmnl-dashboard",
          kind: "image",
          uri: "docker.io/shepherdjerred/trmnl-dashboard",
          digest: `sha256:${"a".repeat(64)}`,
          version: "2.0.0-90",
        },
        {
          id: "trmnl/chart",
          component: "chart:trmnl-dashboard",
          kind: "chart",
          uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/trmnl-dashboard-2.0.0-90.tgz",
          digest: `sha256:${"b".repeat(64)}`,
          version: "2.0.0-90",
        },
        {
          id: "trmnl/plugins",
          component: "archive:trmnl-plugins",
          kind: "archive",
          uri: `s3://delivery-artifacts/trmnl-plugins/${"c".repeat(64)}.json`,
          digest: `sha256:${"c".repeat(64)}`,
          version: "2.0.0-90",
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 90 },
  );
  await delivery.qualify(build.buildId, "verified", testExecutor);
  const [selected] = await delivery.versions("trmnl-dashboard");
  if (selected === undefined)
    throw new Error("Expected qualified TRMNL version");
  await delivery.registerPipeline(
    "trmnl/pipeline",
    TRMNL_PIPELINE,
    testOperator,
  );
  await delivery.registerEnvironment(
    {
      id: "trmnl-dashboard/prod",
      serviceId: "trmnl-dashboard",
      name: "prod",
      application: "trmnl-dashboard",
      pipelineRevisionId: "trmnl/pipeline",
      configurationRevision: "trmnl/config",
      configuration: {},
      automatic: true,
    },
    testOperator,
  );
  const source = await delivery.createDeployment(
    {
      requestId: "trmnl/release",
      environmentId: "trmnl-dashboard/prod",
      versionSetRevisionId: selected.id,
      expectedGeneration: 0,
      kind: "deploy",
    },
    testOperator,
  );
  return { source, selected };
}
