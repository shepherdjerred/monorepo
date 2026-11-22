import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { CATALOG_CORE } from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import { PrismaClient } from "#generated/prisma/client.ts";
import { createTestDatabase } from "#testing/postgres.ts";
import { seedDelivery, testExecutor, testOperator } from "#testing/seed.ts";
import { registerTestService } from "#testing/services.ts";
import { createHubTestApp } from "#testing/http-app.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { index } from "#infrastructure/delivery-data.ts";
import { createChangeListener } from "#infrastructure/change-feed/listener.ts";
import { hubGrid } from "#infrastructure/hub/grid.ts";
import { HubGridSchema, HubOverviewSchema } from "#shared/hub/hub-contract.ts";

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let delivery: Delivery;
let fixture: Awaited<ReturnType<typeof seedDelivery>>;
let feed: ReturnType<typeof createChangeListener>;
let app: ReturnType<typeof createHubTestApp>;
/** A client of its own, so a count is one read's statements and nothing else's. */
let counting: PrismaClient<"query">;
let statements = 0;
const headers = { "tailscale-user-login": testOperator.id };

async function grid() {
  const response = await app.request("/api/v1/hub/grid", { headers });
  expect(response.status).toBe(200);
  return HubGridSchema.parse(await response.json());
}

function service(
  overview: Awaited<ReturnType<typeof grid>>,
  serviceId: string,
) {
  return overview.groups
    .flatMap((group) => group.services)
    .find((entry) => entry.id === serviceId);
}

/**
 * Registers a catalog service the way a reconcile leaves it and gives it one
 * environment bound to the seeded recipe and configuration.
 */
async function registerWithEnvironment(serviceId: string, name: string) {
  const db = cluster.database;
  const seeded = await db.environment.findUniqueOrThrow({
    where: { id: fixture.environment.id },
  });
  await registerTestService(db, serviceId);
  await db.environment.create({
    data: {
      id: `${serviceId}/${name}`,
      serviceId,
      name,
      pipelineRevisionId: seeded.pipelineRevisionId,
      declaredConfigurationId: seeded.declaredConfigurationId,
    },
  });
  return seeded;
}

beforeAll(async () => {
  cluster = await createTestDatabase();
  delivery = new Delivery(cluster.database);
  fixture = await seedDelivery(delivery);
  counting = new PrismaClient({
    adapter: new PrismaPg({ connectionString: cluster.url }),
    log: [{ emit: "event", level: "query" }],
  });
  counting.$on("query", () => {
    statements += 1;
  });
  feed = createChangeListener(cluster.url);
  await feed.start();
  app = createHubTestApp(delivery, feed);
}, 120_000);

afterAll(async () => {
  await counting.$disconnect();
  await feed.stop();
  await cluster.close();
});

