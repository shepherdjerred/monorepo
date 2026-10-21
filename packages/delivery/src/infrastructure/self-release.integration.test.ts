import { expect, test } from "vitest";
import {
  ServiceIndex,
  SERVICE_CATALOG,
} from "@shepherdjerred/ops-model/catalog.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import {
  PipelineDefinitionSchema,
  RegisterEnvironmentSchema,
} from "#shared/contract.ts";

const context = useDeliveryFixture();
test("API self-release preserves exact original selection and ownership through a service restart", async () => {
  const catalog = new ServiceIndex({
    ...SERVICE_CATALOG,
    deliveryDelegations: {
      ...SERVICE_CATALOG.deliveryDelegations,
      delivery: "delivery/prod",
    },
  });
  let delivery = new Delivery(context.cluster.database, 1, catalog);
  const directory = new URL(
    "../../registrations/ordinary/delivery/",
    import.meta.url,
  );
  const pipeline = PipelineDefinitionSchema.parse(
    await Bun.file(new URL("pipeline.json", directory)).json(),
  );
  const environment = RegisterEnvironmentSchema.parse(
    await Bun.file(new URL("environment.json", directory)).json(),
  );
  await delivery.registerPipeline(
    environment.pipelineRevisionId,
    pipeline,
    testOperator,
  );
  await delivery.registerEnvironment(environment, testOperator);
  const build = await delivery.publish(
    {
      requestId: "api/build",
      serviceId: "delivery",
      sourceRevision: "d".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/81",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "api/image/original",
          kind: "image",
          component: "image:delivery",
          uri: "docker.io/shepherdjerred/delivery",
          digest: `sha256:${"d".repeat(64)}`,
          version: "2.0.0-81",
        },
        {
          id: "api/chart/original",
          kind: "chart",
          component: "chart:delivery",
          uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/delivery-2.0.0-81.tgz",
          digest: `sha256:${"e".repeat(64)}`,
          version: "2.0.0-81",
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 81 },
  );
  await delivery.qualify(build.buildId, "verified", testExecutor);
  const version = await context.cluster.database.versionSet.findFirstOrThrow({
    where: { qualifiedBuildId: build.buildId },
  });
  const input = {
    kind: "deploy" as const,
    requestId: "api/release",
    environmentId: environment.id,
    expectedGeneration: 0,
    versionSetRevisionId: version.id,
  };
  const requested = await delivery.createDeployment(input, testOperator);
  await delivery.claim(requested.id, testExecutor);
  await delivery.stage(
    requested.id,
    {
      key: "reconcile",
      status: "running",
      operationId: "api/native/reconcile",
      message: "Native operation checkpoint persisted before API replacement",
      evidence: [],
    },
    testExecutor,
  );
  delivery = new Delivery(context.cluster.database, 1, catalog);
  expect(await delivery.createDeployment(input, testOperator)).toMatchObject({
    id: requested.id,
    status: "running",
  });
  const frozen = await delivery.claim(requested.id, testExecutor);
  expect(frozen.pipeline.definition).toEqual(pipeline);
  expect(frozen.versionSet.components["image:delivery"]).toMatchObject({
    id: "api/image/original",
    buildId: build.buildId,
    sourceRevision: "d".repeat(40),
  });
  expect(
    await context.cluster.database.targetLock.findUnique({
      where: { instance: "application:delivery" },
    }),
  ).toMatchObject({ deploymentId: requested.id });
  const evidence = [
    {
      kind: "reconciliation" as const,
      summary: "Exact selected chart and owned native operation finished",
    },
    {
      kind: "acceptance" as const,
      summary:
        "Replacement API health and running immutable image independently verified",
    },
  ];
  await delivery.stage(
    requested.id,
    {
      key: "reconcile",
      status: "succeeded",
      operationId: "api/native/reconcile",
      message: "Exact native replacement settled",
      evidence,
    },
    testExecutor,
  );
  await delivery.finish(
    requested.id,
    {
      status: "succeeded",
      observedRevisionId: version.id,
      message: "API replacement accepted",
      recoveryRequired: false,
      evidence,
    },
    testExecutor,
  );
  const accepted = await delivery.detail(requested.id);
  expect(accepted.environment.acceptedVersionSetRevisionId).toBe(version.id);
  expect(accepted.environment.activeDeploymentId).toBeNull();
  expect(accepted.versionSet.components["image:delivery"]?.digest).toBe(
    `sha256:${"d".repeat(64)}`,
  );
});
