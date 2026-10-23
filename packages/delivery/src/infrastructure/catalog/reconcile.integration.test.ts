import { describe, expect, test } from "vitest";
import { serviceLineage } from "#shared/model/catalog-contract.ts";
import { catalogDocument } from "#testing/catalog-fixture.ts";
import { arcadePipeline } from "#testing/model-fixture.ts";
import { useCatalogCluster } from "#testing/catalog-cluster.ts";
import { testOperator, testPublisher } from "#testing/seed.ts";
import {
  V1_CATALOG_MIGRATION,
  reconcileSummary,
  type CatalogMigration,
} from "./reconcile.ts";

/** A record with no v1 environments to carry over. */
const NO_MIGRATION: CatalogMigration = { renames: {}, retired: [] };

const context = useCatalogCluster();

type Document = Awaited<ReturnType<typeof catalogDocument>>;

/** A v1 static-site environment with one accepted deployment, as the backfill leaves it. */
async function seedV1Site() {
  const db = context.cluster.database;
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
    const result = await context.delivery.reconcileCatalog(
      document,
      testOperator,
      NO_MIGRATION,
    );
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
    const prod = await context.cluster.database.environment.findUniqueOrThrow({
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
    const arcade = await context.cluster.database.service.findUniqueOrThrow({
      where: { id: "arcade" },
    });
    expect(arcade.lineage).toBe(
      await serviceLineage(["image:arcade", "chart:arcade"]),
    );
    expect(arcade.catalogRevision).toBe(result.catalogRevision);
    // Services the catalog does not declare are retired, never deleted.
    const omitted = await context.cluster.database.service.findUniqueOrThrow({
      where: { id: "static-sites" },
    });
    expect(omitted.lifecycle).toBe("retired");
    const repeat = await context.delivery.reconcileCatalog(
      document,
      testOperator,
      NO_MIGRATION,
    );
    expect(repeat.recipes.created).toEqual([]);
    expect(repeat.environments).toEqual({
      created: [],
      renamed: [],
      rebound: [],
      retired: [],
      carried: [],
    });
    expect(repeat.services.lineageChanged).toEqual([]);
    expect(reconcileSummary(result).created).toEqual({
      services: 1,
      environments: 4,
      recipes: 4,
      configurations: result.configurations.created.length,
      edges: 2,
      carriedSelections: 0,
    });
    expect(reconcileSummary(repeat)).toEqual({
      catalogRevision: result.catalogRevision,
      created: {
        services: 0,
        environments: 0,
        recipes: 0,
        configurations: 0,
        edges: 0,
        carriedSelections: 0,
      },
      unchanged:
        document.services.length +
        document.environments.length +
        document.recipes.length +
        document.configurations.length +
        document.edges.length,
      refused: [],
    });
    expect(await context.cluster.database.deployment.count()).toBe(0);
  });

  test("refuses to rewrite a recipe or configuration revision and persists nothing", async () => {
    const document = await catalogDocument();
    await context.delivery.reconcileCatalog(
      document,
      testOperator,
      NO_MIGRATION,
    );
    const changed = {
      ...document,
      configurations: [
        ...document.configurations.filter((entry) => entry.id !== "arcade/1"),
        { id: "arcade/1", content: { replicas: "3" }, forwardOnly: [] },
      ],
    };
    await expect(
      context.delivery.reconcileCatalog(changed, testOperator, NO_MIGRATION),
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
      context.delivery.reconcileCatalog(recipe, testOperator, NO_MIGRATION),
    ).rejects.toThrow(
      /Recipe revision sjer-red\/1 already holds a different definition/u,
    );
    const kept = await context.cluster.database.configuration.findUniqueOrThrow(
      {
        where: { id: "arcade/1" },
      },
    );
    expect(kept.content).toEqual({});
  });
});

describe("catalog reconcile of component lists", () => {
  test("a component-list change starts a lineage, moves generations and waits for ownership", async () => {
    const document = await catalogDocument();
    await context.delivery.reconcileCatalog(
      document,
      testOperator,
      NO_MIGRATION,
    );
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
    await ownedDeployment("running");
    await expect(
      context.delivery.reconcileCatalog(widened, testOperator, NO_MIGRATION),
    ).rejects.toThrow(
      /component-list change is refused while a deployment of arcade is owned/u,
    );
    await context.cluster.database.deployment.update({
      where: { id: "arcade-owned" },
      data: { status: "canceled", finishedAt: new Date() },
    });
    const result = await context.delivery.reconcileCatalog(
      widened,
      testOperator,
      NO_MIGRATION,
    );
    expect(result.services.lineageChanged).toEqual(["arcade"]);
    const environments = await context.cluster.database.environment.findMany({
      where: { serviceId: "arcade" },
      orderBy: { id: "asc" },
    });
    expect(environments.map((row) => [row.id, row.generation])).toEqual([
      ["arcade/beta", 1],
      ["arcade/prod", 1],
    ]);
  });
});

