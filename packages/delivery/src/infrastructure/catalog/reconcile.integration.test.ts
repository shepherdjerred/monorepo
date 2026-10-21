import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { serviceLineage } from "#shared/model/catalog-contract.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createTestDatabase } from "#testing/postgres.ts";
import { resetDeliveryTables } from "#testing/delivery-http-fixture.ts";
import { catalogDocument } from "#testing/catalog-fixture.ts";
import { testOperator, testPublisher } from "#testing/seed.ts";

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let delivery: Delivery;
beforeAll(async () => {
  cluster = await createTestDatabase();
  delivery = new Delivery(cluster.database);
}, 60_000);
afterAll(async () => {
  await cluster.close();
});
beforeEach(async () => {
  await resetDeliveryTables(cluster.database);
});

type Document = Awaited<ReturnType<typeof catalogDocument>>;

/** A v1 static-site environment with one accepted deployment, as the backfill leaves it. */
async function seedV1Site() {
  const db = cluster.database;
  await db.pipeline.create({
    data: {
      id: "static-sites/sjer-red/1",
      definition: {
        kind: "static-site",
        bucket: "sjer-red",
        archiveComponent: "site:sjer-red",
        immutablePrefixes: [],
        extraExcludes: [],
        entrypoints: ["index.html"],
        verification: { url: "https://sjer.red", expectedStatus: 200 },
      },
    },
  });
  await db.configuration.create({
    data: { id: "static-sites/config/1", content: {} },
  });
  await db.environment.create({
    data: {
      id: "static-sites/sjer-red",
      serviceId: "static-sites",
      name: "sjer-red",
      pipelineRevisionId: "static-sites/sjer-red/1",
      declaredConfigurationId: "static-sites/config/1",
      generation: 3,
    },
  });
  await db.versionSet.create({
    data: {
      id: "static-set",
      serviceId: "static-sites",
      revision: 1,
      lineage: "0".repeat(64),
    },
  });
  await db.deployment.create({
    data: {
      id: "static-accepted",
      requestId: "static/accepted",
      environmentId: "static-sites/sjer-red",
      serviceId: "static-sites",
      versionSetRevisionId: "static-set",
      pipelineRevisionId: "static-sites/sjer-red/1",
      configurationId: "static-sites/config/1",
      catalogRevision: "v1-backfill",
      expectedGeneration: 2,
      kind: "deploy",
      status: "succeeded",
      requestedBy: testOperator.id,
      finishedAt: new Date(),
      monitorState: "unmonitored",
    },
  });
  await db.environment.update({
    where: { id: "static-sites/sjer-red" },
    data: {
      acceptedDeploymentId: "static-accepted",
      acceptedVersionSetRevisionId: "static-set",
    },
  });
}

describe("catalog reconcile", () => {
  test("registers services, revisions, environments and edges, then changes nothing on a repeat", async () => {
    const document = await catalogDocument();
    const result = await delivery.reconcileCatalog({ document }, testOperator);
    expect(result.catalogRevision).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.recipes.created.toSorted()).toEqual([
      "arcade-beta/1",
      "arcade/3",
      "delivery/3",
      "sjer-red/1",
    ]);
    expect(result.environments.created.toSorted()).toEqual([
      "arcade/beta",
      "arcade/prod",
      "delivery/prod",
      "sjer-red/prod",
    ]);
    expect(result.services.created).toEqual(["sjer-red"]);
    expect(result.edges).toBe(2);
    const prod = await cluster.database.environment.findUniqueOrThrow({
      where: { id: "arcade/prod" },
    });
    expect(prod).toMatchObject({
      serviceId: "arcade",
      name: "prod",
      application: "arcade",
      pipelineRevisionId: "arcade/3",
      declaredConfigurationId: "arcade/1",
      role: "durable",
      approvalPolicy: "required",
      promotionSourceEnvironmentId: "arcade/beta",
      acceptedDeploymentId: null,
      generation: 0,
    });
    const arcade = await cluster.database.service.findUniqueOrThrow({
      where: { id: "arcade" },
    });
    expect(arcade.lineage).toBe(
      await serviceLineage(["image:arcade", "chart:arcade"]),
    );
    expect(arcade.catalogRevision).toBe(result.catalogRevision);
    // Services the catalog does not declare are retired, never deleted.
    const omitted = await cluster.database.service.findUniqueOrThrow({
      where: { id: "static-sites" },
    });
    expect(omitted.lifecycle).toBe("retired");
    const repeat = await delivery.reconcileCatalog({ document }, testOperator);
    expect(repeat.recipes.created).toEqual([]);
    expect(repeat.environments).toEqual({
      created: [],
      renamed: [],
      rebound: [],
      retired: [],
    });
    expect(repeat.services.lineageChanged).toEqual([]);
    expect(await cluster.database.deployment.count()).toBe(0);
  });

  test("refuses to rewrite a recipe or configuration revision and persists nothing", async () => {
    const document = await catalogDocument();
    await delivery.reconcileCatalog({ document }, testOperator);
    const changed = {
      ...document,
      configurations: [
        ...document.configurations.filter((entry) => entry.id !== "arcade/1"),
        { id: "arcade/1", content: { replicas: "3" }, forwardOnly: [] },
      ],
    };
    await expect(
      delivery.reconcileCatalog({ document: changed }, testOperator),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const recipe: Document = {
      ...document,
      recipes: document.recipes.map((entry) =>
        entry.id === "sjer-red/1"
          ? {
              ...entry,
              definition: { ...entry.definition, entrypoints: ["404.html"] },
            }
          : entry,
      ),
    };
    await expect(
      delivery.reconcileCatalog({ document: recipe }, testOperator),
    ).rejects.toThrow(
      /Recipe revision sjer-red\/1 already holds a different definition/u,
    );
    const kept = await cluster.database.configuration.findUniqueOrThrow({
      where: { id: "arcade/1" },
    });
    expect(kept.content).toEqual({});
  });

  test("a component-list change starts a lineage, moves generations and waits for ownership", async () => {
    const document = await catalogDocument();
    await delivery.reconcileCatalog({ document }, testOperator);
    const widened: Document = {
      ...document,
      services: document.services.map((service) =>
        service.id === "arcade"
          ? {
              ...service,
              components: [
                ...service.components,
                { name: "archive:arcade-assets", producer: "first-party" },
              ],
            }
          : service,
      ),
    };
    await cluster.database.versionSet.create({
      data: {
        id: "arcade-set",
        serviceId: "arcade",
        revision: 1,
        lineage: "0".repeat(64),
      },
    });
    await cluster.database.deployment.create({
      data: {
        id: "arcade-owned",
        requestId: "arcade/owned",
        environmentId: "arcade/beta",
        serviceId: "arcade",
        versionSetRevisionId: "arcade-set",
        pipelineRevisionId: "arcade-beta/1",
        configurationId: "arcade/1",
        catalogRevision: "test",
        expectedGeneration: 0,
        kind: "deploy",
        status: "running",
        requestedBy: testPublisher.id,
      },
    });
    await expect(
      delivery.reconcileCatalog({ document: widened }, testOperator),
    ).rejects.toThrow(
      /component-list change is refused while a deployment of arcade is owned/u,
    );
    await cluster.database.deployment.update({
      where: { id: "arcade-owned" },
      data: { status: "canceled", finishedAt: new Date() },
    });
    const result = await delivery.reconcileCatalog(
      { document: widened },
      testOperator,
    );
    expect(result.services.lineageChanged).toEqual(["arcade"]);
    const environments = await cluster.database.environment.findMany({
      where: { serviceId: "arcade" },
      orderBy: { id: "asc" },
    });
    expect(environments.map((row) => [row.id, row.generation])).toEqual([
      ["arcade/beta", 1],
      ["arcade/prod", 1],
    ]);
  });
});

