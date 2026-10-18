import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import { seedDelivery, testExecutor, testOperator } from "#testing/seed.ts";
import { fixtureEnrichment } from "#testing/enrichment-fixture.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createChangeListener } from "#infrastructure/change-feed/listener.ts";
import {
  ActivityPageSchema,
  DeploymentPageSchema,
  EnvironmentDetailSchema,
  ExecutionPageSchema,
  ExecutionTraceSchema,
  HubOverviewSchema,
  ServicePipelineSchema,
} from "#shared/hub/hub-contract.ts";
import {
  ArgoRuntimeIntegrationSchema,
  CiRunIntegrationSchema,
  SourceChangeIntegrationSchema,
} from "#shared/hub/integration-contract.ts";
import { createApp } from "./app.ts";

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let delivery: Delivery;
let fixture: Awaited<ReturnType<typeof seedDelivery>>;
let feed: ReturnType<typeof createChangeListener>;
let app: ReturnType<typeof createApp>;
const headers = { "tailscale-user-login": testOperator.id };

async function status(path: string) {
  const response = await app.request(path, { headers });
  return response.status;
}

async function body(path: string): Promise<unknown> {
  const response = await app.request(path, { headers });
  expect(response.status).toBe(200);
  return response.json();
}

function snapshot(requestId: string) {
  return delivery.importSnapshot(
    {
      requestId,
      serviceId: "arcade",
      capturedAt: new Date().toISOString(),
      source: "runtime",
      components: {},
      evidence: "Hub fixture",
    },
    testOperator,
  );
}

beforeAll(async () => {
  cluster = await createTestDatabase();
  delivery = new Delivery(cluster.database);
  fixture = await seedDelivery(delivery);
  feed = createChangeListener(cluster.url);
  await feed.start();
  app = createApp({
    delivery,
    changeFeed: feed,
    enrichment: fixtureEnrichment(cluster.database),
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    qualifyBuild: () => Promise.resolve("verified"),
    peerAddress: () => "127.0.0.1",
    config: {
      publicOrigin: "http://delivery.test",
      machineCredentials: [],
      writesEnabled: () => Promise.resolve(true),
      enabledEnvironments: () => Promise.resolve(["arcade/prod"]),
      operatorLogins: () => Promise.resolve([testOperator.id]),
      trustedProxyAddresses: () => Promise.resolve(["127.0.0.1"]),
    },
  });
  const deployment = await delivery.createDeployment(
    {
      requestId: "hub-deploy",
      environmentId: "arcade/prod",
      versionSetRevisionId: fixture.versionSet.id,
      expectedGeneration: fixture.environment.generation,
      kind: "deploy",
    },
    testOperator,
  );
  await delivery.claim(deployment.id, testExecutor);
  await delivery.stage(
    deployment.id,
    {
      key: "reconcile",
      status: "running",
      operationId: "hub-op",
      message: "Syncing",
      evidence: [],
    },
    testExecutor,
  );
}, 120_000);

afterAll(async () => {
  await feed.stop();
  await cluster.close();
});

