import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import {
  arcadePipeline,
  arcadeRegistration,
  publishCiRunner,
  requestOnProd,
} from "#testing/model-fixture.ts";
import { requestStackDeployment } from "#testing/tofu-stack-fixture.ts";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";
import { deliveryMetrics } from "#server/metrics.ts";
import { STALE_OWNERSHIP_RELEASED } from "./terminal-ownership.ts";

const context = useDeliveryFixture({ registration: arcadeRegistration });
const operationId = "55555555-5555-4555-8555-555555555555";

/** arcade/prod under `recipe`, with automatic selection off. */
async function bindArcade(recipe: unknown) {
  await publishCiRunner(context.delivery);
  await context.cluster.database.pipeline.create({
    data: {
      id: "arcade/terminal",
      definition: RecipeDefinitionSchema.parse(recipe),
    },
  });
  await context.cluster.database.environment.update({
    where: { id: "arcade/prod" },
    data: { pipelineRevisionId: "arcade/terminal", automatic: false },
  });
}

/** Ownership any deployment of arcade/prod can hold. */
async function arcadeOwnership() {
  const db = context.cluster.database;
  const [targetLocks, platformLock, environment] = await Promise.all([
    db.targetLock.findMany({ select: { instance: true, deploymentId: true } }),
    db.platformLock.findUnique({ where: { id: "platform" } }),
    db.environment.findUniqueOrThrow({ where: { id: "arcade/prod" } }),
  ]);
  return {
    targetLocks,
    platformLock: platformLock?.deploymentId ?? null,
    active: environment.activeDeploymentId,
  };
}

async function runningStage(deploymentId: string) {
  await context.delivery.stage(
    deploymentId,
    {
      key: "step-sync",
      status: "running",
      operationId,
      message: "Submitted the exact owned sync",
      evidence: [],
    },
    testExecutor,
  );
}

async function settleByReadback(deploymentId: string, requestId: string) {
  const detail = await context.delivery.detail(deploymentId);
  const intent = await context.delivery.requestRecoveryIntent(
    deploymentId,
    {
      requestId,
      reason: "Independent Application readback of the recorded sync",
      expectedGeneration: detail.environment.generation,
    },
    testOperator,
  );
  expect(intent.kind).toBe("argo");
  await context.delivery.settleArgoIntent(
    intent.id,
    "Independent Application readback of the recorded sync",
    testOperator,
    [{ kind: "reconciliation", operationId, summary: "Settled" }],
  );
}

