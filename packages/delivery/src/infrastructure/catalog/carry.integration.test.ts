import { expect, test } from "vitest";
import { liveSet } from "#infrastructure/composition/automatic.ts";
import { catalogDocument } from "#testing/catalog-fixture.ts";
import { useCatalogCluster } from "#testing/catalog-cluster.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import { registerTestService } from "#testing/services.ts";
import { V1_CATALOG_MIGRATION, type CatalogMigration } from "./reconcile.ts";

const context = useCatalogCluster();

const digest = (character: string) => `sha256:${character.repeat(64)}`;
type SeedArtifact = {
  id: string;
  component: string;
  kind: "archive" | "chart" | "image";
  uri: string;
  store: string;
  character: string;
};

/**
 * A v1 environment of `serviceId` whose accepted deployment froze one set
 * revision of that service's qualified CI build, as the v2 backfill leaves it.
 */
async function seedV1Selection(seed: {
  serviceId: string;
  environmentId: string;
  definition: { kind: "manual"; reason: string };
  artifacts: SeedArtifact[];
}) {
  const db = context.cluster.database;
  await registerTestService(db, seed.serviceId);
  const recipe = `${seed.environmentId}/v1`;
  await db.pipeline.create({
    data: {
      id: recipe,
      definition: seed.definition,
    },
  });
  await db.configuration.create({ data: { id: recipe, content: {} } });
  await db.build.create({
    data: {
      id: `${seed.serviceId}/v1-build`,
      requestId: `v1/${seed.serviceId}`,
      serviceId: seed.serviceId,
      sourceRevision: "a".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/41",
      repositoryId: 1,
      pipelineNumber: 41,
      verifiedAt: new Date("2026-10-01T00:00:00Z"),
      status: "verified",
      artifacts: {
        create: seed.artifacts.map(({ character, ...artifact }) => ({
          ...artifact,
          digest: digest(character),
          version: "1.0.0",
          ...(artifact.uri.startsWith("s3://delivery-artifacts/")
            ? {
                replication: {
                  store: "r2",
                  bucket: "delivery-artifacts-replica",
                  key: artifact.uri.slice("s3://delivery-artifacts/".length),
                  digest: digest(character),
                  replicatedAt: "2026-10-01T00:00:00.000Z",
                },
              }
            : {}),
        })),
      },
    },
  });
  await db.versionSet.create({
    data: {
      id: `${seed.serviceId}/v1-set`,
      serviceId: seed.serviceId,
      revision: 1,
      lineage: "0".repeat(64),
      orderMajor: 41,
      orderMinor: 0,
      automatic: true,
      qualifiedBuildId: `${seed.serviceId}/v1-build`,
      entries: {
        create: seed.artifacts.map((artifact) => ({
          component: artifact.component,
          artifactId: artifact.id,
        })),
      },
    },
  });
  await db.environment.create({
    data: {
      id: seed.environmentId,
      serviceId: seed.serviceId,
      name: seed.environmentId.slice(seed.environmentId.indexOf("/") + 1),
      pipelineRevisionId: recipe,
      declaredConfigurationId: recipe,
      generation: 2,
    },
  });
  await db.deployment.create({
    data: {
      id: `${seed.environmentId}/accepted`,
      requestId: `${seed.environmentId}/accepted`,
      environmentId: seed.environmentId,
      serviceId: seed.serviceId,
      versionSetRevisionId: `${seed.serviceId}/v1-set`,
      pipelineRevisionId: recipe,
      configurationId: recipe,
      catalogRevision: "v1-backfill",
      expectedGeneration: 1,
      kind: "deploy",
      status: "succeeded",
      requestedBy: testOperator.id,
      finishedAt: new Date(),
      monitorState: "unmonitored",
    },
  });
  await db.environment.update({
    where: { id: seed.environmentId },
    data: {
      acceptedDeploymentId: `${seed.environmentId}/accepted`,
      acceptedVersionSetRevisionId: `${seed.serviceId}/v1-set`,
      observedVersionSetRevisionId: `${seed.serviceId}/v1-set`,
    },
  });
}

/** The static-sites set carrying sjer.red's archive under its v1 name. */
const SITE: SeedArtifact = {
  id: "static-sites/site-sjer-red",
  component: "site:sjer-red",
  kind: "archive",
  uri: `s3://delivery-artifacts/sites/sjer-red/${"b".repeat(64)}.tar`,
  store: "delivery-artifacts",
  character: "b",
};
async function seedV1Site(extra: SeedArtifact[] = []) {
  await seedV1Selection({
    serviceId: "static-sites",
    environmentId: "static-sites/sjer-red",
    definition: { kind: "manual", reason: "v1 static-site deploys" },
    artifacts: [SITE, ...extra],
  });
}

