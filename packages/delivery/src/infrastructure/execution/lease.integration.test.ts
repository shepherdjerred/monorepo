import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";

const context = useDeliveryFixture();

test("a lapsed lease takes no stage, renewal, finish or claim; the lease scan ends it in recovery (D7)", async () => {
  const env = await context.cluster.database.environment.findUniqueOrThrow({
    where: { id: context.fixture.environment.id },
  });
  const deployment = await context.delivery.createDeployment(
    {
      requestId: "lapsed-lease",
      environmentId: env.id,
      versionSetRevisionId: context.fixture.versionSet.id,
      expectedGeneration: env.generation,
      kind: "deploy",
    },
    testOperator,
  );
  const owner = { workflowId: "delivery/owner", workflowRunId: "run-1" };
  await context.delivery.claim(deployment.id, testExecutor, undefined, owner);
  await context.cluster.database.deployment.update({
    where: { id: deployment.id },
    data: { leaseExpiresAt: new Date(Date.now() - 1000) },
  });
  const lapsed = /lease lapsed/u;
  await expect(
    context.delivery.stage(
      deployment.id,
      {
        key: "step-sync",
        status: "running",
        operationId: "sync-1",
        message: "Syncing",
        evidence: [],
      },
      testExecutor,
    ),
  ).rejects.toThrow(lapsed);
  await expect(
    context.delivery.renewLease(deployment.id, owner, testExecutor),
  ).rejects.toThrow(lapsed);
  await expect(
    context.delivery.claim(deployment.id, testExecutor, undefined, owner),
  ).rejects.toThrow(lapsed);
  await expect(
    context.delivery.finish(
      deployment.id,
      {
        status: "succeeded",
        message: "Released",
        recoveryRequired: false,
        evidence: [],
      },
      testExecutor,
    ),
  ).rejects.toThrow(lapsed);
  // An anonymous fence of the lapsed deployment is refused too.
  await expect(
    context.delivery.claim(deployment.id, testExecutor),
  ).rejects.toThrow(lapsed);
  expect(
    await context.cluster.database.stage.count({
      where: { deploymentId: deployment.id },
    }),
  ).toBe(0);
  const scanned = await context.delivery.reconcile([], testExecutor);
  expect(scanned.leasesExpired).toEqual([deployment.id]);
  expect(
    await context.cluster.database.deployment.findUniqueOrThrow({
      where: { id: deployment.id },
    }),
  ).toMatchObject({ status: "failed", recoveryRequired: true });
});
