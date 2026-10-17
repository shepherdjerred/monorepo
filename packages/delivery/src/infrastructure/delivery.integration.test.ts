import { describe, expect, test } from "vitest";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import {
  useDeliveryFixture,
  testPublication,
} from "#testing/delivery-fixture.ts";

const context = useDeliveryFixture();
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
