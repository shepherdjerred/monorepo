import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testOperator, testExecutor } from "#testing/seed.ts";
import { PipelineDefinitionSchema } from "#shared/contract.ts";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { minecraftUpgradeOf } from "#shared/model/recipe-view.ts";
const context = useDeliveryFixture();
const parsed = PipelineDefinitionSchema.parse({
  kind: "argocd",
  application: "minecraft-tsmc",
  namespace: "minecraft-tsmc",
  chartRepository: "https://chartmuseum.tailnet-1a49.ts.net",
  chartName: "minecraft",
  chartComponent: "chart:minecraft",
  parameters: {},
  artifactParameters: {
    "delivery.images.the-storm-server": "image:the-storm-server",
  },
  minecraftUpgrade: {
    imageComponent: "image:the-storm-server",
    runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
  },
});
if (parsed.kind !== "argocd")
  throw new Error("Minecraft fixture requires Argo");
const policy = parsed;

test("Minecraft policy accepts only the reviewed image, fixed destination and immutable runner", async () => {
  expect(policy.minecraftUpgrade?.releaseMode).toBeUndefined();
  expect(policy.minecraftUpgrade).not.toHaveProperty("releaseMode");
  for (const releaseMode of [null, "skip", false])
    expect(
      PipelineDefinitionSchema.safeParse({
        ...policy,
        minecraftUpgrade: { ...policy.minecraftUpgrade, releaseMode },
      }).success,
    ).toBe(false);
  expect(
    PipelineDefinitionSchema.safeParse({
      ...policy,
      minecraftUpgrade: {
        imageComponent: "image:other",
        runnerImage: "ci-base:latest",
      },
    }).success,
  ).toBe(false);
  await expect(
    context.delivery.registerPipeline(
      "minecraft/wrong",
      { ...policy, application: "arcade" },
      testOperator,
    ),
  ).rejects.toMatchObject({ code: "INVALID" });
  await context.delivery.registerPipeline(
    "minecraft/upgrade",
    policy,
    testOperator,
  );
  expect(await context.cluster.database.pipeline.count()).toBe(2);
});

test("explicit retained-volume restart finishes through ordinary reconciliation evidence without manufacturing preservation evidence", async () => {
  const selected = await context.delivery.createDeployment(
    context.input(),
    testOperator,
  );
  await context.delivery.registerPipeline(
    "minecraft/restart",
    {
      ...policy,
      minecraftUpgrade: {
        ...policy.minecraftUpgrade!,
        releaseMode: "retained-volume-restart",
      },
    },
    testOperator,
  );
  // Isolate the same persistence finish boundary as the strict-mode regression.
  await context.cluster.database.deployment.update({
    where: { id: selected.id },
    data: { pipelineRevisionId: "minecraft/restart" },
  });
  await context.delivery.claim(selected.id, testExecutor);
  const evidence = [
    {
      kind: "reconciliation" as const,
      summary: "Owned exact source is Synced and Healthy",
    },
    {
      kind: "acceptance" as const,
      summary: "Exact selected image observed Ready",
    },
  ];
  for (const incomplete of [
    [],
    evidence.filter((entry) => entry.kind !== "acceptance"),
    evidence.filter((entry) => entry.kind !== "reconciliation"),
  ])
    await expect(
      context.delivery.finish(
        selected.id,
        {
          status: "succeeded",
          observedRevisionId: context.fixture.versionSet.id,
          message: "Cannot omit ordinary acceptance",
          recoveryRequired: false,
          evidence: incomplete,
        },
        testExecutor,
      ),
    ).rejects.toThrow("reconciliation and acceptance");
  expect(
    await context.delivery.finish(
      selected.id,
      {
        status: "succeeded",
        observedRevisionId: context.fixture.versionSet.id,
        message: "Retained world volume restarted",
        recoveryRequired: false,
        evidence,
      },
      testExecutor,
    ),
  ).toMatchObject({ status: "succeeded" });
  expect(
    await context.cluster.database.evidence.count({
      where: { deploymentId: selected.id, kind: "backup" },
    }),
  ).toBe(0);
});

test("TSMC rollback restores only an accepted selection and never another service's set", async () => {
  await context.delivery.registerPipeline(
    "minecraft/ordinary",
    { kind: "manual", reason: "Unverified legacy pipeline" },
    testOperator,
  );
  const env = await context.delivery.registerEnvironment(
    {
      id: "minecraft/tsmc",
      serviceId: "minecraft",
      name: "tsmc",
      application: "minecraft-tsmc",
      pipelineRevisionId: "minecraft/ordinary",
      configurationRevision: "config/1",
      configuration: {},
      automatic: false,
    },
    testOperator,
  );
  // Rollback restores only a previously accepted selection (V2); past a
  // pointOfNoReturn step it is refused as data (D9), never by service id.
  await expect(
    context.delivery.createDeployment(
      {
        requestId: "minecraft/no-blind-rollback",
        environmentId: env.id,
        expectedGeneration: env.generation,
        selectionDeploymentId: "never-accepted",
        kind: "rollback",
      },
      testOperator,
    ),
  ).rejects.toThrow(/was never accepted in minecraft\/tsmc/u);
  await expect(
    context.delivery.createDeployment(
      {
        requestId: "minecraft/no-generic-execution",
        environmentId: env.id,
        expectedGeneration: env.generation,
        versionSetRevisionId: context.fixture.versionSet.id,
        kind: "deploy",
      },
      testOperator,
    ),
  ).rejects.toThrow("Version set belongs to another service");
  expect(await context.cluster.database.deployment.count()).toBe(0);
});

test("Minecraft finish does not require a backup or restored copy", async () => {
  const selected = await context.delivery.createDeployment(
    context.input(),
    testOperator,
  );
  await context.delivery.registerPipeline(
    "minecraft/upgrade",
    policy,
    testOperator,
  );
  await context.cluster.database.deployment.update({
    where: { id: selected.id },
    data: { pipelineRevisionId: "minecraft/upgrade" },
  });
  await context.delivery.claim(selected.id, testExecutor);
  expect(
    await context.delivery.finish(
      selected.id,
      {
        status: "succeeded",
        observedRevisionId: context.fixture.versionSet.id,
        message: "Exact runtime observed",
        recoveryRequired: false,
        evidence: [
          { kind: "reconciliation", summary: "Observed" },
          { kind: "acceptance", summary: "Observed" },
        ],
      },
      testExecutor,
    ),
  ).toMatchObject({ status: "succeeded" });
});

test("an omitted Minecraft mode adapts to a retained-volume restart after sync", () => {
  const recipe = recipeFromPipeline(policy);
  expect(recipe.kind).toBe("kubernetes-application");
  if (recipe.kind !== "kubernetes-application")
    throw new Error("Expected a kubernetes application recipe");
  expect(minecraftUpgradeOf(recipe)).toMatchObject({
    releaseMode: "retained-volume-restart",
  });
  const kinds = recipe.steps.map((step) => step.kind);
  expect(kinds.indexOf("minecraft-upgrade")).toBeGreaterThan(
    kinds.indexOf("sync"),
  );
});
