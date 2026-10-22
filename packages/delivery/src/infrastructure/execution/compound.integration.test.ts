import { expect, test } from "vitest";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor } from "#testing/seed.ts";
import {
  arcadePipeline,
  arcadeRegistration,
  publishCiRunner,
  requestOnProd,
} from "#testing/model-fixture.ts";

const context = useDeliveryFixture({ registration: arcadeRegistration });

/** arcade/prod deploys two Applications as one compound recipe. */
async function compoundDeployment() {
  await publishCiRunner(context.delivery);
  const companion = recipeFromPipeline(arcadePipeline);
  if (companion.kind !== "kubernetes-application")
    throw new Error("arcade converts to a Kubernetes application recipe");
  const server = {
    ...companion,
    application: { ...companion.application, name: "arcade-server" },
    steps: companion.steps.map((step) => ({
      ...step,
      instance: "application:arcade-server",
    })),
  };
  await context.cluster.database.pipeline.create({
    data: {
      id: "arcade/5",
      definition: {
        kind: "compound",
        subRecipes: [
          { instance: "application:arcade", definition: companion },
          { instance: "application:arcade-server", definition: server },
        ],
      },
    },
  });
  await context.cluster.database.environment.update({
    where: { id: "arcade/prod" },
    data: { pipelineRevisionId: "arcade/5", automatic: false },
  });
  return requestOnProd(context, "deploy");
}

test("a compound deployment holds one lease and the lock of every sub-recipe instance (T1, T3)", async () => {
  const deployment = await compoundDeployment();
  await context.delivery.claim(deployment.id, testExecutor);
  const locks = await context.cluster.database.targetLock.findMany({
    where: { deploymentId: deployment.id },
    orderBy: { instance: "asc" },
  });
  expect(locks.map((lock) => lock.instance)).toEqual([
    "application:arcade",
    "application:arcade-server",
  ]);
  const env = await context.cluster.database.environment.findUniqueOrThrow({
    where: { id: "arcade/prod" },
  });
  expect(env.activeDeploymentId).toBe(deployment.id);
  const detail = await context.delivery.detail(deployment.id);
  expect(detail.deployment.status).toBe("running");
});