describe("catalog reconcile of references (A5)", () => {
  test("a service tracks its own component from another of its environments; a pinned self-reference stays refused", async () => {
    const document = await catalogDocument();
    const tracked: Document = {
      ...document,
      services: document.services.map((service) =>
        service.id === "arcade"
          ? {
              ...service,
              components: [
                ...service.components,
                {
                  name: "image:arcade-accepted",
                  producer: "reference",
                  source: {
                    service: "arcade",
                    component: "image:arcade",
                    mode: "tracking",
                    environment: "arcade/prod",
                  },
                },
              ],
            }
          : service,
      ),
    };
    const result = await context.delivery.reconcileCatalog(
      tracked,
      testOperator,
      NO_MIGRATION,
    );
    expect(result.refused).toEqual([]);
    expect(
      await context.cluster.database.componentReference.findMany({
        where: { serviceId: "arcade" },
      }),
    ).toEqual([
      {
        serviceId: "arcade",
        component: "image:arcade-accepted",
        sourceServiceId: "arcade",
        sourceComponent: "image:arcade",
        mode: "tracking",
        sourceEnvironment: "arcade/prod",
      },
    ]);
    // The record keeps the catalog's rule: a pinned self-reference is refused.
    await expect(
      context.cluster.database.componentReference.create({
        data: {
          serviceId: "arcade",
          component: "image:arcade-previous",
          sourceServiceId: "arcade",
          sourceComponent: "image:arcade",
          mode: "pinned",
        },
      }),
    ).rejects.toThrow(/ComponentReference_distinct_check/u);
  });
});

/** Arcade's beta environment retired, or the whole service with both environments. */
function arcadeRetired(document: Document, scope: "environment" | "service") {
  return {
    ...document,
    services: document.services.map((service) =>
      scope === "service" && service.id === "arcade"
        ? { ...service, lifecycle: "retired" as const }
        : service,
    ),
    environments: document.environments.map((environment) =>
      environment.id === "arcade/beta" ||
      (scope === "service" && environment.id === "arcade/prod")
        ? { ...environment, lifecycle: "retired" as const }
        : environment,
    ),
  };
}
async function ownedDeployment(status: "running" | "failed") {
  await context.cluster.database.versionSet.create({
    data: {
      id: "arcade-set",
      serviceId: "arcade",
      revision: 1,
      lineage: "0".repeat(64),
    },
  });
  await context.cluster.database.deployment.create({
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
      status,
      recoveryRequired: status === "failed",
      requestedBy: testPublisher.id,
      ...(status === "failed" ? { finishedAt: new Date() } : {}),
    },
  });
}
async function lifecycles() {
  const [service, environments] = await Promise.all([
    context.cluster.database.service.findUniqueOrThrow({
      where: { id: "arcade" },
    }),
    context.cluster.database.environment.findMany({
      where: { serviceId: "arcade" },
      orderBy: { id: "asc" },
    }),
  ]);
  return [
    service.lifecycle,
    ...environments.map((row) => `${row.id}:${row.lifecycle}`),
  ];
}

describe("catalog reconcile of lifecycles while deployments are owned (S3)", () => {
  test("a running deployment holds its environment and service active until it settles", async () => {
    const document = await catalogDocument();
    await context.delivery.reconcileCatalog(
      document,
      testOperator,
      NO_MIGRATION,
    );
    await ownedDeployment("running");
    const refused = await context.delivery.reconcileCatalog(
      arcadeRetired(document, "service"),
      testOperator,
      NO_MIGRATION,
    );
    expect(refused.refused.map((entry) => entry.id).toSorted()).toEqual([
      "arcade",
      "arcade/beta",
    ]);
    expect(refused.refused[0]?.reason).toMatch(
      /refused while a deployment is owned or recovery-required \(S3\)/u,
    );
    // The unowned environment retires; the owned one and its service stay.
    expect(refused.environments.retired).toEqual(["arcade/prod"]);
    expect(await lifecycles()).toEqual([
      "active",
      "arcade/beta:active",
      "arcade/prod:retired",
    ]);
    await context.cluster.database.deployment.update({
      where: { id: "arcade-owned" },
      data: { status: "succeeded", finishedAt: new Date() },
    });
    const settled = await context.delivery.reconcileCatalog(
      arcadeRetired(document, "service"),
      testOperator,
      NO_MIGRATION,
    );
    expect(settled.refused).toEqual([]);
    expect(await lifecycles()).toEqual([
      "retired",
      "arcade/beta:retired",
      "arcade/prod:retired",
    ]);
  });

  test("a recovery-required deployment refuses its environment's retirement", async () => {
    const document = await catalogDocument();
    await context.delivery.reconcileCatalog(
      document,
      testOperator,
      NO_MIGRATION,
    );
    await ownedDeployment("failed");
    const result = await context.delivery.reconcileCatalog(
      arcadeRetired(document, "environment"),
      testOperator,
      NO_MIGRATION,
    );
    expect(result.refused.map((entry) => entry.id)).toEqual(["arcade/beta"]);
    expect(result.environments.retired).toEqual([]);
    expect(await lifecycles()).toEqual([
      "active",
      "arcade/beta:active",
      "arcade/prod:active",
    ]);
  });
});

