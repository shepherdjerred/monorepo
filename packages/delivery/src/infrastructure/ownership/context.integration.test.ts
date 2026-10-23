import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { createTestApp } from "#testing/http-app.ts";
import { testOperator } from "#testing/seed.ts";
import {
  OwnershipHandoverContextSchema,
  PipelineDefinitionSchema,
  RegisterEnvironmentSchema,
  type Principal,
} from "#shared/contract.ts";
import { fingerprint, wire } from "#infrastructure/delivery-records.ts";
import { environment } from "#infrastructure/delivery-data.ts";
import { PipelineRevisionSchema } from "#shared/contract.ts";
import { catalogDocument } from "#testing/catalog-fixture.ts";
import {
  reconciledCatalog,
  requireCatalogOwnershipDefinition,
} from "./definitions.ts";

const arcadePipeline = PipelineDefinitionSchema.parse(
  await Bun.file(
    new URL("../../../registrations/arcade.pipeline.json", import.meta.url),
  ).json(),
);
const context = useDeliveryFixture({
  registration: {
    pipeline: arcadePipeline,
    environment: RegisterEnvironmentSchema.parse(
      await Bun.file(
        new URL(
          "../../../registrations/arcade.environment.json",
          import.meta.url,
        ),
      ).json(),
    ),
  },
});
const source = "a".repeat(40);
const admin = {
  authorization: "Bearer test-handover-admin-credential-0000000",
};
const adminCredential: { token: string; principal: Principal } = {
  token: "test-handover-admin-credential-0000000",
  principal: {
    id: "handover-admin",
    kind: "machine" as const,
    scopes: ["read", "admin"],
  },
};
/** Handover reads the catalog as reconciled into PostgreSQL (4.1, C1). */
async function reconcile() {
  return context.delivery.reconcileCatalog(
    await catalogDocument(),
    testOperator,
    { renames: {}, retired: [] },
  );
}
function app(writes = false, sourceRevision = source) {
  return createTestApp(
    context.delivery,
    {
      machineCredentials: [
        adminCredential,
        {
          token: "test-handover-readonly-credential-0000",
          principal: { id: "reader", kind: "machine", scopes: ["read"] },
        },
      ],
      writesEnabled: () => Promise.resolve(writes),
      // v2 ownership admits by catalog lifecycle and never reads this flag.
      enabledEnvironments: () =>
        Promise.reject(
          new Error("ownership read delivery-enabled-environments"),
        ),
    },
    sourceRevision,
  );
}

test("admin context binds actual API source and the reconciled catalog's bindings without inventing ordinary acceptance", async () => {
  const record = await reconcile();
  const response = await app().request("/api/v1/ownership-handover-context", {
    headers: admin,
  });
  expect(response.status).toBe(200);
  const observed = OwnershipHandoverContextSchema.parse(await response.json());
  expect(observed).toMatchObject({
    sourceRevision: source,
    catalogFingerprint: `sha256:${fingerprint(context.delivery.catalog.catalog)}`,
    // The targets' identity is the reconciled revision, not the image's catalog.
    catalogRevision: record.catalogRevision,
    writesEnabled: false,
    admittingEnvironments: [
      "arcade/beta",
      "arcade/prod",
      "delivery/prod",
      "sjer-red/prod",
    ],
    counts: {
      applicationLocks: 0,
      platformLocks: 0,
      activeEnvironments: 0,
      pendingDeployments: 0,
      recoveryRequired: 0,
      pendingObservations: 0,
    },
  });
  expect(
    observed.targets.map((target) => [
      target.environmentId,
      target.application,
      target.pipelineRevisionId,
      target.pipeline.kind,
    ]),
  ).toEqual([
    ["arcade/beta", "arcade-beta", "arcade-beta/1", "kubernetes-application"],
    ["arcade/prod", "arcade", "arcade/3", "kubernetes-application"],
    ["delivery/prod", "delivery", "delivery/3", "kubernetes-application"],
  ]);
  const reconciled =
    await context.cluster.database.environment.findUniqueOrThrow({
      where: { id: "arcade/prod" },
    });
  expect(observed.targets[1]).toMatchObject({
    generation: reconciled.generation,
    acceptedVersionSetRevisionId: null,
    baseline: null,
  });
  expect(await context.cluster.database.deployment.count()).toBe(0);
  const currentEnvironment =
    await context.cluster.database.environment.findUniqueOrThrow({
      where: { id: context.fixture.environment.id },
    });
  expect(currentEnvironment.acceptedVersionSetRevisionId).toBeNull();
});

