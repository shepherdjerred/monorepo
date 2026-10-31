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
  const wait =
    /delivery_queued_oldest_seconds\{environment="arcade\/prod"\} ([\d.]+)/u.exec(
      queued,
    )?.[1];
  expect(Number(wait)).toBeGreaterThanOrEqual(115);
  expect(Number(wait)).toBeLessThan(180);
  expect(queued).toContain("delivery_application_locks 0\n");
  expect(queued).not.toContain("delivery_recovery_required_deployments{");

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
  expect(failed).toContain(
    'delivery_recovery_required_deployments{environment="arcade/prod",service_id="arcade",self_hosted="false"} 1\n',
  );
  expect(failed).not.toContain("delivery_queued_oldest_seconds{");
  expect(failed).toContain("delivery_outbox_pending 0\n");
  expect(failed).not.toContain(deployment.id);
  expect(failed).not.toContain(testOperator.id);
});

test("supersession neither restarts the queued wait nor outlives the next claim", async () => {
  const database = context.cluster.database;
  const environment = context.fixture.environment.id;
  const first = await context.delivery.reconcile([environment], testExecutor);
  const oldId = first.deployments[0];
  if (oldId === undefined) throw new Error("Automatic selection missing");
  const anHourAgo = new Date(Date.now() - 3_600_000);
  await database.deployment.update({
    where: { id: oldId },
    data: { createdAt: anHourAgo },
  });
  await database.outbox.update({
    where: { deploymentId: oldId },
    data: { createdAt: anHourAgo },
  });
  await context.publishVerified(2);
  const second = await context.delivery.reconcile([environment], testExecutor);
  const newId = second.deployments[0];
  if (newId === undefined) throw new Error("Superseding selection missing");
  const old = await context.delivery.detail(oldId);
  expect(old.deployment.status).toBe("canceled");
  const waiting = await deliveryMetrics(database);
  const wait =
    /delivery_queued_oldest_seconds\{environment="arcade\/prod"\} ([\d.]+)/u.exec(
      waiting,
    )?.[1];
  expect(Number(wait)).toBeGreaterThanOrEqual(3595);
  expect(Number(wait)).toBeLessThan(3660);
  expect(waiting).toContain(
    "# TYPE delivery_deployments_superseded_total counter",
  );
  expect(waiting).toContain(
    'delivery_deployments_superseded_total{environment="arcade/prod"} 1\n',
  );

  // The claim serves the environment, so the earlier supersession no longer
  // counts toward a later request's wait.
  await context.delivery.claim(newId, testExecutor);
  expect(await deliveryMetrics(database)).not.toContain(
    "delivery_queued_oldest_seconds{",
  );
  await context.delivery.finish(
    newId,
    {
      status: "failed",
      message: "Failed before any external effect",
      recoveryRequired: false,
      evidence: [],
    },
    testExecutor,
  );
  await context.delivery.createDeployment(
    context.input("deploy/after-claim"),
    testOperator,
  );
  const served = await deliveryMetrics(database);
  const fresh =
    /delivery_queued_oldest_seconds\{environment="arcade\/prod"\} ([\d.]+)/u.exec(
      served,
    )?.[1];
  expect(Number(fresh)).toBeLessThan(60);
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