describe("hub reads", () => {
  test("hub overview lists services, environments and activity", async () => {
    const hub = HubOverviewSchema.parse(await body("/api/v1/hub"));
    const arcade = hub.services.find((entry) => entry.id === "arcade");
    expect(arcade?.environments[0]).toMatchObject({
      id: "arcade/prod",
      status: "running",
    });
    expect(arcade?.latestBuild?.pipelineNumber).toBe(1);
    expect(
      hub.activity.some((entry) => entry.action === "deployment.stage"),
    ).toBe(true);
    expect(hub.tools.length).toBeGreaterThan(0);
  });

  test("service pipeline orders source, build, version and environments", async () => {
    const pipeline = ServicePipelineSchema.parse(
      await body("/api/v1/services/arcade/pipeline"),
    );
    expect(pipeline.stages.map((stage) => stage.kind)).toEqual([
      "source",
      "build",
      "version",
      "environment",
    ]);
    const prod = pipeline.stages[3];
    expect(prod?.status).toBe("running");
    expect(prod?.transition).toMatchObject({
      mode: "automatic",
      enabled: true,
    });
    expect(prod?.actions.map((action) => action.key)).toEqual([
      "deployment",
      "stage:reconcile",
    ]);
    expect(prod?.actions[1]?.startedAt).not.toBeNull();
  });

  test("executions and traces follow one build to its deployment", async () => {
    const executions = ExecutionPageSchema.parse(
      await body("/api/v1/services/arcade/executions"),
    );
    expect(executions.items[0]).toMatchObject({
      status: "running",
      versionSet: { id: fixture.versionSet.id },
    });
    const buildId = fixture.publication.buildId;
    const trace = ExecutionTraceSchema.parse(
      await body(`/api/v1/builds/${encodeURIComponent(buildId)}`),
    );
    expect(trace.artifacts.map((artifact) => artifact.id)).toEqual([
      "arcade-chart",
      "arcade-image",
    ]);
    expect(trace.deployments[0]?.stages[0]?.key).toBe("reconcile");
    const versionTrace = ExecutionTraceSchema.parse(
      await body(
        `/api/v1/versions/${encodeURIComponent(fixture.versionSet.id)}/trace`,
      ),
    );
    expect(versionTrace.build?.id).toBe(buildId);
  });

  test("environment detail and missing records", async () => {
    const detail = EnvironmentDetailSchema.parse(
      await body("/api/v1/environments/arcade%2Fprod"),
    );
    expect(detail.versionSets[0]?.id).toBe(fixture.versionSet.id);
    expect(detail.links[0]?.kind).toBe("argocd");
    expect(await status("/api/v1/environments/missing%2Fenv")).toBe(404);
    expect(await status("/api/v1/builds/missing")).toBe(404);
    expect(await status("/api/v1/services/not-a-service/pipeline")).toBe(404);
  });
});

describe("hub pagination", () => {
  test("lists paginate with stable opaque cursors", async () => {
    for (let index = 0; index < 26; index += 1)
      await snapshot(`hub-snapshot-${String(index)}`);
    const first = ActivityPageSchema.parse(
      await body("/api/v1/activity?action=snapshot."),
    );
    expect(first.items).toHaveLength(25);
    const cursor = first.nextCursor ?? "";
    expect(cursor).not.toBe("");
    const second = ActivityPageSchema.parse(
      await body(`/api/v1/activity?action=snapshot.&cursor=${cursor}`),
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const ids = new Set(
      [...first.items, ...second.items].map((entry) => entry.id),
    );
    expect(ids.size).toBe(26);
    expect(await status("/api/v1/activity?cursor=garbage")).toBe(400);
    const deployments = DeploymentPageSchema.parse(
      await body("/api/v1/deployments?environmentId=arcade%2Fprod"),
    );
    expect(deployments.items).toHaveLength(1);
  });
});

describe("hub integrations", () => {
  test("enrichment reads upstream doubles and caches final answers", async () => {
    const buildId = encodeURIComponent(fixture.publication.buildId);
    const ci = CiRunIntegrationSchema.parse(
      await body(`/api/v1/builds/${buildId}/ci`),
    );
    expect(ci.state).toBe("available");
    if (ci.state === "available")
      expect(ci.data.workflows.map((workflow) => workflow.stage)).toEqual([
        "test",
        "build",
        "test",
        "publish",
      ]);
    const cached = await cluster.database.integrationSnapshot.findUnique({
      where: { source_key: { source: "woodpecker", key: "1/1" } },
    });
    expect(cached?.final).toBe(true);
    const source = SourceChangeIntegrationSchema.parse(
      await body(`/api/v1/builds/${buildId}/source`),
    );
    expect(
      source.state === "available" && source.data.pullRequest?.number,
    ).toBe(4242);
    const runtime = ArgoRuntimeIntegrationSchema.parse(
      await body("/api/v1/environments/arcade%2Fprod/runtime"),
    );
    expect(runtime.state === "available" && runtime.data.healthStatus).toBe(
      "Healthy",
    );
  });
});

describe("hub change feed", () => {
  test("streams committed audit events", async () => {
    const response = await app.request("/api/v1/events", { headers });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("SSE body missing");
    const decoder = new TextDecoder();
    const ready = await reader.read();
    let text = decoder.decode(ready.value);
    expect(text).toContain("event: ready");
    await snapshot("hub-feed-event");
    while (!text.includes("event: change")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    expect(text).toContain('"action":"snapshot.imported"');
    expect(text).toContain('"domain":"snapshot"');
    await reader.cancel();
  });
});
