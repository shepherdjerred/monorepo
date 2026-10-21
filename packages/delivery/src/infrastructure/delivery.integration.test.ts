import { describe, expect, test } from "vitest";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import { StageSchema } from "#shared/contract.ts";
import {
  useDeliveryFixture,
  testPublication,
} from "#testing/delivery-fixture.ts";

const context = useDeliveryFixture();
test("ordinary completed stage acknowledgement is idempotent and cannot rewrite its operation or evidence", async () => {
  const deployment = await context.delivery.createDeployment(
    context.input(),
    testOperator,
  );
  await context.delivery.claim(deployment.id, testExecutor);
  const input = {
    key: "reconcile",
    status: "succeeded" as const,
    message: "reconcile: succeeded",
    operationId: "owned-operation",
    evidence: [
      {
        kind: "reconciliation" as const,
        summary: "Guarded exact-revision Argo operation completed",
        operationId: "owned-operation",
      },
    ],
  };
  await context.delivery.stage(
    deployment.id,
    {
      ...input,
      status: "running",
      message: "reconcile: running",
      evidence: [],
    },
    testExecutor,
  );
  const first = StageSchema.parse(
    await context.delivery.stage(deployment.id, input, testExecutor),
  );
  expect(
    StageSchema.parse(
      await context.delivery.stage(deployment.id, input, testExecutor),
    ).id,
  ).toBe(first.id);
  expect(
    await context.cluster.database.stage.count({
      where: { deploymentId: deployment.id, key: "reconcile" },
    }),
  ).toBe(1);
  expect(
    await context.cluster.database.evidence.count({
      where: { deploymentId: deployment.id },
    }),
  ).toBe(1);
  for (const changed of [
    { ...input, operationId: "foreign" },
    { ...input, message: "different" },
    { ...input, evidence: [{ ...input.evidence[0]!, summary: "different" }] },
  ])
    await expect(
      context.delivery.stage(deployment.id, changed, testExecutor),
    ).rejects.toMatchObject({ code: "CONFLICT" });
});
describe("PostgreSQL delivery invariants 1.1", () => {
  test("duplicate requests create one execution and one transactional outbox entry", async () => {
    const [first, second] = await Promise.all([
      context.delivery.createDeployment(context.input(), testOperator),
      context.delivery.createDeployment(context.input(), testOperator),
    ]);
    expect(first.id).toBe(second.id);
    expect(await context.cluster.database.deployment.count()).toBe(1);
    expect(await context.cluster.database.outbox.count()).toBe(1);
    await expect(
      context.delivery.createDeployment(
        { ...context.input(), expectedGeneration: 4 },
        testOperator,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  test("pending publication is ineligible until exact CI qualification; unchanged components stay pinned", async () => {
    const build = await context.delivery.publish(
      testPublication(2),
      testPublisher,
      {
        repositoryId: 1,
        pipelineNumber: 2,
      },
    );
    await expect(
      context.delivery.compose(
        {
          requestId: "invalid-compose",
          serviceId: "arcade",
          components: { server: "image/2" },
        },
        testPublisher,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const overview = await context.delivery.overview();
    expect(overview.artifacts.some((entry) => entry.id === "image/2")).toBe(
      false,
    );
    await context.delivery.qualify(build.buildId, "verified", testExecutor);
    const [latest] = await context.delivery.versions("arcade");
    expect(latest?.components["server"]?.id).toBe("image/2");
    expect(latest?.components["chart"]?.id).toBe("arcade-chart");
  });
  test("older CI completing late cannot supersede a newer qualified version set", async () => {
    const older = await context.delivery.publish(
      testPublication(2),
      testPublisher,
      {
        repositoryId: 1,
        pipelineNumber: 2,
      },
    );
    const newer = await context.delivery.publish(
      testPublication(3),
      testPublisher,
      {
        repositoryId: 1,
        pipelineNumber: 3,
      },
    );
    await context.delivery.qualify(newer.buildId, "verified", testExecutor);
    await context.delivery.qualify(older.buildId, "verified", testExecutor);
    const revisions = await context.delivery.versions("arcade");
    expect(revisions[0]?.components["server"]?.id).toBe("image/3");
  });
  test("claim is idempotent, freezes inputs and admits one target owner", async () => {
    const deployment = await context.delivery.createDeployment(
      context.input(),
      testOperator,
    );
    const first = await context.delivery.claim(deployment.id, testExecutor);
    const second = await context.delivery.claim(deployment.id, testExecutor);
    expect(first.deployment.status).toBe("running");
    expect(first.environment.generation).toBe(second.environment.generation);
    expect(first.environment.desiredVersionSetRevisionId).toBe(
      context.fixture.versionSet.id,
    );
    expect(await context.cluster.database.applicationLock.count()).toBe(1);
    await expect(
      context.delivery.createDeployment(context.input("other"), testOperator),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
describe("PostgreSQL delivery invariants 1.2", () => {
  test("changed generation invalidates a queued deployment", async () => {
    const deployment = await context.delivery.createDeployment(
      context.input(),
      testOperator,
    );
    await context.cluster.database.environment.update({
      where: { id: context.fixture.environment.id },
      data: { generation: { increment: 1 } },
    });
    await expect(
      context.delivery.claim(deployment.id, testExecutor),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await context.cluster.database.applicationLock.count()).toBe(0);
  });
  test("success requires exact reconciliation and acceptance evidence", async () => {
    const deployment = await context.delivery.createDeployment(
      context.input(),
      testOperator,
    );
    await context.delivery.claim(deployment.id, testExecutor);
    await expect(
      context.delivery.finish(
        deployment.id,
        {
          status: "succeeded",
          message: "claim is not acceptance",
          evidence: [],
          recoveryRequired: false,
        },
        testExecutor,
      ),
    ).rejects.toMatchObject({ code: "INVALID" });
    const result = await context.delivery.finish(
      deployment.id,
      {
        status: "succeeded",
        message: "accepted",
        observedRevisionId: context.fixture.versionSet.id,
        evidence: [
          {
            kind: "reconciliation",
            summary: "exact chart revision operation succeeded",
          },
          { kind: "acceptance", summary: "runtime checks passed" },
        ],
        recoveryRequired: false,
      },
      testExecutor,
    );
    expect(result.status).toBe("succeeded");
    const overview = await context.delivery.overview();
    const environment = overview.environments[0];
    expect(environment?.acceptedVersionSetRevisionId).toBe(
      context.fixture.versionSet.id,
    );
    expect(environment?.activeDeploymentId).toBeNull();
  });
  test("ambiguous failure retains ownership until explicit recovery, then manual retry can run", async () => {
    const deployment = await context.delivery.createDeployment(
      context.input(),
      testOperator,
    );
    await context.delivery.claim(deployment.id, testExecutor);
    await context.delivery.stage(
      deployment.id,
      {
        key: "apply",
        operationId: "op/1",
        status: "running",
        message: "submitted",
        evidence: [],
      },
      testExecutor,
    );
    await context.delivery.finish(
      deployment.id,
      {
        status: "failed",
        message: "Lost operation response",
        evidence: [],
        recoveryRequired: true,
      },
      testExecutor,
    );
    expect(await context.cluster.database.applicationLock.count()).toBe(1);
    await expect(
      context.delivery.createDeployment(
        { ...context.input("retry"), expectedGeneration: 1 },
        testOperator,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await context.delivery.releaseLock(
      deployment.id,
      "Inspected Argo history and confirmed no operation remains active",
      testOperator,
      [
        {
          kind: "reconciliation",
          operationId: "recorded-external-operation",
          summary:
            "Independent adapter readback proved this exact external operation is settled",
        },
      ],
    );
    expect(await context.cluster.database.applicationLock.count()).toBe(0);
    const retry = await context.delivery.createDeployment(
      { ...context.input("retry"), expectedGeneration: 1 },
      testOperator,
    );
    expect(retry.status).toBe("queued");
  });
  test("automatic reconciliation stops after failure and never calls acceptance green", async () => {
    const automatic = await context.delivery.reconcile(
      [context.fixture.environment.id],
      testExecutor,
    );
    expect(automatic.deployments).toHaveLength(1);
    const selected = automatic.deployments[0];
    if (selected === undefined) throw new Error("Automatic request missing");
    await context.delivery.claim(selected, testExecutor);
    await context.delivery.finish(
      selected,
      {
        status: "failed",
        message: "preflight rejected",
        evidence: [],
        recoveryRequired: false,
      },
      testExecutor,
    );
    const reconciled = await context.delivery.reconcile(
      [context.fixture.environment.id],
      testExecutor,
    );
    const overview = await context.delivery.overview();
    expect(reconciled.deployments).toEqual([]);
    expect(overview.environments[0]?.acceptedVersionSetRevisionId).toBeNull();
  });
});
describe("automatic composition compares digests and admits sibling CI builds", () => {
  test("a new artifact whose bytes equal the base creates no set revision; changed bytes do", async () => {
    const { delivery, cluster } = context;
    const changed = await delivery.publish(testPublication(2), testPublisher, {
      repositoryId: 1,
      pipelineNumber: 2,
    });
    await delivery.qualify(changed.buildId, "verified", testExecutor);
    const [second] = await delivery.versions("arcade");
    expect(second?.components["server"]?.id).toBe("image/2");
    const same = await delivery.publish(testPublication(3), testPublisher, {
      repositoryId: 1,
      pipelineNumber: 3,
    });
    expect(
      await delivery.qualify(same.buildId, "verified", testExecutor),
    ).toEqual({ status: "verified" });
    const verified = await delivery.build(same.buildId);
    expect(verified.status).toBe("verified");
    expect(
      await cluster.database.versionSet.findUnique({
        where: { qualifiedBuildId: same.buildId },
      }),
    ).toBeNull();
    expect(await delivery.versions("arcade")).toHaveLength(2);
    const publication = testPublication(4);
    const different = await delivery.publish(
      {
        ...publication,
        artifacts: publication.artifacts.map((entry) => ({
          ...entry,
          digest: `sha256:${"d".repeat(64)}`,
        })),
      },
      testPublisher,
      { repositoryId: 1, pipelineNumber: 4 },
    );
    expect(
      await delivery.qualify(different.buildId, "verified", testExecutor),
    ).toEqual({ status: "verified" });
    const [latest] = await delivery.versions("arcade");
    expect(latest).toMatchObject({ revision: 3, baseRevisionId: second?.id });
    expect(latest?.components["server"]).toMatchObject({
      id: "image/4",
      digest: `sha256:${"d".repeat(64)}`,
    });
    expect(latest?.components["chart"]?.id).toBe("arcade-chart");
  });
  test("two ci builds of service ci from one pipeline both compose, the second carrying the first's ci-base forward", async () => {
    const { delivery, cluster } = context;
    const register = (name: string, digest: string) =>
      delivery.publish(
        {
          requestId: `ci/1/7/ci/${name}`,
          serviceId: "ci",
          sourceRevision: "7".repeat(40),
          ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/7",
          verifiedAt: new Date().toISOString(),
          artifacts: [
            {
              id: `ci/1/7/image/${name}`,
              component: `image:${name}`,
              kind: "image",
              uri: `docker.io/shepherdjerred/${name}`,
              digest: `sha256:${digest.repeat(64)}`,
              version: "2.0.0-7",
            },
          ],
        },
        testPublisher,
        { repositoryId: 1, pipelineNumber: 7 },
      );
    const base = await register("ci-base", "1");
    expect(
      await delivery.qualify(base.buildId, "verified", testExecutor),
    ).toEqual({ status: "verified" });
    const playwright = await register("ci-playwright", "2");
    expect(
      await delivery.qualify(playwright.buildId, "verified", testExecutor),
    ).toEqual({ status: "verified" });
    const [second, first] = await delivery.versions("ci");
    expect(Object.keys(first?.components ?? {})).toEqual(["image:ci-base"]);
    expect(second).toMatchObject({
      revision: 2,
      baseRevisionId: first?.id,
      components: {
        "image:ci-base": {
          id: "ci/1/7/image/ci-base",
          buildId: base.buildId,
        },
        "image:ci-playwright": {
          id: "ci/1/7/image/ci-playwright",
          buildId: playwright.buildId,
        },
      },
    });
    expect(
      await cluster.database.versionSet.findUnique({
        where: { qualifiedBuildId: playwright.buildId },
      }),
    ).toMatchObject({ id: second?.id });
    expect(
      await cluster.database.buildArtifactSelection.count({
        where: { buildId: playwright.buildId },
      }),
    ).toBe(1);
  });
});