describe("hub grid", () => {
  test("lists every active service under its catalog group, including a v2-only one", async () => {
    await registerWithEnvironment("nfd", "prod");
    await cluster.database.service.update({
      where: { id: "birmel" },
      data: { lifecycle: "retired" },
    });
    const overview = await grid();
    const listed = overview.groups.flatMap((group) =>
      group.services.map((entry) => entry.id),
    );
    expect(listed.toSorted()).toEqual(
      [
        ...index.services
          .map((entry) => entry.id)
          .filter((id) => id !== "birmel"),
        "nfd",
      ].toSorted(),
    );
    // Groups keep the catalog's order.
    const order = CATALOG_CORE.groups.map((group) => group.id);
    expect(overview.groups.map((group) => group.id)).toEqual(
      order.filter((id) => overview.groups.some((group) => group.id === id)),
    );
    expect(
      overview.groups
        .find((group) => group.id === "platform-services")
        ?.services.map((entry) => entry.id),
    ).toEqual(["nfd", "platform-services"]);
    expect(service(overview, "nfd")).toEqual({
      id: "nfd",
      title: "Node feature discovery",
      environments: [
        {
          id: "nfd/prod",
          name: "prod",
          status: "not_started",
          request: null,
          alarmedAt: null,
          recoveryRequired: false,
          acceptedRevision: null,
          acceptedAt: null,
          approvalRequired: false,
          activeDeploymentId: null,
          promotesFrom: null,
        },
      ],
    });
    // A registered service with no environment is listed with none.
    expect(service(overview, "tracker")?.environments).toEqual([]);
    expect(service(overview, "arcade")?.environments).toMatchObject([
      { id: "arcade/prod", status: "not_started", acceptedRevision: null },
    ]);
    expect(overview.attention).toEqual([]);
  });

  test("follows a deployment from request to acceptance, then a failure", async () => {
    const deployment = await delivery.createDeployment(
      {
        requestId: "grid-deploy",
        environmentId: "arcade/prod",
        versionSetRevisionId: fixture.versionSet.id,
        expectedGeneration: fixture.environment.generation,
        kind: "deploy",
      },
      testOperator,
    );
    expect(service(await grid(), "arcade")?.environments[0]).toMatchObject({
      status: "queued",
      acceptedRevision: null,
      acceptedAt: null,
    });
    await delivery.claim(deployment.id, testExecutor);
    expect(service(await grid(), "arcade")?.environments[0]).toMatchObject({
      status: "running",
      activeDeploymentId: deployment.id,
    });
    await delivery.finish(
      deployment.id,
      {
        status: "succeeded",
        message: "Accepted",
        observedRevisionId: fixture.versionSet.id,
        recoveryRequired: false,
        evidence: [
          { kind: "reconciliation", summary: "exact operation completed" },
          { kind: "acceptance", summary: "acceptance checks passed" },
        ],
      },
      testExecutor,
    );
    const finished = await cluster.database.deployment.findUniqueOrThrow({
      where: { id: deployment.id },
    });
    expect(service(await grid(), "arcade")?.environments[0]).toEqual({
      id: "arcade/prod",
      name: "prod",
      status: "succeeded",
      request: null,
      alarmedAt: null,
      recoveryRequired: false,
      acceptedRevision: fixture.versionSet.revision,
      acceptedAt: finished.finishedAt?.toISOString(),
      approvalRequired: false,
      activeDeploymentId: null,
      promotesFrom: null,
    });

    const environment = await cluster.database.environment.findUniqueOrThrow({
      where: { id: "arcade/prod" },
    });
    const next = await delivery.createDeployment(
      {
        requestId: "grid-deploy-2",
        environmentId: "arcade/prod",
        versionSetRevisionId: fixture.versionSet.id,
        expectedGeneration: environment.generation,
        kind: "deploy",
      },
      testOperator,
    );
    await delivery.claim(next.id, testExecutor);
    await delivery.finish(
      next.id,
      {
        status: "failed",
        message: "Sync timed out",
        recoveryRequired: true,
        evidence: [],
      },
      testExecutor,
    );
    const overview = await grid();
    // The newest deployment failed; the accepted revision is still the first one's.
    expect(service(overview, "arcade")?.environments[0]).toMatchObject({
      status: "failed",
      recoveryRequired: true,
      request: { deploymentId: next.id, revision: fixture.versionSet.revision },
      acceptedRevision: fixture.versionSet.revision,
      acceptedAt: finished.finishedAt?.toISOString(),
      activeDeploymentId: next.id,
    });
    expect(overview.attention).toMatchObject([
      {
        kind: "recovery",
        title: "Arcade prod requires recovery",
        detail: `The deploy of r${String(fixture.versionSet.revision)} failed and left the environment locked.`,
        target: { kind: "deployment", id: next.id },
        serviceId: "arcade",
      },
    ]);
  });
});

/** A failed, locking deployment of an environment, with the set revision it deployed. */
async function failDeployment(serviceId: string, environmentId: string) {
  const seeded = await cluster.database.environment.findUniqueOrThrow({
    where: { id: fixture.environment.id },
  });
  await cluster.database.versionSet.create({
    data: {
      id: `${environmentId}/set`,
      serviceId,
      revision: 1,
      lineage: "attention",
    },
  });
  await cluster.database.deployment.create({
    data: {
      id: `${environmentId}/failed`,
      requestId: `${environmentId}/failed-request`,
      environmentId,
      serviceId,
      versionSetRevisionId: `${environmentId}/set`,
      pipelineRevisionId: seeded.pipelineRevisionId,
      configurationId: seeded.declaredConfigurationId,
      catalogRevision: "test-catalog",
      expectedGeneration: 0,
      kind: "deploy",
      status: "failed",
      recoveryRequired: true,
      requestedBy: testOperator.id,
      finishedAt: new Date(),
    },
  });
}

