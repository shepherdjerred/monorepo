import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import {
  arcadePipeline,
  arcadeRegistration,
  publishCiRunner,
  requestOnProd,
} from "#testing/model-fixture.ts";
import { publishVerifiedSet } from "#testing/published-set.ts";
import { registerTestService } from "#testing/services.ts";
import {
  requestStackDeployment,
  savedStackPlan,
  startStackPlan,
} from "#testing/tofu-stack-fixture.ts";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";

const context = useDeliveryFixture({ registration: arcadeRegistration });
const operationId = "44444444-4444-4444-8444-444444444444";

/**
 * arcade/prod as a Kubernetes application that declares the shared platform
 * lock, as delivery-control-plane does: admission takes the platform lock
 * with the target lock. The release then ends recovery-required.
 */
async function quarantinedPlatformHolder() {
  await publishCiRunner(context.delivery);
  await context.cluster.database.pipeline.create({
    data: {
      id: "arcade/shared",
      definition: RecipeDefinitionSchema.parse({
        ...recipeFromPipeline(arcadePipeline),
        sharedLock: "platform",
      }),
    },
  });
  await context.cluster.database.environment.update({
    where: { id: "arcade/prod" },
    data: { pipelineRevisionId: "arcade/shared", automatic: false },
  });
  const deployment = await requestOnProd(context, "deploy");
  await context.delivery.claim(deployment.id, testExecutor);
  await context.delivery.stage(
    deployment.id,
    {
      key: "step-sync",
      status: "running",
      operationId,
      message: "Submitted the exact owned sync",
      evidence: [],
    },
    testExecutor,
  );
  await context.delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "Lost the sync response",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  return deployment;
}