async function carriedSet(serviceId: string) {
  return context.cluster.database.versionSet.findFirstOrThrow({
    where: { serviceId, migratedFromId: { not: null } },
    include: {
      entries: { include: { artifact: { include: { build: true } } } },
    },
  });
}

test("a static site's accepted archive is carried across the rename as the first set of the site's lineage", async () => {
  await seedV1Site();
  const document = await catalogDocument();
  const result = await context.delivery.reconcileCatalog(
    document,
    testOperator,
    V1_CATALOG_MIGRATION,
  );
  expect(result.refused).toEqual([]);
  expect(result.environments.carried).toEqual(["sjer-red/prod"]);
  const carried = await carriedSet("sjer-red");
  const service = await context.cluster.database.service.findUniqueOrThrow({
    where: { id: "sjer-red" },
  });
  expect(carried).toMatchObject({
    revision: 1,
    lineage: service.lineage,
    automatic: true,
    orderMajor: 41,
    migratedFromId: "static-sites/v1-set",
  });
  const [entry] = carried.entries;
  expect(carried.entries).toHaveLength(1);
  // Same bytes, digest, URI and source; the catalog's name and owner.
  expect(entry?.component).toBe("archive:sjer-red");
  expect(entry?.artifact).toMatchObject({
    component: "archive:sjer-red",
    uri: SITE.uri,
    digest: digest("b"),
    store: "delivery-artifacts",
    replication: expect.objectContaining({ digest: digest("b") }),
    migratedFrom: {
      artifactId: SITE.id,
      serviceId: "static-sites",
      component: "site:sjer-red",
      buildId: "static-sites/v1-build",
    },
    build: {
      serviceId: "sjer-red",
      sourceKind: "migrated",
      status: "verified",
      sourceRevision: "a".repeat(40),
      ciUrl: null,
      repositoryId: null,
      pipelineNumber: null,
    },
  });
  expect(carried.qualifiedBuildId).toBe(entry?.artifact.buildId);
  expect(
    await context.cluster.database.environment.findUniqueOrThrow({
      where: { id: "sjer-red/prod" },
    }),
  ).toMatchObject({
    acceptedDeploymentId: "static-sites/sjer-red/accepted",
    acceptedVersionSetRevisionId: carried.id,
    observedVersionSetRevisionId: carried.id,
  });
  // R0: the new lineage has a live set; the v1 history is unchanged.
  const live = await context.cluster.database.$transaction((tx) =>
    liveSet(tx, "sjer-red"),
  );
  expect(live?.id).toBe(carried.id);
  expect(
    await context.cluster.database.artifact.findUniqueOrThrow({
      where: { id: SITE.id },
    }),
  ).toMatchObject({ component: "site:sjer-red", migratedFrom: null });
  // Idempotent: a repeat carries nothing more.
  const repeat = await context.delivery.reconcileCatalog(
    document,
    testOperator,
    V1_CATALOG_MIGRATION,
  );
  expect(repeat.environments.carried).toEqual([]);
  expect(
    await context.cluster.database.versionSet.count({
      where: { serviceId: "sjer-red" },
    }),
  ).toBe(1);
});

/** gitops-legacy/arcade: Arcade's chart and image under a v1 group's ownership. */
const MOVED: CatalogMigration = {
  renames: { "gitops-legacy/arcade": "arcade/prod" },
  retired: [],
};
async function seedMovedArcade() {
  await seedV1Selection({
    serviceId: "gitops-legacy",
    environmentId: "gitops-legacy/arcade",
    definition: { kind: "manual", reason: "v1 group deploys" },
    artifacts: [
      {
        id: "gitops-legacy/chart-arcade",
        component: "chart:arcade",
        kind: "chart",
        uri: "https://chartmuseum.sjer.red/charts/arcade-1.0.0.tgz",
        store: "chartmuseum",
        character: "c",
      },
      {
        id: "gitops-legacy/image-arcade",
        component: "image:arcade",
        kind: "image",
        uri: "docker.io/shepherdjerred/arcade",
        store: "docker-hub",
        character: "d",
      },
    ],
  });
}