describe("catalog reconcile of v1 environments", () => {
  test("a renamed environment keeps its accepted selection and history; omitted ones are refused", async () => {
    await seedV1Site();
    const document = await catalogDocument();
    await expect(
      delivery.reconcileCatalog({ document }, testOperator),
    ).rejects.toThrow(/omits active environments static-sites\/sjer-red/u);
    const result = await delivery.reconcileCatalog(
      { document, renames: { "static-sites/sjer-red": "sjer-red/prod" } },
      testOperator,
    );
    expect(result.environments.renamed).toEqual([
      { from: "static-sites/sjer-red", to: "sjer-red/prod" },
    ]);
    expect(result.environments.rebound).toEqual(["sjer-red/prod"]);
    const site = await cluster.database.environment.findUniqueOrThrow({
      where: { id: "sjer-red/prod" },
    });
    expect(site).toMatchObject({
      serviceId: "sjer-red",
      name: "prod",
      acceptedDeploymentId: "static-accepted",
      acceptedVersionSetRevisionId: "static-set",
      pipelineRevisionId: "sjer-red/1",
      declaredConfigurationId: "sjer-red/1",
      generation: 3,
    });
    const history = await cluster.database.deployment.findUniqueOrThrow({
      where: { id: "static-accepted" },
    });
    expect(history.environmentId).toBe("sjer-red/prod");
    expect(history.serviceId).toBe("static-sites");
    expect(
      await cluster.database.environment.findUnique({
        where: { id: "static-sites/sjer-red" },
      }),
    ).toBeNull();
  });

  test("retired v1 environments move their generation; lifecycles never move back", async () => {
    await seedV1Site();
    const document = await catalogDocument();
    const result = await delivery.reconcileCatalog(
      { document, retired: ["static-sites/sjer-red"] },
      testOperator,
    );
    expect(result.environments.retired).toEqual(["static-sites/sjer-red"]);
    expect(
      await cluster.database.environment.findUniqueOrThrow({
        where: { id: "static-sites/sjer-red" },
      }),
    ).toMatchObject({ lifecycle: "retired", generation: 4 });
    const retiredService: Document = {
      ...document,
      services: document.services.map((service) =>
        service.id === "sjer-red"
          ? { ...service, lifecycle: "retired" as const }
          : service,
      ),
    };
    await delivery.reconcileCatalog(
      { document: retiredService, retired: ["static-sites/sjer-red"] },
      testOperator,
    );
    await expect(
      delivery.reconcileCatalog(
        { document, retired: ["static-sites/sjer-red"] },
        testOperator,
      ),
    ).rejects.toThrow(
      /Service sjer-red cannot move from retired back to active/u,
    );
  });

  test("a malformed document is refused before anything is written", async () => {
    await expect(
      delivery.reconcileCatalog({ document: { services: [] } }, testOperator),
    ).rejects.toMatchObject({ code: "INVALID" });
    expect(await cluster.database.pipeline.count()).toBe(0);
  });
});
