import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { audit } from "#infrastructure/delivery-records.ts";
import { createTestDatabase } from "#testing/postgres.ts";
import { seedDelivery, testExecutor, testOperator } from "#testing/seed.ts";
import { fixtureEnrichment } from "#testing/enrichment-fixture.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createChangeListener } from "#infrastructure/change-feed/listener.ts";
import {
  ActivityPageSchema,
  CommitListSchema,
  CommitStatusSchema,
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

/** One audited write in its own domain; pagination and the feed read audit rows only. */
function snapshot(requestId: string) {
  return delivery.database.$transaction((tx) =>
    audit(tx, testOperator, {
      action: "snapshot.imported",
      entityId: requestId,
      requestId,
    }),
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
    expect(arcade?.latestExecution).toMatchObject({
      status: "running",
      build: { id: fixture.publication.buildId },
      deployments: [{ environmentId: "arcade/prod", status: "running" }],
    });
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

/** What a release of arcade/prod is realised by, as the hub reports it. */
async function releaseKind() {
  return EnvironmentDetailSchema.parse(
    await body("/api/v1/environments/arcade%2Fprod"),
  ).releaseKind;
}

describe("hub release kind", () => {
  test("a release realises the accepted recipe until a rebind, the declared one before acceptance", async () => {
    const db = delivery.database;
    const original = await db.environment.findUniqueOrThrow({
      where: { id: "arcade/prod" },
    });
    // A catalog change declares an operator-run recipe for the environment.
    await db.pipeline.create({
      data: {
        id: "arcade/operated",
        definition: {
          kind: "operator-run",
          wrapped: {
            kind: "host",
            instance: "host:arcade",
            components: ["image:arcade"],
          },
          stages: ["upgrade"],
        },
      },
    });
    await db.pipeline.create({
      data: {
        id: "arcade/manual",
        definition: { kind: "manual", reason: "v1 deploys" },
      },
    });
    try {
      // A v1 manual pipeline is deployed, as admission reads its stored
      // kind, though the selection view normalises it to operator-run.
      await db.environment.update({
        where: { id: "arcade/prod" },
        data: {
          pipelineRevisionId: "arcade/manual",
          acceptedDeploymentId: null,
        },
      });
      expect(await releaseKind()).toBe("deploy");
      await db.environment.update({
        where: { id: "arcade/prod" },
        data: {
          pipelineRevisionId: "arcade/operated",
          acceptedDeploymentId: null,
        },
      });
      expect(await releaseKind()).toBe("operator-run");
      // Once a deployment under the earlier recipe is accepted, a release
      // freezes that recipe until a rebind, so it is still a deploy.
      const accepted = await db.deployment.findFirstOrThrow({
        where: { environmentId: "arcade/prod" },
      });
      expect(accepted.pipelineRevisionId).toBe(original.pipelineRevisionId);
      await db.environment.update({
        where: { id: "arcade/prod" },
        data: { acceptedDeploymentId: accepted.id },
      });
      expect(await releaseKind()).toBe("deploy");
    } finally {
      await db.environment.update({
        where: { id: "arcade/prod" },
        data: {
          pipelineRevisionId: original.pipelineRevisionId,
          acceptedDeploymentId: original.acceptedDeploymentId,
        },
      });
    }
  });
});

describe("hub commits", () => {
  test("a commit with a running deployment is deploying", async () => {
    const commit = CommitStatusSchema.parse(
      await body(`/api/v1/commits/${"a".repeat(40)}`),
    );
    expect(commit.verdict).toBe("deploying");
    expect(commit.buildId).toBe(fixture.publication.buildId);
    expect(commit.environments).toMatchObject([
      {
        name: "prod",
        verdict: "deploying",
        liveCount: 0,
        total: 1,
        members: [{ serviceId: "arcade", state: "deploying" }],
      },
    ]);
    expect(commit.changed).toHaveLength(1);
    expect(commit.changed[0]).toMatchObject({
      service: { id: "arcade" },
      verdict: "deploying",
      versionSet: { id: fixture.versionSet.id },
      environments: [{ environmentId: "arcade/prod", state: "deploying" }],
    });
  });

  test("a prefix finds the same commit and the list summarizes it", async () => {
    const prefixed = CommitStatusSchema.parse(
      await body("/api/v1/commits/AAAAAAA"),
    );
    expect(prefixed.sha).toBe("a".repeat(40));
    const list = CommitListSchema.parse(await body("/api/v1/commits"));
    expect(list.items[0]).toMatchObject({
      sha: "a".repeat(40),
      verdict: "deploying",
      changedCount: 1,
      liveCount: 0,
      environments: [{ name: "prod", liveCount: 0, total: 1 }],
      blocker: { service: "Arcade", environment: "prod", state: "deploying" },
    });
  });

  test("an unseen commit is unknown and a malformed one is rejected", async () => {
    const unseen = CommitStatusSchema.parse(
      await body(`/api/v1/commits/${"b".repeat(40)}`),
    );
    expect(unseen).toMatchObject({
      verdict: "unknown",
      buildId: null,
      changed: [],
    });
    expect(await status("/api/v1/commits/not-a-sha")).toBe(400);
  });
});
