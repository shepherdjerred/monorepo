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
  await expect(
    context.delivery.claim(stack.id, testExecutor),
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

  await context.delivery.claim(stack.id, testExecutor);
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