function arcadeProdMoved(document: Document, lifecycle: "retired" | "removed") {
  return {
    ...document,
    environments: document.environments.map((environment) =>
      environment.id === "arcade/prod"
        ? { ...environment, lifecycle }
        : environment,
    ),
  };
}
/** Accepts a deployment of arcade/prod that froze the given recipe. */
async function acceptArcadeProd(id: string, pipelineRevisionId: string) {
  const db = context.cluster.database;
  await db.versionSet.upsert({
    where: { id: "arcade-set" },
    create: {
      id: "arcade-set",
      serviceId: "arcade",
      revision: 1,
      lineage: "0".repeat(64),
    },
    update: {},
  });
  await db.deployment.create({
    data: {
      id,
      requestId: `arcade/${id}`,
      environmentId: "arcade/prod",
      serviceId: "arcade",
      versionSetRevisionId: "arcade-set",
      pipelineRevisionId,
      configurationId: "arcade/1",
      catalogRevision: "test",
      expectedGeneration: 0,
      kind: "deploy",
      status: "succeeded",
      requestedBy: testPublisher.id,
      finishedAt: new Date(),
      monitorState: "unmonitored",
    },
  });
  await db.environment.update({
    where: { id: "arcade/prod" },
    data: {
      acceptedDeploymentId: id,
      acceptedVersionSetRevisionId: "arcade-set",
    },
  });
}

describe("catalog reconcile of a removal (4.10, section 7)", () => {
  test("a carried v1 Application has no lifecycle policy, so removal waits for a rebind", async () => {
    const document = await catalogDocument();
    await context.delivery.reconcileCatalog(
      document,
      testOperator,
      NO_MIGRATION,
    );
    await context.cluster.database.pipeline.create({
      data: { id: "arcade/v1", definition: arcadePipeline },
    });
    await acceptArcadeProd("arcade-carry", "arcade/v1");
    const refused = await context.delivery.reconcileCatalog(
      arcadeProdMoved(document, "removed"),
      testOperator,
      NO_MIGRATION,
    );
    expect(refused.refused).toEqual([
      {
        id: "arcade/prod",
        reason: expect.stringMatching(
          /accepted recipe deploys Application arcade with no lifecycle policy; rebind/u,
        ),
      },
    ]);
    expect(await lifecycles()).toEqual([
      "active",
      "arcade/beta:active",
      "arcade/prod:active",
    ]);
    expect(await context.delivery.pendingRemovals()).toEqual([]);
    // A rebind accepts the catalog recipe, which declares the lifecycle.
    await acceptArcadeProd("arcade-rebind", "arcade/3");
    const removed = await context.delivery.reconcileCatalog(
      arcadeProdMoved(document, "removed"),
      testOperator,
      NO_MIGRATION,
    );
    expect(removed.refused).toEqual([]);
    expect(await context.delivery.pendingRemovals()).toEqual([
      {
        environmentId: "arcade/prod",
        applications: [{ name: "arcade", lifecycle: "retain" }],
      },
    ]);
  });
});

