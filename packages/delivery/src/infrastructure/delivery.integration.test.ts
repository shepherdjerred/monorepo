import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import {
  seedDelivery,
  testExecutor,
  testOperator,
  testPublisher,
} from "#testing/seed.ts";
import { Delivery } from "./delivery.ts";
import type { CreateDeployment, PublishBuild } from "#shared/contract.ts";

function publication(number: number): PublishBuild {
  return {
    requestId: `publish/${String(number)}`,
    serviceId: "arcade",
    sourceRevision: "b".repeat(40),
    ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
    verifiedAt: new Date().toISOString(),
    artifacts: [
      {
        id: `image/${String(number)}`,
        component: "server",
        kind: "image",
        uri: "docker.io/shepherdjerred/arcade",
        version: `1.0.${String(number)}`,
        digest: `sha256:${"c".repeat(64)}`,
      },
    ],
  };
}

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let delivery: Delivery;
let fixture: Awaited<ReturnType<typeof seedDelivery>>;
beforeAll(async () => {
  cluster = await createTestDatabase();
  delivery = new Delivery(cluster.database);
}, 60_000);
afterAll(async () => {
  await cluster.close();
});
beforeEach(async () => {
  await cluster.database.$executeRawUnsafe(
    'TRUNCATE "ApplicationLock", "Outbox", "Evidence", "Approval", "Stage", "Deployment", "Environment", "Pipeline", "VersionSetEntry", "VersionSet", "Artifact", "Build", "Request", "Audit", "ImportedSnapshot" CASCADE',
  );
  fixture = await seedDelivery(delivery);
});
function input(requestId = "deploy/1"): CreateDeployment {
  return {
    requestId,
    environmentId: fixture.environment.id,
    versionSetRevisionId: fixture.versionSet.id,
    expectedGeneration: fixture.environment.generation,
    kind: "deploy",
  };
}
describe("PostgreSQL delivery invariants 1.1", () => {
  test("duplicate requests create one execution and one transactional outbox entry", async () => {
    const [first, second] = await Promise.all([
      delivery.createDeployment(input(), testOperator),
      delivery.createDeployment(input(), testOperator),
    ]);
    expect(first.id).toBe(second.id);
    expect(await cluster.database.deployment.count()).toBe(1);
    expect(await cluster.database.outbox.count()).toBe(1);
    await expect(
      delivery.createDeployment(
        { ...input(), expectedGeneration: 4 },
        testOperator,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  test("pending publication is ineligible until exact CI qualification; unchanged components stay pinned", async () => {
    const build = await delivery.publish(publication(2), testPublisher, {
      repositoryId: 1,
      pipelineNumber: 2,
    });
    await expect(
      delivery.compose(
        {
          requestId: "invalid-compose",
          serviceId: "arcade",
          components: { server: "image/2" },
        },
        testPublisher,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const overview = await delivery.overview();
    expect(overview.artifacts.some((entry) => entry.id === "image/2")).toBe(
      false,
    );
    await delivery.qualify(build.buildId, "verified", testExecutor);
    const [latest] = await delivery.versions("arcade");
    expect(latest?.components["server"]?.id).toBe("image/2");
    expect(latest?.components["chart"]?.id).toBe("arcade-chart");
  });
  test("older CI completing late cannot supersede a newer qualified version set", async () => {
    const older = await delivery.publish(publication(2), testPublisher, {
      repositoryId: 1,
      pipelineNumber: 2,
    });
    const newer = await delivery.publish(publication(3), testPublisher, {
      repositoryId: 1,
      pipelineNumber: 3,
    });
    await delivery.qualify(newer.buildId, "verified", testExecutor);
    await delivery.qualify(older.buildId, "verified", testExecutor);
    const revisions = await delivery.versions("arcade");
    expect(revisions[0]?.components["server"]?.id).toBe("image/3");
  });
  test("claim is idempotent, freezes inputs and admits one target owner", async () => {
    const deployment = await delivery.createDeployment(input(), testOperator);
    const first = await delivery.claim(deployment.id, testExecutor);
    const second = await delivery.claim(deployment.id, testExecutor);
    expect(first.deployment.status).toBe("running");
    expect(first.environment.generation).toBe(second.environment.generation);
    expect(first.environment.desiredVersionSetRevisionId).toBe(
      fixture.versionSet.id,
    );
    expect(await cluster.database.applicationLock.count()).toBe(1);
    await expect(
      delivery.createDeployment(input("other"), testOperator),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
describe("PostgreSQL delivery invariants 1.2", () => {
  test("changed generation invalidates a queued deployment", async () => {
    const deployment = await delivery.createDeployment(input(), testOperator);
    await cluster.database.environment.update({
      where: { id: fixture.environment.id },
      data: { generation: { increment: 1 } },
    });
    await expect(
      delivery.claim(deployment.id, testExecutor),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await cluster.database.applicationLock.count()).toBe(0);
  });
  test("success requires exact reconciliation and acceptance evidence", async () => {
    const deployment = await delivery.createDeployment(input(), testOperator);
    await delivery.claim(deployment.id, testExecutor);
    await expect(
      delivery.finish(
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
    const result = await delivery.finish(
      deployment.id,
      {
        status: "succeeded",
        message: "accepted",
        observedRevisionId: fixture.versionSet.id,
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
    const overview = await delivery.overview();
    const environment = overview.environments[0];
    expect(environment?.acceptedVersionSetRevisionId).toBe(
      fixture.versionSet.id,
    );
    expect(environment?.activeDeploymentId).toBeNull();
  });
  test("ambiguous failure retains ownership until explicit recovery, then manual retry can run", async () => {
    const deployment = await delivery.createDeployment(input(), testOperator);
    await delivery.claim(deployment.id, testExecutor);
    await delivery.stage(
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
    await delivery.finish(
      deployment.id,
      {
        status: "failed",
        message: "Lost operation response",
        evidence: [],
        recoveryRequired: true,
      },
      testExecutor,
    );
    expect(await cluster.database.applicationLock.count()).toBe(1);
    await expect(
      delivery.createDeployment(
        { ...input("retry"), expectedGeneration: 1 },
        testOperator,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await delivery.releaseLock(
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
    expect(await cluster.database.applicationLock.count()).toBe(0);
    const retry = await delivery.createDeployment(
      { ...input("retry"), expectedGeneration: 1 },
      testOperator,
    );
    expect(retry.status).toBe("queued");
  });
  test("automatic reconciliation stops after failure and never calls acceptance green", async () => {
    const automatic = await delivery.reconcile(
      [fixture.environment.id],
      testExecutor,
    );
    expect(automatic.deployments).toHaveLength(1);
    const selected = automatic.deployments[0];
    if (selected === undefined) throw new Error("Automatic request missing");
    await delivery.claim(selected, testExecutor);
    await delivery.finish(
      selected,
      {
        status: "failed",
        message: "preflight rejected",
        evidence: [],
        recoveryRequired: false,
      },
      testExecutor,
    );
    const reconciled = await delivery.reconcile(
      [fixture.environment.id],
      testExecutor,
    );
    const overview = await delivery.overview();
    expect(reconciled.deployments).toEqual([]);
    expect(overview.environments[0]?.acceptedVersionSetRevisionId).toBeNull();
  });
});
