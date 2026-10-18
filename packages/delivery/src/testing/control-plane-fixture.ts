import {
  ServiceIndex,
  SERVICE_CATALOG,
} from "@shepherdjerred/ops-model/catalog.ts";
import type { Database } from "#infrastructure/database.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { testExecutor, testOperator, testPublisher } from "./seed.ts";
import type {
  RequestControlPlaneUpgrade,
  Deployment,
} from "#shared/contract.ts";
import { testNativeReceipt } from "./platform-execution.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";

/** Independently qualified original image and chart owners; no accepted baseline is fabricated. */
export async function controlPlaneFixture(
  database: Database,
  delegated = true,
  beforeRegistration?: (input: {
    delivery: Delivery;
    previous: { artifactId: string; buildId: string };
    priorChart: { artifactId: string; buildId: string };
  }) => Promise<void>,
) {
  const catalog = new ServiceIndex({
    ...SERVICE_CATALOG,
    deliveryDelegations: delegated
      ? {
          ...SERVICE_CATALOG.deliveryDelegations,
          "delivery-control-plane": "delivery-control-plane/prod",
        }
      : {},
  });
  const delivery = new Delivery(database, 1, catalog);
  async function publish(number: number, kind: "image" | "chart") {
    const image = kind === "image";
    const id = `controller/${kind}/${String(number)}`;
    const name = image ? "temporal-worker" : "delivery-control-plane";
    const build = await delivery.publish(
      {
        requestId: `controller/publish/${String(number)}`,
        serviceId: image ? "temporal" : "delivery-control-plane",
        sourceRevision: number.toString(16).padEnd(40, "0"),
        ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
        verifiedAt: new Date().toISOString(),
        artifacts: [
          {
            id,
            kind,
            component: `${kind}:${name}`,
            uri: image
              ? "docker.io/shepherdjerred/temporal-worker"
              : `https://chartmuseum.tailnet-1a49.ts.net/charts/delivery-control-plane-2.0.0-${String(number)}.tgz`,
            version: `2.0.0-${String(number)}`,
            digest: `sha256:${number.toString(16).padStart(64, "0")}`,
          },
        ],
      },
      testPublisher,
      { repositoryId: 1, pipelineNumber: number },
    );
    await delivery.qualify(build.buildId, "verified", testExecutor);
    return { artifactId: id, buildId: build.buildId };
  }
  const previous = await publish(101, "image");
  const next = await publish(102, "image");
  const priorChart = await publish(103, "chart");
  const chart = await publish(104, "chart");
  const runnerImage = `docker.io/shepherdjerred/ci-base@sha256:${"f".repeat(64)}`;
  await beforeRegistration?.({ delivery, previous, priorChart });
  await delivery.registerPipeline(
    "controller/pipeline/1",
    {
      kind: "control-plane",
      application: "delivery-control-plane",
      namespace: "temporal",
      chartRepository: "https://chartmuseum.tailnet-1a49.ts.net",
      chartName: "delivery-control-plane",
      chartComponent: "chart:delivery-control-plane",
      runnerImage,
    },
    testOperator,
  );
  const environment = await delivery.registerEnvironment(
    {
      id: "delivery-control-plane/prod",
      serviceId: "delivery-control-plane",
      name: "Controller",
      application: "delivery-control-plane",
      pipelineRevisionId: "controller/pipeline/1",
      configurationRevision: "controller/1",
      configuration: {},
      automatic: false,
    },
    testOperator,
  );
  const input: RequestControlPlaneUpgrade = {
    requestId: "controller/upgrade/1",
    expectedGeneration: environment.generation,
    imageArtifactId: next.artifactId,
    chartArtifactId: chart.artifactId,
    previousImageArtifactId: previous.artifactId,
    priorChartArtifactId: priorChart.artifactId,
    reason:
      "Review independently qualified controller image and isolated native template",
  };
  return {
    delivery,
    catalog,
    environment,
    input,
    previous,
    next,
    priorChart,
    chart,
    publish,
    runnerImage,
  };
}

export async function acceptTestController(
  delivery: Delivery,
  deployment: Deployment,
) {
  const snapshot = deployment.controlPlaneSnapshot;
  if (snapshot === null)
    throw new Error("Expected independent controller snapshot");
  const native = testNativeReceipt(deployment.id);
  const acceptance = {
    kind: "acceptance" as const,
    operationId: native.uid,
    summary: JSON.stringify({
      adapter: "control-plane",
      previousArtifactId: snapshot.previousArtifact.id,
      nextArtifactId: snapshot.nextArtifact.id,
      chartArtifactId: snapshot.chartArtifact.id,
      nativeJobUID: native.uid,
      argoOperationId: crypto.randomUUID(),
      argoRequestId: deliveryOperationId(`${deployment.id}:control-plane`),
    }),
  };
  const evidence = [
    {
      kind: "reconciliation" as const,
      summary: "Exact owned controller source and operation inspected",
    },
    acceptance,
  ];
  await delivery.stage(
    deployment.id,
    {
      key: "control-plane",
      status: "running",
      operationId: native.name,
      message: JSON.stringify(native),
      evidence: [],
    },
    testExecutor,
  );
  await delivery.stage(
    deployment.id,
    {
      key: "control-plane",
      status: "succeeded",
      operationId: native.name,
      message: JSON.stringify(native),
      evidence,
    },
    testExecutor,
  );
  return delivery.finish(
    deployment.id,
    {
      status: "succeeded",
      message: "Independent controller accepted",
      recoveryRequired: false,
      evidence,
    },
    testExecutor,
  );
}
