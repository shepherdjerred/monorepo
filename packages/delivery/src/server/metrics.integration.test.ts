import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { requestStackDeployment } from "#testing/tofu-stack-fixture.ts";
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

test("the platform lock gauge names its holder's status, so a stranded lock is visible", async () => {
  const database = context.cluster.database;
  const { deployment } = await requestStackDeployment(context);
  expect(await deliveryMetrics(database)).not.toContain(
    "delivery_platform_lock_held_seconds{",
  );
  await context.delivery.claim(deployment.id, testExecutor);
  expect(await deliveryMetrics(database)).toMatch(
    /delivery_platform_lock_held_seconds\{environment="tofu-cloudflare\/prod",service_id="tofu-cloudflare",holder_status="running",recovery_required="false",producer_barrier="false"\} [\d.]+\n/u,
  );
  await context.delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "Failed before any external effect",
      recoveryRequired: false,
      evidence: [],
    },
    testExecutor,
  );
  expect(await database.platformLock.count()).toBe(0);
  // The lock a settled, failed holder kept before AI-417's fix.
  await database.platformLock.create({
    data: {
      id: "platform",
      deploymentId: deployment.id,
      createdAt: new Date(Date.now() - 3_600_000),
    },
  });
  const stranded = await deliveryMetrics(database);
  const age =
    /delivery_platform_lock_held_seconds\{environment="tofu-cloudflare\/prod",service_id="tofu-cloudflare",holder_status="failed",recovery_required="false",producer_barrier="false"\} ([\d.]+)\n/u.exec(
      stranded,
    )?.[1];
  expect(Number(age)).toBeGreaterThanOrEqual(3595);
  expect(Number(age)).toBeLessThan(3660);
  expect(stranded).not.toContain(deployment.id);
});

test("timestamp gauges anchor naive UTC columns in non-UTC sessions and clamp future clock skew to zero", async () => {
  const database = context.cluster.database;
  const twoMinutesAgo = new Date(Date.now() - 120_000);
  const queued = await context.delivery.createDeployment(
    context.input("deploy/tz-queued"),
    testOperator,
  );
  await database.deployment.update({
    where: { id: queued.id },
    data: { createdAt: twoMinutesAgo },
  });
  await database.outbox.update({
    where: { deploymentId: queued.id },
    data: { createdAt: twoMinutesAgo },
  });

  const { deployment: stack } = await requestStackDeployment(context);
  await context.delivery.claim(stack.id, testExecutor);
  await database.targetLock.updateMany({
    where: { deploymentId: stack.id },
    data: { acquiredAt: twoMinutesAgo },
  });
  await database.platformLock.update({
    where: { id: "platform" },
    data: { createdAt: twoMinutesAgo },
  });
  const stackDetail = await context.delivery.detail(stack.id);
  await context.delivery.finish(
    stack.id,
    {
      status: "failed",
      message: "Quarantined for timezone and barrier metric test",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const barrierIntent = await database.recoveryIntent.create({
    data: {
      id: "content/barrier/tz",
      kind: "content",
      deploymentId: stack.id,
      sequence: 1,
      requestedBy: testOperator.id,
      reason: "Journaled content producer barrier for metric verification",
      expectedGeneration: stackDetail.environment.generation,
      fingerprint: `sha256:${"a".repeat(64)}`,
      status: "succeeded",
      finishedAt: twoMinutesAgo,
      barrier: {
        adapter: "control-plane-dispatch-barrier/v1",
        deploymentUID: "uid-1",
        templateFingerprint: "b".repeat(64),
        priorReplicas: 1,
        podUIDs: [],
        replicaSetUIDs: [],
      },
      barrierRestoredAt: null,
      createdAt: twoMinutesAgo,
    },
  });

  // Settled intent holding an unrestored producer barrier still surfaces in --pending.
  const pendingIntents = await context.delivery.pendingRecoveryIntents();
  expect(pendingIntents).toEqual([
    expect.objectContaining({
      id: barrierIntent.id,
      outcome: "succeeded",
      producerBarrierHeld: true,
    }),
  ]);

  const pacific = await database.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL TimeZone = 'America/Los_Angeles'`;
    return await deliveryMetrics(tx);
  });
  for (const pattern of [
    /delivery_outbox_oldest_seconds ([\d.]+)/u,
    /delivery_queued_oldest_seconds\{environment="arcade\/prod"\} ([\d.]+)/u,
    /delivery_application_lock_oldest_seconds ([\d.]+)/u,
    /delivery_platform_lock_held_seconds\{[^}]+\} ([\d.]+)/u,
    /delivery_content_barrier_held_seconds\{environment="tofu-cloudflare\/prod",service_id="tofu-cloudflare",intent_status="succeeded"\} ([\d.]+)/u,
  ]) {
    const measured = Number(pattern.exec(pacific)?.[1]);
    expect(measured).toBeGreaterThanOrEqual(115);
    expect(measured).toBeLessThan(180);
  }

  const fiveSecondsAhead = new Date(Date.now() + 5000);
  await database.deployment.update({
    where: { id: queued.id },
    data: { createdAt: fiveSecondsAhead },
  });
  await database.outbox.update({
    where: { deploymentId: queued.id },
    data: { createdAt: fiveSecondsAhead },
  });
  await database.targetLock.updateMany({
    where: { deploymentId: stack.id },
    data: { acquiredAt: fiveSecondsAhead },
  });
  await database.platformLock.update({
    where: { id: "platform" },
    data: { createdAt: fiveSecondsAhead },
  });
  await database.recoveryIntent.update({
    where: { id: barrierIntent.id },
    data: { createdAt: fiveSecondsAhead },
  });

  const skewed = await deliveryMetrics(database);
  expect(skewed).toContain("delivery_outbox_oldest_seconds 0\n");
  expect(skewed).toContain(
    'delivery_queued_oldest_seconds{environment="arcade/prod"} 0\n',
  );
  expect(skewed).toContain("delivery_application_lock_oldest_seconds 0\n");
  expect(skewed).toContain(
    'delivery_platform_lock_held_seconds{environment="tofu-cloudflare/prod",service_id="tofu-cloudflare",holder_status="failed",recovery_required="true",producer_barrier="true"} 0\n',
  );
  expect(skewed).toContain(
    'delivery_content_barrier_held_seconds{environment="tofu-cloudflare/prod",service_id="tofu-cloudflare",intent_status="succeeded"} 0\n',
  );

  await database.recoveryIntent.update({
    where: { id: barrierIntent.id },
    data: { barrierRestoredAt: new Date() },
  });
  expect(await deliveryMetrics(database)).not.toContain(
    "delivery_content_barrier_held_seconds{",
  );
  expect(await context.delivery.pendingRecoveryIntents()).toEqual([]);
});
