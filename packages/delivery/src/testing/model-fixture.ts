import { PipelineDefinitionSchema } from "#shared/pipeline-contract.ts";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { RegisterEnvironmentSchema } from "#shared/contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import type { useDeliveryFixture } from "./delivery-fixture.ts";
import { testExecutor, testOperator, testPublisher } from "./seed.ts";

/** The reviewed Arcade registration the model fixtures build recipes from. */
export const arcadePipeline = PipelineDefinitionSchema.parse(
  await Bun.file(
    new URL("../../registrations/arcade.pipeline.json", import.meta.url),
  ).json(),
);
/**
 * arcade/prod as a compound recipe of two Applications: arcade's recipe and
 * the same Application renamed `arcade-server`.
 */
export function arcadeCompoundRecipe() {
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
  return {
    kind: "compound" as const,
    subRecipes: [
      { instance: "application:arcade", definition: companion },
      { instance: "application:arcade-server", definition: server },
    ],
  };
}

export const arcadeRegistration = {
  pipeline: arcadePipeline,
  environment: RegisterEnvironmentSchema.parse(
    await Bun.file(
      new URL("../../registrations/arcade.environment.json", import.meta.url),
    ).json(),
  ),
};

/** The CI runner image model recipes bind by reference (C2). */
export async function publishCiRunner(delivery: Delivery) {
  const build = await delivery.publish(
    {
      requestId: "publish/ci-base",
      serviceId: "ci",
      sourceRevision: "e".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/90",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "ci-base",
          component: "image:ci-base",
          kind: "image",
          uri: "docker.io/shepherdjerred/ci-base",
          version: "1.0.0",
          digest: `sha256:${"e".repeat(64)}`,
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 90 },
  );
  await delivery.qualify(build.buildId, "verified", testExecutor);
}

/** Requests the fixture's set revision on arcade/prod at its current generation. */
export async function requestOnProd(
  context: ReturnType<typeof useDeliveryFixture>,
  kind: "deploy" | "operator-run",
) {
  const env = await context.cluster.database.environment.findUniqueOrThrow({
    where: { id: "arcade/prod" },
  });
  return context.delivery.createDeployment(
    {
      requestId: crypto.randomUUID(),
      environmentId: env.id,
      versionSetRevisionId: context.fixture.versionSet.id,
      expectedGeneration: env.generation,
      kind,
    },
    testOperator,
  );
}