test("the handover context admits by catalog lifecycle: a retired environment admits nothing", async () => {
  await reconcile();
  // The static site has no Application, so it is admitted but never a target.
  await context.cluster.database.environment.update({
    where: { id: "sjer-red/prod" },
    data: { lifecycle: "retired" },
  });
  const response = await app().request("/api/v1/ownership-handover-context", {
    headers: admin,
  });
  expect(response.status).toBe(200);
  const observed = OwnershipHandoverContextSchema.parse(await response.json());
  expect(observed.admittingEnvironments).toEqual([
    "arcade/beta",
    "arcade/prod",
    "delivery/prod",
  ]);
});

test("a retired environment's Application is not handed over and does not block the others", async () => {
  await reconcile();
  await context.cluster.database.environment.update({
    where: { id: "arcade/beta" },
    data: { lifecycle: "retired" },
  });
  const response = await app().request("/api/v1/ownership-handover-context", {
    headers: admin,
  });
  expect(response.status).toBe(200);
  const observed = OwnershipHandoverContextSchema.parse(await response.json());
  expect(observed.targets.map((target) => target.environmentId)).toEqual([
    "arcade/prod",
    "delivery/prod",
  ]);
});

test("the handover read is admin-only and an API without real baked source cannot authorize it", async () => {
  await reconcile();
  const denied = await app().request("/api/v1/ownership-handover-context", {
    headers: { authorization: "Bearer test-handover-readonly-credential-0000" },
  });
  expect(denied.status).toBe(403);
  const unknown = await app(false, "unknown").request(
    "/api/v1/ownership-handover-context",
    { headers: admin },
  );
  expect(unknown.status).toBe(503);
  const enabled = await app(true).request(
    "/api/v1/ownership-handover-context",
    { headers: admin },
  );
  expect(
    OwnershipHandoverContextSchema.parse(await enabled.json()).writesEnabled,
  ).toBe(true);
});

test("quarantine and ownership counts come from all PG rows, independently of the capped overview", async () => {
  const deployment = await context.delivery.createDeployment(
    context.input(),
    testOperator,
  );
  const raw = await context.cluster.database.deployment.findUniqueOrThrow({
    where: { id: deployment.id },
  });
  const {
    workerSnapshot: _worker,
    platformSnapshot: _platform,
    controlPlaneSnapshot: _control,
    forumBaselineSnapshot: _forum,
    admissionSnapshot: _admission,
    ...columns
  } = raw;
  await context.cluster.database.deployment.createMany({
    data: Array.from({ length: 101 }, (_, index) => ({
      ...columns,
      id: `terminal-${String(index)}`,
      requestId: `terminal/${String(index)}`,
      status: "canceled",
      createdAt: new Date(Date.now() + index + 1000),
    })),
  });
  const overview = await context.delivery.overview();
  expect(overview.deployments).toHaveLength(100);
  await reconcile();
  // Ownership as admission records it: the running row, its environment's
  // owner and the held Application lock (D7).
  const db = context.cluster.database;
  await db.$transaction([
    db.deployment.update({
      where: { id: deployment.id },
      data: { status: "running" },
    }),
    db.environment.update({
      where: { id: raw.environmentId },
      data: { activeDeploymentId: deployment.id },
    }),
    db.targetLock.create({
      data: { instance: "application:arcade", deploymentId: deployment.id },
    }),
  ]);
  const response = await app().request("/api/v1/ownership-handover-context", {
    headers: admin,
  });
  const observed = OwnershipHandoverContextSchema.parse(await response.json());
  expect(observed.counts).toMatchObject({
    pendingDeployments: 1,
    applicationLocks: 1,
    activeEnvironments: 1,
  });
  const reconciled = await db.environment.findUniqueOrThrow({
    where: { id: raw.environmentId },
  });
  expect(
    observed.targets.find(
      (target) => target.environmentId === raw.environmentId,
    )?.generation,
  ).toBe(reconciled.generation);
});

