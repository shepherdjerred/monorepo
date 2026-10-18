import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { deliveryMetrics } from "./metrics.ts";

const context = useDeliveryFixture();

test("queue and ownership gauges follow persisted state and exclude terminal submissions", async () => {
  const deployment = await context.delivery.createDeployment(
    context.input(),
    testOperator,
  );
  await context.cluster.database.outbox.update({
    where: { deploymentId: deployment.id },
    data: { createdAt: new Date(Date.now() - 120_000) },
  });
  const queued = await deliveryMetrics(context.cluster.database);
  expect(queued).toContain(
    'delivery_deployments{status="queued",kind="deploy"} 1',
  );
  expect(queued).toContain("delivery_outbox_pending 1\n");
  const age = /delivery_outbox_oldest_seconds ([\d.]+)/u.exec(queued)?.[1];
  expect(Number(age)).toBeGreaterThanOrEqual(115);
  expect(Number(age)).toBeLessThan(180);
  expect(queued).toContain("delivery_application_locks 0\n");

  await context.delivery.claim(deployment.id, testExecutor);
  await context.delivery.stage(
    deployment.id,
    {
      key: "reconcile",
      status: "running",
      operationId: "metrics-owned-operation",
      message: "External intent recorded",
      evidence: [],
    },
    testExecutor,
  );
  await context.delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "External result requires independent recovery",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  // Query again using durable state, with no in-process increment/decrement.
  const failed = await deliveryMetrics(context.cluster.database);
  expect(failed).toContain(
    'delivery_deployments{status="failed",kind="deploy"} 1',
  );
  expect(failed).toContain("delivery_application_locks 1\n");
  expect(failed).toContain("delivery_recovery_required 1\n");
  expect(failed).toContain("delivery_outbox_pending 0\n");
  expect(failed).not.toContain(deployment.id);
  expect(failed).not.toContain(testOperator.id);
});

test("unknown persisted operation states fail the scrape instead of creating arbitrary metric labels", async () => {
  const deployment = await context.delivery.createDeployment(
    context.input(),
    testOperator,
  );
  await context.cluster.database.deployment.update({
    where: { id: deployment.id },
    data: { status: "invalid-persisted-state" },
  });
  await expect(deliveryMetrics(context.cluster.database)).rejects.toThrow();
});
