import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { createTestApp } from "#testing/http-app.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import {
  OwnershipHandoverContextSchema,
  PipelineDefinitionSchema,
  RegisterEnvironmentSchema,
  type Principal,
} from "#shared/contract.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";
import {
  reviewedOwnershipDefinitions,
  requireReviewedOwnershipDefinition,
} from "./definitions.ts";

const context = useDeliveryFixture({
  registration: {
    pipeline: PipelineDefinitionSchema.parse(
      await Bun.file(
        new URL("../../../registrations/arcade.pipeline.json", import.meta.url),
      ).json(),
    ),
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
      enabledEnvironments: () => Promise.resolve([]),
    },
    sourceRevision,
  );
}

test("admin context binds actual API source, registered generation/pipeline and catalog without inventing ordinary acceptance", async () => {
  const response = await app().request("/api/v1/ownership-handover-context", {
    headers: admin,
  });
  expect(response.status).toBe(200);
  const observed = OwnershipHandoverContextSchema.parse(await response.json());
  expect(observed).toMatchObject({
    sourceRevision: source,
    catalogFingerprint: `sha256:${fingerprint(context.delivery.catalog.catalog)}`,
    writesEnabled: false,
    enabledEnvironments: [],
    counts: {
      applicationLocks: 0,
      platformLocks: 0,
      activeEnvironments: 0,
      pendingDeployments: 0,
      recoveryRequired: 0,
      pendingObservations: 0,
    },
  });
  expect(observed.targets).toEqual([
    expect.objectContaining({
      environmentId: context.fixture.environment.id,
      generation: context.fixture.environment.generation,
      pipelineRevisionId: "arcade/2",
      acceptedVersionSetRevisionId: null,
      baseline: null,
    }),
  ]);
  expect(await context.cluster.database.deployment.count()).toBe(0);
  const currentEnvironment =
    await context.cluster.database.environment.findUniqueOrThrow({
      where: { id: context.fixture.environment.id },
    });
  expect(currentEnvironment.acceptedVersionSetRevisionId).toBeNull();
});

test("the handover read is admin-only and an API without real baked source cannot authorize it", async () => {
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
  await context.delivery.claim(deployment.id, testExecutor);
  const response = await app().request("/api/v1/ownership-handover-context", {
    headers: admin,
  });
  const observed = OwnershipHandoverContextSchema.parse(await response.json());
  expect(observed.counts).toMatchObject({
    pendingDeployments: 1,
    applicationLocks: 1,
    activeEnvironments: 1,
  });
  expect(observed.targets[0]?.generation).toBe(
    context.fixture.environment.generation,
  );
});

test("the retired root has no reviewed definition and cannot be registered (X6)", async () => {
  const definitions = await reviewedOwnershipDefinitions();
  expect(definitions.has("gitops/root")).toBe(false);
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

test("handover rejects a different runner or application identity", async () => {
  const definitions = await reviewedOwnershipDefinitions();
  const reviewed = definitions.get("arcade/prod");
  if (reviewed === undefined)
    throw new Error("Canonical Arcade registration missing");
  const requested = await context.delivery.createDeployment(
    context.input("handover/1"),
    testOperator,
  );
  const env = await context.delivery.detail(requested.id);
  expect(() =>
    requireReviewedOwnershipDefinition(definitions, env.environment, {
      ...env.pipeline,
      definition: PipelineDefinitionSchema.parse({
        ...reviewed.pipeline,
        namespace: "unreviewed",
      }),
    }),
  ).toThrow("exact code-reviewed registered pipeline");
  expect(() =>
    requireReviewedOwnershipDefinition(
      definitions,
      { ...env.environment, application: "unreviewed-root" },
      env.pipeline,
    ),
  ).toThrow("exact code-reviewed registered pipeline");
});

test("fresh admission changes during the same PG observation fail closed", async () => {
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
