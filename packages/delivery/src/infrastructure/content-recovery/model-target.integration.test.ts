import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { contentRecoveryCatalog } from "#testing/content-recovery-fixture.ts";
import { applicationRecipe, registration } from "#testing/catalog-fixture.ts";
import { testOperator, testPublisher } from "#testing/seed.ts";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";

const scope = useDeliveryFixture({ catalog: contentRecoveryCatalog });

const siteStep = {
  kind: "static-site",
  instance: "bucket:arcade-site",
  policy: {
    archiveComponent: "archive:arcade-site",
    bucket: "arcade-site",
    verification: { url: "https://arcade.sjer.red/", expectedStatus: 200 },
  },
};

/** A model recipe's site step: its bucket is the content target. */
async function siteApplication() {
  return applicationRecipe("arcade", [siteStep]);
}

/** A compound whose site step is in its second Application. */
async function siteCompound() {
  return {
    kind: "compound",
    subRecipes: [
      {
        instance: "application:arcade-search",
        definition: applicationRecipe("arcade-search"),
      },
      { instance: "application:arcade", definition: await siteApplication() },
    ],
  };
}

/** A compound whose forum Application is second (not the primary one). */
async function forumCompound() {
  const [search, forum] = await Promise.all([
    registration("arcade.pipeline.json", {
      application: "storm-forum-search",
      namespace: "storm-forum-search",
    }),
    registration("specialized/storm-forum/pipeline.json"),
  ]);
  return {
    kind: "compound",
    subRecipes: [
      { instance: "application:storm-forum-search", definition: search },
      { instance: "application:storm-forum", definition: forum },
    ],
  };
}

/**
 * A failed release of `recipe` that still holds its environment and the
 * native target lock, as a model step leaves it after an ambiguous effect.
 */
async function heldRelease(id: string, recipe: unknown, held: string) {
  const db = scope.cluster.database;
  const env = await db.environment.findUniqueOrThrow({
    where: { id: scope.fixture.environment.id },
  });
  await db.pipeline.create({
    data: {
      id: `${id}/recipe`,
      definition: RecipeDefinitionSchema.parse(recipe),
    },
  });
  await db.deployment.create({
    data: {
      id,
      requestId: id,
      environmentId: env.id,
      serviceId: env.serviceId,
      versionSetRevisionId: scope.fixture.versionSet.id,
      pipelineRevisionId: `${id}/recipe`,
      configurationId: env.declaredConfigurationId,
      catalogRevision: "test",
      expectedGeneration: env.generation,
      kind: "deploy",
      status: "failed",
      recoveryRequired: true,
      requestedBy: testPublisher.id,
      finishedAt: new Date(),
    },
  });
  await db.environment.update({
    where: { id: env.id },
    data: { activeDeploymentId: id },
  });
  await db.targetLock.create({ data: { instance: held, deploymentId: id } });
  return env.generation;
}

test.each([
  [
    "an Application's site step",
    siteApplication,
    "bucket:arcade-site",
    "static-site",
  ],
  [
    "a compound's second-Application site step",
    siteCompound,
    "bucket:arcade-site",
    "static-site",
  ],
  [
    "a compound's second-Application forum",
    forumCompound,
    "application:storm-forum",
    "forum",
  ],
] as const)(
  "content recovery of %s targets its held native lock (4.15)",
  async (_shape, recipe, target, targetKind) => {
    const id = `model-content-${targetKind}-${crypto.randomUUID()}`;
    const generation = await heldRelease(id, await recipe(), target);
    const intent = await scope.delivery.requestContentRecovery(
      id,
      {
        requestId: `${id}/recovery`,
        expectedEnvironmentGeneration: generation,
        reason: "Independently inspect the model release's ambiguous content",
      },
      testOperator,
    );
    expect(intent).toMatchObject({
      deploymentId: id,
      status: "pending",
      targetKind,
    });
    const context = await scope.delivery.contentRecovery(
      intent.id,
      testOperator,
    );
    expect(context.intent.id).toBe(intent.id);
  },
);

test("content recovery refuses a model release that no longer holds its content target lock", async () => {
  const id = `model-content-unheld-${crypto.randomUUID()}`;
  const generation = await heldRelease(
    id,
    await siteApplication(),
    "application:arcade",
  );
  await expect(
    scope.delivery.requestContentRecovery(
      id,
      {
        requestId: `${id}/recovery`,
        expectedEnvironmentGeneration: generation,
        reason: "Independently inspect the model release's ambiguous content",
      },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