/** arcade/prod accepts a carried v1 recipe, whose Application declares no lifecycle. */
async function carriedArcadeProd() {
  const document = await catalogDocument();
  await context.delivery.reconcileCatalog(document, testOperator, NO_MIGRATION);
  await context.cluster.database.pipeline.create({
    data: { id: "arcade/v1", definition: arcadePipeline },
  });
  await acceptArcadeProd("arcade-carry", "arcade/v1");
  return document;
}
describe("catalog reconcile of a carried Application's retirement (4.10, section 7)", () => {
  const unrebindable =
    /arcade\/prod's accepted recipe deploys Application arcade with no lifecycle policy; rebind it/u;

  test("retiring the environment waits for a rebind, which a retired environment could not take", async () => {
    const document = await carriedArcadeProd();
    const refused = await context.delivery.reconcileCatalog(
      arcadeProdMoved(document, "retired"),
      testOperator,
      NO_MIGRATION,
    );
    expect(refused.refused).toEqual([
      { id: "arcade/prod", reason: expect.stringMatching(unrebindable) },
    ]);
    expect(refused.environments.retired).toEqual([]);
    expect(await lifecycles()).toEqual([
      "active",
      "arcade/beta:active",
      "arcade/prod:active",
    ]);
    // A rebind accepts the catalog recipe, which declares the lifecycle.
    await acceptArcadeProd("arcade-rebind", "arcade/3");
    const retired = await context.delivery.reconcileCatalog(
      arcadeProdMoved(document, "retired"),
      testOperator,
      NO_MIGRATION,
    );
    expect(retired.refused).toEqual([]);
    expect(retired.environments.retired).toEqual(["arcade/prod"]);
  });

  test("retiring the service waits too, because a retired service admits no rebind", async () => {
    const document = await carriedArcadeProd();
    const refused = await context.delivery.reconcileCatalog(
      arcadeRetired(document, "service"),
      testOperator,
      NO_MIGRATION,
    );
    expect(refused.refused).toEqual([
      { id: "arcade", reason: expect.stringMatching(unrebindable) },
      { id: "arcade/prod", reason: expect.stringMatching(unrebindable) },
    ]);
    // arcade/beta accepts nothing, so it retires; the service and prod wait.
    expect(await lifecycles()).toEqual([
      "active",
      "arcade/beta:retired",
      "arcade/prod:active",
    ]);
    await acceptArcadeProd("arcade-rebind", "arcade/3");
    const retired = await context.delivery.reconcileCatalog(
      arcadeRetired(document, "service"),
      testOperator,
      NO_MIGRATION,
    );
    expect(retired.refused).toEqual([]);
    expect(await lifecycles()).toEqual([
      "retired",
      "arcade/beta:retired",
      "arcade/prod:retired",
    ]);
  });
});

describe("catalog reconcile of v1 environments", () => {
  test("a renamed environment keeps its accepted selection and history; omitted ones are refused", async () => {
    await seedV1Site();
    const document = await catalogDocument();
    const refused = await context.delivery.reconcileCatalog(
      document,
      testOperator,
      NO_MIGRATION,
    );
    expect(refused.refused).toEqual([
      {
        id: "static-sites/sjer-red",
        reason: expect.stringMatching(/omits this active environment/u),
      },
      {
        id: "static-sites",
        reason: expect.stringMatching(/still holds an active environment/u),
      },
    ]);
    // A refused environment stays active; the v1 migration carries it over.
    expect(
      await context.cluster.database.environment.findUniqueOrThrow({
        where: { id: "static-sites/sjer-red" },
      }),
    ).toMatchObject({ lifecycle: "active" });
    await context.cluster.database.prerequisiteEdge.deleteMany({
      where: { dependentId: "sjer-red/prod" },
    });
    await context.cluster.database.environment.delete({
      where: { id: "sjer-red/prod" },
    });
    const result = await context.delivery.reconcileCatalog(
      document,
      testOperator,
      V1_CATALOG_MIGRATION,
    );
    expect(result.refused).toEqual([]);
    expect(result.services.retired).toContain("static-sites");
    expect(result.environments.renamed).toEqual([
      { from: "static-sites/sjer-red", to: "sjer-red/prod" },
    ]);
    expect(result.environments.rebound).toEqual(["sjer-red/prod"]);
    const site = await context.cluster.database.environment.findUniqueOrThrow({
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
    const history = await context.cluster.database.deployment.findUniqueOrThrow(
      {
        where: { id: "static-accepted" },
      },
    );
    expect(history.environmentId).toBe("sjer-red/prod");
    expect(history.serviceId).toBe("static-sites");
    expect(
      await context.cluster.database.environment.findUnique({
        where: { id: "static-sites/sjer-red" },
      }),
    ).toBeNull();
  });

  test("retired v1 environments move their generation; lifecycles never move back", async () => {
    await seedV1Site();
    const document = await catalogDocument();
    const retiring = { renames: {}, retired: ["static-sites/sjer-red"] };
    const result = await context.delivery.reconcileCatalog(
      document,
      testOperator,
      retiring,
    );
    expect(result.environments.retired).toEqual(["static-sites/sjer-red"]);
    expect(
      await context.cluster.database.environment.findUniqueOrThrow({
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
    await context.delivery.reconcileCatalog(
      retiredService,
      testOperator,
      retiring,
    );
    await expect(
      context.delivery.reconcileCatalog(document, testOperator, retiring),
    ).rejects.toThrow(
      /Service sjer-red cannot move from retired back to active/u,
    );
  });

  test("a malformed document is refused before anything is written", async () => {
    await expect(
      context.delivery.reconcileCatalog({ services: [] }, testOperator),
    ).rejects.toMatchObject({ code: "INVALID" });
    expect(await context.cluster.database.pipeline.count()).toBe(0);
  });
});
