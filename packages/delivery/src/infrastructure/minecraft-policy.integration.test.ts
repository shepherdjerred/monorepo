import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testOperator, testExecutor } from "#testing/seed.ts";
import { PipelineDefinitionSchema } from "#shared/contract.ts";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { minecraftUpgradeOf } from "#shared/model/recipe-view.ts";
import { specializedOperationId } from "./specialized-success.ts";

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

test("Minecraft finish requires backup evidence on the same completed preservation attempt, never a safe deferral", async () => {
  const selected = await context.delivery.createDeployment(
    context.input(),
    testOperator,
  );
  await context.delivery.registerPipeline(
    "minecraft/upgrade",
    policy,
    testOperator,
  );
  // Isolate the persistence finish boundary without activating the guarded TSMC adapter.
  await context.cluster.database.deployment.update({
    where: { id: selected.id },
    data: { pipelineRevisionId: "minecraft/upgrade" },
  });
  await context.delivery.claim(selected.id, testExecutor);
  const operationId = specializedOperationId(
    `${selected.id}:minecraft-preservation`,
  );
  const finish = {
    status: "succeeded" as const,
    observedRevisionId: context.fixture.versionSet.id,
    message: "Exact runtime observed",
    recoveryRequired: false,
    evidence: [
      { kind: "reconciliation" as const, summary: "Observed" },
      { kind: "acceptance" as const, summary: "Observed" },
    ],
  };
  await context.delivery.stage(
    selected.id,
    {
      key: "minecraft-preservation-0",
      status: "succeeded",
      operationId,
      message: "A late player arrival safely deferred preservation",
      evidence: [
        {
          kind: "preflight",
          operationId,
          summary: "Deferred; no backup was created",
        },
      ],
    },
    testExecutor,
  );
  await expect(
    context.delivery.finish(selected.id, finish, testExecutor),
  ).rejects.toThrow("player deferral");
  const backup = {
    kind: "backup" as const,
    operationId,
    summary: JSON.stringify({
      producer: "storm-independent-restore",
      receiptSha256: `sha256:${"a".repeat(64)}`,
      backupUid: "backup-uid",
      restoreUid: "restore-uid",
      source: { claimUid: "source-pvc" },
      restored: { claimUid: "independent-pvc" },
      wholeVolumeProofSha256: "b".repeat(64),
      originalUntouchedProofSha256: "c".repeat(64),
    }),
  };
  await context.delivery.stage(
    selected.id,
    {
      key: "minecraft-preservation-1",
      status: "running",
      operationId,
      message: "Receipt recorded; completion not observed",
      evidence: [backup],
    },
    testExecutor,
  );
  await expect(
    context.delivery.finish(
      selected.id,
      { ...finish, evidence: [...finish.evidence, backup] },
      testExecutor,
    ),
  ).rejects.toThrow("preservation evidence");
  await context.delivery.stage(
    selected.id,
    {
      key: "minecraft-preservation-1",
      status: "succeeded",
      operationId,
      message: "Independent native preservation observed",
      evidence: [backup],
    },
    testExecutor,
  );
  expect(
    await context.delivery.finish(selected.id, finish, testExecutor),
  ).toMatchObject({ status: "succeeded" });
});

test("a model recipe's verified-restore step records its preservation attempts append-only", async () => {
  const selected = await context.delivery.createDeployment(
    context.input(),
    testOperator,
  );
  await context.delivery.claim(selected.id, testExecutor);
  // The frozen recipe is a model kubernetes-application recipe whose
  // minecraft-upgrade step runs the v1 preservation controller.
  const recipe = recipeFromPipeline(policy);
  expect(recipe.kind).toBe("kubernetes-application");
  expect(minecraftUpgradeOf(recipe)).toMatchObject({
    releaseMode: "verified-restore",
  });
  await context.cluster.database.pipeline.create({
    data: { id: "minecraft/model-upgrade", definition: recipe },
  });
  await context.cluster.database.deployment.update({
    where: { id: selected.id },
    data: { pipelineRevisionId: "minecraft/model-upgrade" },
  });
  const operationId = specializedOperationId(
    `${selected.id}:minecraft-preservation`,
  );
  const receipt = (character: string) => ({
    kind: "backup" as const,
    operationId,
    summary: JSON.stringify({
      producer: "storm-independent-restore",
      receiptSha256: `sha256:${character.repeat(64)}`,
    }),
  });
  await context.delivery.stage(
    selected.id,
    {
      key: "minecraft-preservation-1",
      status: "running",
      operationId,
      message: "Awaiting the exact preservation controller incarnation",
      evidence: [receipt("a")],
    },
    testExecutor,
  );
  await context.delivery.stage(
    selected.id,
    {
      key: "minecraft-preservation-1",
      status: "succeeded",
      operationId,
      message: "Independent native preservation observed",
      evidence: [receipt("b")],
    },
    testExecutor,
  );
  // Append-only: both receipts stay; a rewrite would have been refused.
  expect(
    await context.cluster.database.evidence.count({
      where: { deploymentId: selected.id, kind: "backup" },
    }),
  ).toBe(2);
});