test("a running operator-run platform holder canceled and then settled releases the platform lock", async () => {
  // cluster-admission's shape: an operator-run recipe wrapping an
  // Application that declares the shared platform lock.
  await bindArcade({
    kind: "operator-run",
    wrapped: { ...recipeFromPipeline(arcadePipeline), sharedLock: "platform" },
    stages: ["admission"],
  });
  const deployment = await requestOnProd(context, "operator-run");
  await context.delivery.claim(deployment.id, testExecutor);
  await runningStage(deployment.id);
  const canceled = await context.delivery.cancel(deployment.id, testOperator);
  // Cancellation of a running deployment is only a request (D4).
  expect(canceled).toMatchObject({ status: "running", cancelRequested: true });
  expect(await arcadeOwnership()).toMatchObject({
    platformLock: deployment.id,
    active: deployment.id,
  });
  await context.delivery.finish(
    deployment.id,
    {
      status: "canceled",
      message: "Canceled with the sync result unknown",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  // Recovery-required keeps every row, and the sweep leaves it alone.
  await context.delivery.reconcile([], testExecutor);
  expect(await arcadeOwnership()).toEqual({
    targetLocks: [
      { instance: "application:arcade", deploymentId: deployment.id },
    ],
    platformLock: deployment.id,
    active: deployment.id,
  });

  await settleByReadback(deployment.id, "canceled-operator-run");
  expect(
    await context.cluster.database.deployment.findUniqueOrThrow({
      where: { id: deployment.id },
    }),
  ).toMatchObject({ status: "canceled", recoveryRequired: false });
  expect(await arcadeOwnership()).toEqual({
    targetLocks: [],
    platformLock: null,
    active: null,
  });
  // A platform deployment that waited on the lock now claims it.
  const { deployment: stack } = await requestStackDeployment(context);
  await context.delivery.claim(stack.id, testExecutor);
  expect(
    await context.cluster.database.platformLock.findUniqueOrThrow({
      where: { id: "platform" },
    }),
  ).toMatchObject({ deploymentId: stack.id });
});

test("settling a recovery-required deployment releases its target locks and active pointer, so the next claims", async () => {
  await bindArcade(recipeFromPipeline(arcadePipeline));
  const first = await requestOnProd(context, "deploy");
  await context.delivery.claim(first.id, testExecutor);
  await runningStage(first.id);
  await context.delivery.finish(
    first.id,
    {
      status: "failed",
      message: "Lost the sync response",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  // The quarantined owner refuses the next request (D5).
  await expect(requestOnProd(context, "deploy")).rejects.toMatchObject({
    code: "CONFLICT",
  });

  await settleByReadback(first.id, "settled-target-owner");
  expect(await arcadeOwnership()).toEqual({
    targetLocks: [],
    platformLock: null,
    active: null,
  });
  const next = await requestOnProd(context, "deploy");
  await context.delivery.claim(next.id, testExecutor);
  expect(await arcadeOwnership()).toEqual({
    targetLocks: [{ instance: "application:arcade", deploymentId: next.id }],
    platformLock: null,
    active: next.id,
  });
});

test("the dispatch sweep releases ownership a settled deployment kept, audits and counts it, and never touches a running or recovery-required holder", async () => {
  const db = context.cluster.database;
  await bindArcade(recipeFromPipeline(arcadePipeline));
  const quarantined = await requestOnProd(context, "deploy");
  await context.delivery.claim(quarantined.id, testExecutor);
  await runningStage(quarantined.id);
  await context.delivery.finish(
    quarantined.id,
    {
      status: "failed",
      message: "Lost the sync response",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const { deployment: stack } = await requestStackDeployment(context);
  await context.delivery.claim(stack.id, testExecutor);
  const held = async () => {
    const [targetLocks, platformLock, environments] = await Promise.all([
      db.targetLock.findMany({
        select: { instance: true, deploymentId: true },
        orderBy: { instance: "asc" },
      }),
      db.platformLock.findUnique({ where: { id: "platform" } }),
      db.environment.findMany({
        where: { activeDeploymentId: { not: null } },
        select: { id: true, activeDeploymentId: true },
      }),
    ]);
    return {
      targetLocks,
      platformLock: platformLock?.deploymentId ?? null,
      active: Object.fromEntries(
        environments.map((row) => [row.id, row.activeDeploymentId]),
      ),
    };
  };
  const owned = {
    targetLocks: [
      { instance: "application:arcade", deploymentId: quarantined.id },
      { instance: "stack:cloudflare", deploymentId: stack.id },
    ],
    platformLock: stack.id,
    active: {
      "arcade/prod": quarantined.id,
      "tofu-cloudflare/prod": stack.id,
    },
  };
  expect(await held()).toEqual(owned);
  const idle = await context.delivery.reconcile([], testExecutor);
  expect(idle).not.toHaveProperty("ownershipReleased");
  expect(await held()).toEqual(owned);

  // The stack ends failed and settled, but a path that did not release
  // leaves every kind of ownership behind (AI-417, AI-423).
  await context.delivery.finish(
    stack.id,
    {
      status: "failed",
      message: "Failed before any external effect",
      recoveryRequired: false,
      evidence: [],
    },
    testExecutor,
  );
  await db.targetLock.create({
    data: { instance: "stack:cloudflare", deploymentId: stack.id },
  });
  await db.platformLock.create({
    data: { id: "platform", deploymentId: stack.id },
  });
  await db.environment.update({
    where: { id: "tofu-cloudflare/prod" },
    data: { activeDeploymentId: stack.id },
  });
  expect(await held()).toEqual(owned);
  expect(await deliveryMetrics(db)).toContain(
    'delivery_stale_ownership_released_total{kind="platform_lock"} 0\n',
  );

  const swept = await context.delivery.reconcile([], testExecutor);
  expect(swept.ownershipReleased).toEqual([
    { deploymentId: stack.id, kind: "target_lock", name: "stack:cloudflare" },
    { deploymentId: stack.id, kind: "platform_lock", name: "platform" },
    {
      deploymentId: stack.id,
      kind: "active_deployment",
      name: "tofu-cloudflare/prod",
    },
  ]);
  expect(await held()).toEqual({
    targetLocks: [
      { instance: "application:arcade", deploymentId: quarantined.id },
    ],
    platformLock: null,
    active: { "arcade/prod": quarantined.id },
  });
  expect(
    await db.audit.findMany({
      where: { action: STALE_OWNERSHIP_RELEASED },
      select: { entityId: true, metadata: true },
      orderBy: { occurredAt: "asc" },
    }),
  ).toEqual(
    expect.arrayContaining([
      {
        entityId: stack.id,
        metadata: { kind: "platform_lock", name: "platform", status: "failed" },
      },
    ]),
  );
  const metrics = await deliveryMetrics(db);
  expect(metrics).toContain(
    "# TYPE delivery_stale_ownership_released_total counter",
  );
  for (const kind of ["target_lock", "platform_lock", "active_deployment"])
    expect(metrics).toContain(
      `delivery_stale_ownership_released_total{kind="${kind}"} 1\n`,
    );
  // Released once: the next tick finds nothing.
  expect(await context.delivery.reconcile([], testExecutor)).not.toHaveProperty(
    "ownershipReleased",
  );
});

test("the sweep keeps a settled content recovery's journaled producer barrier", async () => {
  const db = context.cluster.database;
  const { deployment: stack } = await requestStackDeployment(context);
  await context.delivery.claim(stack.id, testExecutor);
  await context.delivery.finish(
    stack.id,
    {
      status: "failed",
      message: "Failed before any external effect",
      recoveryRequired: false,
      evidence: [],
    },
    testExecutor,
  );
  // The platform lock as a content recovery's producer barrier, which only
  // the observed producer restoration releases.
  await db.platformLock.create({
    data: { id: "platform", deploymentId: stack.id },
  });
  await db.recoveryIntent.create({
    data: {
      id: "content/barrier",
      kind: "content",
      deploymentId: stack.id,
      sequence: 1,
      requestedBy: testOperator.id,
      reason: "Producer stopped",
      expectedGeneration: 0,
      fingerprint: `sha256:${"b".repeat(64)}`,
      status: "succeeded",
      barrier: { deploymentUID: "uid" },
    },
  });
  const swept = await context.delivery.reconcile([], testExecutor);
  expect(swept).not.toHaveProperty("ownershipReleased");
  expect(
    await db.platformLock.findUniqueOrThrow({ where: { id: "platform" } }),
  ).toMatchObject({ deploymentId: stack.id });
});