test("Argo readback settlement releases the platform lock its holder kept, so a queued platform deployment claims", async () => {
  const holder = await quarantinedPlatformHolder();
  const db = context.cluster.database;
  // Recovery-required keeps every lock, the platform lock included.
  expect(
    await db.platformLock.findUniqueOrThrow({ where: { id: "platform" } }),
  ).toMatchObject({ deploymentId: holder.id });
  const { deployment: stack } = await requestStackDeployment(context);
  // Model tofu claims for read-only step-plan, then answers BUSY at mutating step-apply (AI-907).
  await context.delivery.claim(stack.id, testExecutor);
  const applyOperationId = `delivery-${"b".repeat(40)}`;
  await expect(
    context.delivery.stage(
      stack.id,
      {
        key: "step-apply",
        status: "running",
        operationId: applyOperationId,
        message: "step-apply: running",
        evidence: [],
      },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "BUSY" });

  const detail = await context.delivery.detail(holder.id);
  const intent = await context.delivery.requestRecoveryIntent(
    holder.id,
    {
      requestId: "platform-holder-readback",
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
    [
      {
        kind: "reconciliation",
        operationId,
        summary: "Application operation finished; resourceVersion 12345",
      },
    ],
  );
  const settled = await db.deployment.findUniqueOrThrow({
    where: { id: holder.id },
  });
  expect(settled).toMatchObject({ status: "failed", recoveryRequired: false });
  expect(await db.platformLock.count()).toBe(0);
  expect(
    await db.targetLock.count({ where: { deploymentId: holder.id } }),
  ).toBe(0);

  await context.delivery.stage(
    stack.id,
    {
      key: "step-apply",
      status: "running",
      operationId: applyOperationId,
      message: "step-apply: running",
      evidence: [],
    },
    testExecutor,
  );
  expect(
    await db.platformLock.findUniqueOrThrow({ where: { id: "platform" } }),
  ).toMatchObject({ deploymentId: stack.id });
  expect(
    await db.deployment.findUniqueOrThrow({ where: { id: stack.id } }),
  ).toMatchObject({ status: "running" });
});

test("settlement never releases a platform lock another deployment holds", async () => {
  const holder = await quarantinedPlatformHolder();
  const db = context.cluster.database;
  const { deployment: stack } = await requestStackDeployment(context);
  // Hand the platform lock to the stack deployment so the settling holder
  // no longer owns it.
  await db.platformLock.update({
    where: { id: "platform" },
    data: { deploymentId: stack.id },
  });
  const detail = await context.delivery.detail(holder.id);
  const intent = await context.delivery.requestRecoveryIntent(
    holder.id,
    {
      requestId: "foreign-platform-lock",
      reason: "Independent Application readback of the recorded sync",
      expectedGeneration: detail.environment.generation,
    },
    testOperator,
  );
  await context.delivery.settleArgoIntent(
    intent.id,
    "Independent Application readback of the recorded sync",
    testOperator,
    [{ kind: "reconciliation", operationId, summary: "Settled" }],
  );
  expect(
    await db.platformLock.findUniqueOrThrow({ where: { id: "platform" } }),
  ).toMatchObject({ deploymentId: stack.id });
});

test("delivery-control-plane/prod claims and finishes while a non-self-hosted stack holds the platform lock in quarantine (AI-598)", async () => {
  const db = context.cluster.database;
  const { deployment: stack, buildId } = await requestStackDeployment(context);
  await startStackPlan(context, stack.id);
  const plan = savedStackPlan(stack.id, buildId);
  await context.delivery.recordTofuPlan(plan, testExecutor);
  await context.delivery.stage(
    stack.id,
    {
      key: "step-plan",
      status: "succeeded",
      operationId: plan.receipt.nativeJob.name,
      message: JSON.stringify(plan.receipt.nativeJob),
      evidence: [],
    },
    testExecutor,
  );
  await context.delivery.stage(
    stack.id,
    {
      key: "step-apply",
      status: "running",
      operationId: `delivery-${"c".repeat(40)}`,
      message: "step-apply: running",
      evidence: [],
    },
    testExecutor,
  );

  // Register self-hosted delivery-control-plane/prod with sharedLock: "platform".
  await registerTestService(db, "delivery-control-plane");
  const base = recipeFromPipeline(arcadePipeline);
  if (base.kind !== "kubernetes-application")
    throw new Error("Expected kubernetes-application recipe");
  await db.pipeline.create({
    data: {
      id: "delivery-control-plane/1",
      definition: RecipeDefinitionSchema.parse({
        ...base,
        application: {
          ...base.application,
          name: "delivery-control-plane",
          source:
            "chart" in base.application.source
              ? { ...base.application.source, chart: "delivery-control-plane" }
              : base.application.source,
        },
        chartComponent: "chart:delivery-control-plane",
        artifactParameters: {},
        steps: base.steps.map((step) => ({
          ...step,
          instance: "application:delivery-control-plane",
        })),
        sharedLock: "platform",
        oracle: { ...base.oracle, monitor: undefined },
      }),
    },
  });
  await db.configuration.create({
    data: { id: "delivery-control-plane/1", content: {} },
  });
  await db.environment.create({
    data: {
      id: "delivery-control-plane/prod",
      serviceId: "delivery-control-plane",
      name: "prod",
      application: "delivery-control-plane",
      pipelineRevisionId: "delivery-control-plane/1",
      declaredConfigurationId: "delivery-control-plane/1",
    },
  });
  const { set } = await publishVerifiedSet(context, {
    serviceId: "delivery-control-plane",
    pipelineNumber: 97,
    sourceRevision: "d".repeat(40),
    artifacts: [
      {
        id: "delivery-control-plane/chart",
        component: "chart:delivery-control-plane",
        kind: "chart",
        uri: Object.values(context.fixture.versionSet.components)[0]!.uri,
        version: "1.0.0",
        digest: `sha256:${"d".repeat(64)}`,
      },
    ],
  });
  const controlPlane = await context.delivery.createDeployment(
    {
      requestId: "control-plane/bootstrap-fix",
      environmentId: "delivery-control-plane/prod",
      versionSetRevisionId: set.id,
      expectedGeneration: 0,
      kind: "deploy",
    },
    testOperator,
  );

  // While stack is still running step-apply, delivery-control-plane waits on the dispatch barrier.
  await expect(
    context.delivery.claim(controlPlane.id, testExecutor),
  ).rejects.toMatchObject({ code: "BUSY" });

  // Stack fails in quarantine, keeping PlatformLock and TargetLock.
  await context.delivery.finish(
    stack.id,
    {
      status: "failed",
      message: "Bootstrap failed before recovery could inspect",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  expect(
    await db.platformLock.findUniqueOrThrow({ where: { id: "platform" } }),
  ).toMatchObject({ deploymentId: stack.id });

  // Self-hosted control-plane now claims and finishes while preserving the quarantined stack's locks!
  const claimed = await context.delivery.claim(controlPlane.id, testExecutor);
  expect(claimed.deployment.status).toBe("running");
  expect(
    await db.platformLock.findUniqueOrThrow({ where: { id: "platform" } }),
  ).toMatchObject({ deploymentId: stack.id });

  await context.delivery.finish(
    controlPlane.id,
    {
      status: "succeeded",
      message: "Bootstrap fix shipped",
      observedRevisionId: set.id,
      recoveryRequired: false,
      evidence: [
        { kind: "reconciliation", summary: "synced" },
        { kind: "acceptance", summary: "healthy" },
      ],
    },
    testExecutor,
  );

  // Quarantined stack's PlatformLock, TargetLock, and activeDeploymentId remain intact for recovery.
  expect(
    await db.platformLock.findUniqueOrThrow({ where: { id: "platform" } }),
  ).toMatchObject({ deploymentId: stack.id });
  expect(
    await db.targetLock.findUniqueOrThrow({
      where: { instance: "stack:cloudflare" },
    }),
  ).toMatchObject({ deploymentId: stack.id });
  expect(
    await db.environment.findUniqueOrThrow({
      where: { id: "tofu-cloudflare/prod" },
    }),
  ).toMatchObject({ activeDeploymentId: stack.id });
});