test("a chart whose owner moved is carried to its catalog owner, and producers find and retain it", async () => {
  await seedMovedArcade();
  const result = await context.delivery.reconcileCatalog(
    await catalogDocument(),
    testOperator,
    MOVED,
  );
  expect(result.environments.carried).toEqual(["arcade/prod"]);
  const carried = await carriedSet("arcade");
  expect(
    carried.entries
      .map((entry) => [entry.component, entry.artifact.build.serviceId])
      .toSorted(([left = ""], [right = ""]) => left.localeCompare(right)),
  ).toEqual([
    ["chart:arcade", "arcade"],
    ["image:arcade", "arcade"],
  ]);
  // The comparator read for the new identity is the carried artifact.
  const chart = await context.delivery.latestQualifiedArtifact(
    { serviceId: "arcade", component: "chart:arcade", kind: "chart" },
    1,
  );
  expect(chart).toMatchObject({
    serviceId: "arcade",
    digest: digest("c"),
    uri: "https://chartmuseum.sjer.red/charts/arcade-1.0.0.tgz",
    migratedFrom: { artifactId: "gitops-legacy/chart-arcade" },
  });
  // A producer's comparison base is the carried artifact too, and it retains
  // it instead of republishing identical bytes.
  const base = (component: string, kind: "chart" | "image", before: number) =>
    context.delivery.latestRetainableArtifact(
      { serviceId: "arcade", component, kind, beforePipeline: before },
      1,
    );
  await expect(base("chart:arcade", "chart", 42)).resolves.toMatchObject({
    id: chart.id,
  });
  const image = await base("image:arcade", "image", 42);
  expect(image).toMatchObject({
    serviceId: "arcade",
    migratedFrom: { artifactId: "gitops-legacy/image-arcade" },
  });
  const retained = await context.delivery.publish(
    {
      requestId: "arcade/ci/42",
      serviceId: "arcade",
      sourceRevision: "e".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/42",
      verifiedAt: new Date().toISOString(),
      artifacts: [],
      retainedArtifactIds: [chart.id, image.id],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 42 },
  );
  // While pipeline 42 is pending, pipeline 43 retains through it; carried
  // originals are qualified, so 42 waits on nothing and composes nothing (R2).
  await expect(base("image:arcade", "image", 43)).resolves.toMatchObject({
    id: image.id,
  });
  expect(
    await context.delivery.qualify(retained.buildId, "verified", testExecutor),
  ).toEqual({ status: "verified" });
  expect(
    await context.cluster.database.versionSet.count({
      where: { serviceId: "arcade" },
    }),
  ).toBe(1);
});

test("a rebind right after reconcile moves the carried selection to the declared recipe", async () => {
  await seedV1Site();
  await context.delivery.reconcileCatalog(
    await catalogDocument(),
    testOperator,
    V1_CATALOG_MIGRATION,
  );
  const carried = await carriedSet("sjer-red");
  const env = await context.cluster.database.environment.findUniqueOrThrow({
    where: { id: "sjer-red/prod" },
  });
  const rebind = await context.delivery.createDeployment(
    {
      requestId: "sjer-red/rebind",
      environmentId: "sjer-red/prod",
      expectedGeneration: env.generation,
      kind: "rebind",
      recipeRevisionId: "sjer-red/1",
      configurationRevisionId: "sjer-red/1",
    },
    testOperator,
  );
  expect(rebind).toMatchObject({
    serviceId: "sjer-red",
    versionSetRevisionId: carried.id,
    pipelineRevisionId: "sjer-red/1",
  });
});

test("two v1 components becoming one catalog component refuse the reconcile", async () => {
  await seedV1Site([
    {
      id: "static-sites/archive-sjer-red",
      component: "archive:sjer-red",
      kind: "archive",
      uri: `s3://delivery-artifacts/sites/sjer-red/${"f".repeat(64)}.tar`,
      store: "delivery-artifacts",
      character: "f",
    },
  ]);
  await expect(
    context.delivery.reconcileCatalog(
      await catalogDocument(),
      testOperator,
      V1_CATALOG_MIGRATION,
    ),
  ).rejects.toThrow(/onto one component archive:sjer-red/u);
  // Nothing is written: the environment keeps its v1 id.
  expect(
    await context.cluster.database.environment.findUnique({
      where: { id: "static-sites/sjer-red" },
    }),
  ).not.toBeNull();
});

test("one v1 component becoming a first-party component of two services refuses the reconcile", async () => {
  await seedV1Site();
  const document = await catalogDocument();
  const sjerRed = document.services.find(
    (service) => service.id === "sjer-red",
  );
  if (sjerRed === undefined) throw new Error("The fixture declares sjer-red");
  await expect(
    context.delivery.reconcileCatalog(
      {
        ...document,
        services: [...document.services, { ...sjerRed, id: "sjer-red-mirror" }],
      },
      testOperator,
      V1_CATALOG_MIGRATION,
    ),
  ).rejects.toThrow(
    /would become archive:sjer-red of sjer-red and sjer-red-mirror/u,
  );
});
