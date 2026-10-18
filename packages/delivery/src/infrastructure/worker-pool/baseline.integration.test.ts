import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { workerFixture } from "#testing/worker-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { CreateDeploymentSchema } from "#shared/contract.ts";

const context = useDeliveryFixture();

async function prepare() {
  const fixture = await workerFixture(context.delivery);
  const a = await fixture.requestedRelease(1);
  await context.delivery.cancel(a.deployment.id, testOperator);
  const c = await fixture.requestedRelease(3);
  await context.delivery.cancel(c.deployment.id, testOperator);
  await context.delivery.registerPipeline(
    fixture.workerPipeline.id,
    fixture.workerPipeline.definition,
    testOperator,
  );
  const old = await context.delivery.workers(
    fixture.environmentId,
    testOperator,
  );
  await context.delivery.registerEnvironment(
    {
      id: fixture.environmentId,
      serviceId: "temporal",
      name: "prod",
      application: "temporal",
      pipelineRevisionId: fixture.workerPipeline.id,
      configurationRevision: "baseline-reviewed/1",
      configuration: {
        setting: "unchanged",
      },
      automatic: false,
    },
    testOperator,
  );
  const env = await context.delivery.workers(
    fixture.environmentId,
    testOperator,
  );
  expect(env.generation).toBe(old.generation + 1);
  const input = CreateDeploymentSchema.parse({
    requestId: "host-only-baseline",
    environmentId: fixture.environmentId,
    versionSetRevisionId: c.version.id,
    expectedGeneration: env.generation,
    kind: "adopt-worker",
    workerBaseline: {
      artifactIds: [a.artifactId, c.artifactId],
      candidateArtifactId: a.artifactId,
    },
  });
  return { fixture, a, c, input };
}

test("host-only baseline freezes original A hosts alongside app C provenance without accepting or changing the application", async () => {
  const { fixture, a, c, input } = await prepare();
  await expect(
    context.delivery.createDeployment(input, {
      id: "deployer",
      kind: "machine",
      scopes: ["deploy"],
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const before = await context.cluster.database.environment.findUniqueOrThrow({
    where: { id: fixture.environmentId },
  });
  const selected = await context.delivery.createDeployment(input, testOperator);
  expect(await context.delivery.createDeployment(input, testOperator)).toEqual(
    selected,
  );
  expect(selected.workerSnapshot).toMatchObject({
    workerOperation: "baseline",
    candidateBuildId: "1".padEnd(40, "0"),
    versions: expect.arrayContaining([
      expect.objectContaining({
        artifactId: a.artifactId,
        sourceRevision: "1".padEnd(40, "0"),
      }),
      expect.objectContaining({
        artifactId: c.artifactId,
        sourceRevision: "3".padEnd(40, "0"),
      }),
    ]),
  });
  const claimed = await context.delivery.claim(selected.id, testExecutor);
  expect(
    claimed.versionSet.components["image:temporal-worker"]?.sourceRevision,
  ).toBe("3".padEnd(40, "0"));
  expect(await context.cluster.database.workerVersion.count()).toBe(0);
  const result = {
    status: "succeeded" as const,
    message: "Independent host-only observations verified",
    recoveryRequired: false,
    evidence: [
      {
        kind: "reconciliation" as const,
        summary:
          "Existing Argo source unchanged, Pods and native routes independently observed",
      },
      {
        kind: "acceptance" as const,
        summary:
          "Existing worker identity/config and route readbacks verified twice",
      },
    ],
  };
  await expect(
    context.delivery.finish(
      selected.id,
      { ...result, observedRevisionId: c.version.id },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "INVALID" });
  await expect(
    context.delivery.finish(selected.id, result, testExecutor),
  ).rejects.toMatchObject({ code: "INVALID" });
  await context.delivery.stage(
    selected.id,
    {
      key: "worker-baseline",
      operationId: `baseline:${selected.id}`,
      status: "succeeded",
      message: "Independent adapter observation fixture",
      evidence: result.evidence,
    },
    testExecutor,
  );
  await context.delivery.finish(selected.id, result, testExecutor);
  const after = await context.cluster.database.environment.findUniqueOrThrow({
    where: { id: fixture.environmentId },
  });
  expect(after).toMatchObject({
    acceptedVersionSetRevisionId: before.acceptedVersionSetRevisionId,
    desiredVersionSetRevisionId: before.desiredVersionSetRevisionId,
    observedVersionSetRevisionId: before.observedVersionSetRevisionId,
    observedAt: before.observedAt,
    configuration: before.configuration,
    configurationRevision: before.configurationRevision,
    pipelineRevisionId: before.pipelineRevisionId,
    automaticSuppressedThroughRevision:
      before.automaticSuppressedThroughRevision,
    activeDeploymentId: null,
  });
  const pool = await context.delivery.workers(
    fixture.environmentId,
    testOperator,
  );
  expect(pool.versions).toHaveLength(2);
  expect(
    pool.versions.every(
      (version) => version.introducedByDeploymentId === selected.id,
    ),
  ).toBe(true);
  await expect(
    context.delivery.createDeployment(
      {
        requestId: "no-baseline-rollback",
        environmentId: fixture.environmentId,
        versionSetRevisionId: c.version.id,
        expectedGeneration: pool.generation,
        kind: "rollback",
      },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    context.delivery.createDeployment(
      {
        requestId: "still-guarded-rollout",
        environmentId: fixture.environmentId,
        versionSetRevisionId: c.version.id,
        expectedGeneration: pool.generation,
        kind: "deploy",
      },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "INVALID" });
});

test("baseline artifact selection rejects unqualified provenance and is mandatory only for host adoption", async () => {
  const { a, input } = await prepare();
  expect(
    CreateDeploymentSchema.safeParse({ ...input, kind: "deploy" }).success,
  ).toBe(false);
  expect(
    CreateDeploymentSchema.safeParse({ ...input, workerBaseline: undefined })
      .success,
  ).toBe(false);
  expect(
    CreateDeploymentSchema.safeParse({
      ...input,
      workerBaseline: {
        artifactIds: [a.artifactId, a.artifactId],
        candidateArtifactId: a.artifactId,
      },
    }).success,
  ).toBe(false);
  await context.cluster.database.build.updateMany({
    where: { artifacts: { some: { id: a.artifactId } } },
    data: { status: "pending" },
  });
  await expect(
    context.delivery.createDeployment(input, testOperator),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await context.cluster.database.workerVersion.count()).toBe(0);
});