/** Both pages' attention: the Overview's grid and the Pipelines list's hub read. */
async function pipelinesRead() {
  const response = await app.request("/api/v1/hub", { headers });
  expect(response.status).toBe(200);
  return HubOverviewSchema.parse(await response.json());
}

async function attentionOfBothPages() {
  const pipelines = await pipelinesRead();
  const overview = await grid();
  expect(pipelines.attention).toEqual(overview.attention);
  return overview.attention.map((item) => item.title);
}

describe("hub attention across the pages", () => {
  test("Overview and Pipelines list the same items, and none for a retired service or environment", async () => {
    await registerWithEnvironment("tracker", "prod");
    await failDeployment("tracker", "tracker/prod");
    await failDeployment("flipt", "flipt/prod");
    const before = await attentionOfBothPages();
    expect(before).toEqual(
      expect.arrayContaining([
        "Tracker prod requires recovery",
        "Flipt prod requires recovery",
      ]),
    );
    // A retired environment of a live service is on neither page, so neither
    // names its failure.
    await cluster.database.environment.update({
      where: { id: "flipt/prod" },
      data: { lifecycle: "retired" },
    });
    const environmentGone = await attentionOfBothPages();
    expect(environmentGone).toContain("Tracker prod requires recovery");
    expect(environmentGone).not.toContain("Flipt prod requires recovery");
    // So is a retired service's, however its deployments ended.
    await cluster.database.service.update({
      where: { id: "tracker" },
      data: { lifecycle: "retired" },
    });
    const serviceGone = await attentionOfBothPages();
    expect(serviceGone).not.toContain("Tracker prod requires recovery");
    // The Pipelines list names no service the Overview does not.
    const hub = await pipelinesRead();
    const overview = await grid();
    const listed = new Set(
      overview.groups.flatMap((group) =>
        group.services.map((entry) => entry.id),
      ),
    );
    expect(hub.services.every((entry) => listed.has(entry.id))).toBe(true);
    expect(hub.services.map((entry) => entry.id)).not.toContain("tracker");
  });
});

/** One grid read through the counting client: its statements and how many services it lists. */
async function countedRead() {
  statements = 0;
  const overview = await hubGrid(counting);
  return {
    statements,
    services: overview.groups.flatMap((group) => group.services).length,
  };
}

describe("hub grid batching", () => {
  test("issues the same number of statements however many services it lists", async () => {
    const before = await countedRead();
    const seeded = await cluster.database.environment.findUniqueOrThrow({
      where: { id: "arcade/prod" },
    });
    const added = CATALOG_CORE.services
      .map((entry) => entry.id)
      .filter((id) => id.startsWith("tofu-"));
    expect(added.length).toBeGreaterThan(10);
    for (const serviceId of added) {
      await registerWithEnvironment(serviceId, "prod");
      // Each new service has an accepted set revision and the deployment
      // that accepted it, so the second round of reads grows with it too.
      await cluster.database.versionSet.create({
        data: {
          id: `${serviceId}/set`,
          serviceId,
          revision: 1,
          lineage: "grid",
        },
      });
      await cluster.database.deployment.create({
        data: {
          id: `${serviceId}/deployment`,
          requestId: `${serviceId}/request`,
          environmentId: `${serviceId}/prod`,
          serviceId,
          versionSetRevisionId: `${serviceId}/set`,
          pipelineRevisionId: seeded.pipelineRevisionId,
          configurationId: seeded.declaredConfigurationId,
          catalogRevision: "test-catalog",
          expectedGeneration: 0,
          kind: "deploy",
          status: "succeeded",
          requestedBy: testOperator.id,
          finishedAt: new Date(),
        },
      });
      await cluster.database.environment.update({
        where: { id: `${serviceId}/prod` },
        data: {
          acceptedVersionSetRevisionId: `${serviceId}/set`,
          acceptedDeploymentId: `${serviceId}/deployment`,
        },
      });
    }
    const after = await countedRead();
    expect(after.services).toBe(before.services + added.length);
    expect(after.statements).toBe(before.statements);
    expect(after.statements).toBe(11);
  });
});