test("the retired root cannot be registered (X6)", async () => {
  await context.delivery.registerPipeline(
    "platform/root/1",
    {
      kind: "root-release",
      runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"f".repeat(64)}`,
    },
    testOperator,
  );
  await expect(
    context.delivery.registerEnvironment(
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
    ),
  ).rejects.toThrow(/root release is retired/u);
});

async function handoverStatus() {
  const response = await app().request("/api/v1/ownership-handover-context", {
    headers: admin,
  });
  return response.status;
}

test("handover reads only the reconciled catalog and refuses definitions registered outside it", async () => {
  // The v1 registration the fixture made is not a reviewed definition.
  expect(await handoverStatus()).toBe(503);
  await reconcile();
  expect(await handoverStatus()).toBe(200);
  await context.delivery.registerPipeline(
    "arcade/unreviewed",
    PipelineDefinitionSchema.parse({
      ...arcadePipeline,
      namespace: "unreviewed",
    }),
    testOperator,
  );
  expect(await handoverStatus()).toBe(409);
  await reconcile();
  expect(await handoverStatus()).toBe(200);
});

test("a re-registration outside the catalog is refused by its binding, whatever its recorded time", async () => {
  await reconcile();
  expect(await handoverStatus()).toBe(200);
  const db = context.cluster.database;
  // Registration can bind only a v1 pipeline over the reconciled recipe.
  await context.delivery.registerEnvironment(
    {
      id: "arcade/prod",
      serviceId: "arcade",
      name: "prod",
      application: "arcade",
      pipelineRevisionId: "arcade/2",
      configurationRevision: "arcade/unreviewed",
      configuration: {},
      automatic: false,
    },
    testOperator,
  );
  // A registration whose transaction began before the reconcile but
  // committed after it records the earlier time, so the time check misses it.
  const reconciled = await db.audit.findFirstOrThrow({
    where: { action: "catalog.reconciled" },
    orderBy: { occurredAt: "desc" },
  });
  await db.audit.updateMany({
    where: { action: "environment.registered", entityId: "arcade/prod" },
    data: { occurredAt: new Date(reconciled.occurredAt.getTime() - 1000) },
  });
  // The target's binding is no catalog recipe, so the handover still refuses.
  expect(await handoverStatus()).toBe(409);
});

test("an active environment the newest catalog omits is not handed over under it (C1)", async () => {
  await reconcile();
  expect(await handoverStatus()).toBe(200);
  const document = await catalogDocument();
  // A catalog that omits delivery/prod without retiring it: reconcile refuses
  // the omission and leaves it active, while delivery moves to the new revision.
  const omitted = await context.delivery.reconcileCatalog(
    {
      ...document,
      environments: document.environments.filter(
        (env) => env.id !== "delivery/prod",
      ),
      edges: document.edges.filter(
        (edge) => edge.prerequisite !== "delivery/prod",
      ),
    },
    testOperator,
    { renames: {}, retired: [] },
  );
  expect(omitted.refused.map((entry) => entry.id)).toContain("delivery/prod");
  const db = context.cluster.database;
  const [service, kept] = await Promise.all([
    db.service.findUniqueOrThrow({ where: { id: "delivery" } }),
    db.environment.findUniqueOrThrow({ where: { id: "delivery/prod" } }),
  ]);
  expect(kept.lifecycle).toBe("active");
  expect(service.catalogRevision).toBe(omitted.catalogRevision);
  expect(kept.catalogRevision).not.toBe(omitted.catalogRevision);
  // Its old binding belongs to no reviewed catalog, so handover refuses.
  expect(await handoverStatus()).toBe(409);
  await reconcile();
  expect(await handoverStatus()).toBe(200);
});

test("handover rejects a service, application or recipe identity the catalog does not bind", async () => {
  await reconcile();
  await context.cluster.database.$transaction(async (tx) => {
    const catalog = await reconciledCatalog(tx);
    const env = await environment(tx, "arcade/prod");
    const pipeline = PipelineRevisionSchema.parse(
      wire(
        await tx.pipeline.findUniqueOrThrow({
          where: { id: env.pipelineRevisionId },
        }),
      ),
    );
    await expect(
      requireCatalogOwnershipDefinition(tx, catalog, env, pipeline),
    ).resolves.toBeUndefined();
    const refused = "exact environment binding of the reconciled catalog";
    await expect(
      requireCatalogOwnershipDefinition(
        tx,
        catalog,
        { ...env, application: "unreviewed-root" },
        pipeline,
      ),
    ).rejects.toThrow(refused);
    await expect(
      requireCatalogOwnershipDefinition(
        tx,
        catalog,
        { ...env, serviceId: "delivery" },
        pipeline,
      ),
    ).rejects.toThrow(refused);
    // A v1 pipeline is never a catalog recipe revision.
    await expect(
      requireCatalogOwnershipDefinition(tx, catalog, env, {
        ...pipeline,
        definition: arcadePipeline,
      }),
    ).rejects.toThrow(refused);
    await expect(
      requireCatalogOwnershipDefinition(
        tx,
        { revision: "sha256:stale" },
        env,
        pipeline,
      ),
    ).rejects.toThrow(refused);
  });
});

test("fresh admission changes during the same PG observation fail closed", async () => {
  await reconcile();
  let calls = 0;
  const changing = createTestApp(
    context.delivery,
    {
      machineCredentials: [adminCredential],
      enabledEnvironments: () => Promise.resolve([]),
      writesEnabled: () => Promise.resolve(calls++ > 0),
    },
    source,
  );
  const response = await changing.request(
    "/api/v1/ownership-handover-context",
    { headers: admin },
  );
  expect(response.status).toBe(503);
  expect(await context.cluster.database.targetLock.count()).toBe(0);
});
