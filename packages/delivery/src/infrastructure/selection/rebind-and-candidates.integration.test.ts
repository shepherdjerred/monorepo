import { describe, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { publishVerifiedSet } from "#testing/published-set.ts";
import { registerTestService } from "#testing/services.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { rollbackCandidates } from "./candidates.ts";

const context = useDeliveryFixture();

async function settleAccepted(
  deploymentId: string,
  observedRevisionId: string,
) {
  await context.delivery.claim(deploymentId, testExecutor);
  return context.delivery.finish(
    deploymentId,
    {
      status: "succeeded",
      message: "Settled acceptance",
      observedRevisionId,
      recoveryRequired: false,
      evidence: [
        { kind: "reconciliation", summary: "operation reconciled" },
        { kind: "acceptance", summary: "probes healthy" },
      ],
    },
    testExecutor,
  );
}

async function seedAcceptedFixtureBaseline() {
  const env = await context.cluster.database.environment.findUniqueOrThrow({
    where: { id: context.fixture.environment.id },
  });
  const created = await context.delivery.createDeployment(
    {
      requestId: `baseline/${crypto.randomUUID()}`,
      environmentId: env.id,
      versionSetRevisionId: context.fixture.versionSet.id,
      expectedGeneration: env.generation,
      kind: "deploy",
    },
    testOperator,
  );
  await settleAccepted(created.id, context.fixture.versionSet.id);
  return created;
}

async function bindDeclaredConfig(
  configId: string,
  values: Record<string, string>,
) {
  await context.cluster.database.configuration.create({
    data: { id: configId, content: values, forwardOnly: [] },
  });
  await context.cluster.database.environment.update({
    where: { id: context.fixture.environment.id },
    data: { declaredConfigurationId: configId },
  });
}

test("a brand-new service waits for argocd/prod to accept its declared configuration without stalling already-accepted services (AI-906)", async () => {
  const db = context.cluster.database;
  await registerTestService(db, "argocd");
  await db.pipeline.create({
    data: { id: "argocd/1", definition: { kind: "manual", reason: "fixture" } },
  });
  await db.configuration.createMany({
    data: [
      { id: "argocd/prod/1", content: { rbac: "arcade" } },
      { id: "argocd/prod/2", content: { rbac: "arcade,storm-stats" } },
    ],
  });
  await db.environment.create({
    data: {
      id: "argocd/prod",
      serviceId: "argocd",
      name: "prod",
      application: "argocd",
      pipelineRevisionId: "argocd/1",
      declaredConfigurationId: "argocd/prod/1",
    },
  });
  const { set: argoSet } = await publishVerifiedSet(context, {
    serviceId: "argocd",
    pipelineNumber: 99,
    sourceRevision: "9".repeat(40),
    artifacts: [
      {
        id: "argocd/chart/1",
        component: "chart:argocd",
        kind: "chart",
        uri: context.fixture.versionSet.components["chart"]!.uri,
        version: "1.0.0",
        digest: `sha256:${"9".repeat(64)}`,
      },
    ],
  });
  const argoInitial = await context.delivery.createDeployment(
    {
      requestId: "argocd/accept/1",
      environmentId: "argocd/prod",
      versionSetRevisionId: argoSet.id,
      expectedGeneration: 0,
      kind: "deploy",
    },
    testOperator,
  );
  await settleAccepted(argoInitial.id, argoSet.id);
  await seedAcceptedFixtureBaseline();
  await db.environment.update({
    where: { id: "argocd/prod" },
    data: { declaredConfigurationId: "argocd/prod/2" },
  });
  await db.environment.create({
    data: {
      id: "arcade/new-env",
      serviceId: "arcade",
      name: "new-env",
      application: "arcade-new",
      pipelineRevisionId: "arcade/1",
      declaredConfigurationId: "config/1",
    },
  });
  await db.prerequisiteEdge.createMany({
    data: [
      {
        dependentId: "arcade/prod",
        prerequisiteId: "argocd/prod",
        rule: "any-accepted",
      },
      {
        dependentId: "arcade/new-env",
        prerequisiteId: "argocd/prod",
        rule: "any-accepted",
      },
    ],
  });

  const newEnvDeploy = await context.delivery.createDeployment(
    {
      requestId: "new-env/first-deploy",
      environmentId: "arcade/new-env",
      versionSetRevisionId: context.fixture.versionSet.id,
      expectedGeneration: 0,
      kind: "deploy",
    },
    testOperator,
  );
  await expect(
    context.delivery.claim(newEnvDeploy.id, testExecutor),
  ).rejects.toMatchObject({
    code: "BUSY",
    message: expect.stringMatching(
      /Waiting for argocd\/prod to accept its declared configuration argocd\/prod\/2/u,
    ),
  });

  // Already-accepted arcade/prod is not blocked by argocd/prod's pending rebind.
  const existingEnv = await db.environment.findUniqueOrThrow({
    where: { id: context.fixture.environment.id },
  });
  const existingDeploy = await context.delivery.createDeployment(
    {
      requestId: "arcade/existing-deploy",
      environmentId: existingEnv.id,
      versionSetRevisionId: context.fixture.versionSet.id,
      expectedGeneration: existingEnv.generation,
      kind: "deploy",
    },
    testOperator,
  );
  await settleAccepted(existingDeploy.id, context.fixture.versionSet.id);

  const argoEnv = await db.environment.findUniqueOrThrow({
    where: { id: "argocd/prod" },
  });
  const argoRebind = await context.delivery.createDeployment(
    {
      requestId: "argocd/rebind/2",
      environmentId: "argocd/prod",
      expectedGeneration: argoEnv.generation,
      kind: "rebind",
      configurationRevisionId: "argocd/prod/2",
    },
    testOperator,
  );
  await settleAccepted(argoRebind.id, argoSet.id);
  await expect(
    context.delivery.claim(newEnvDeploy.id, testExecutor),
  ).resolves.toMatchObject({ deployment: { status: "running" } });
});

describe("automatic rebind and legacy rollback candidates (AI-454, AI-432)", () => {
  test("an automatic environment requests a rebind when its declared binding moves and skips retrying a failed rebind", async () => {
    const db = context.cluster.database;
    const baseline = await seedAcceptedFixtureBaseline();
    const envId = context.fixture.environment.id;
    const tick = async () => {
      const reconciled = await context.delivery.reconcile(
        [envId],
        testExecutor,
      );
      return reconciled.deployments;
    };
    const rowById = (id: string) =>
      db.deployment.findUniqueOrThrow({ where: { id } });

    await db.environment.update({
      where: { id: envId },
      data: { automatic: true, catalogRevision: "cat-1" },
    });
    expect(await tick()).toEqual([]);

    await bindDeclaredConfig("config/2", { replicas: "3" });
    await db.environment.update({
      where: { id: envId },
      data: { catalogRevision: "cat-2" },
    });
    const [firstRebindId = ""] = await tick();
    expect(await rowById(firstRebindId)).toMatchObject({
      kind: "rebind",
      automatic: true,
      status: "queued",
      versionSetRevisionId: context.fixture.versionSet.id,
      pipelineRevisionId: baseline.pipelineRevisionId,
      configurationId: "config/2",
    });
    expect(await tick()).toEqual([]);

    await bindDeclaredConfig("config/3", { replicas: "4" });
    const [secondRebindId = ""] = await tick();
    expect(await rowById(firstRebindId)).toMatchObject({ status: "canceled" });
    expect(await rowById(secondRebindId)).toMatchObject({
      kind: "rebind",
      configurationId: "config/3",
    });

    await context.delivery.claim(secondRebindId, testExecutor);
    await context.delivery.finish(
      secondRebindId,
      {
        status: "failed",
        message: "Plan failed",
        recoveryRequired: false,
        evidence: [],
      },
      testExecutor,
    );
    expect(await tick()).toEqual([]);

    const recipe = await db.pipeline.findUniqueOrThrow({
      where: { id: baseline.pipelineRevisionId },
    });
    await db.pipeline.create({
      data: { id: "arcade/2", definition: recipe.definition ?? {} },
    });
    await db.environment.update({
      where: { id: envId },
      data: { pipelineRevisionId: "arcade/2", catalogRevision: "cat-3" },
    });
    const [thirdRebindId = ""] = await tick();
    expect(await rowById(thirdRebindId)).toMatchObject({
      kind: "rebind",
      pipelineRevisionId: "arcade/2",
      configurationId: "config/3",
    });
    await settleAccepted(thirdRebindId, context.fixture.versionSet.id);

    const afterRebind = await db.environment.findUniqueOrThrow({
      where: { id: envId },
    });
    const rolledBack = await context.delivery.createDeployment(
      {
        requestId: "rollback-after-rebind",
        environmentId: envId,
        expectedGeneration: afterRebind.generation,
        kind: "rollback",
        selectionDeploymentId: baseline.id,
      },
      testOperator,
    );
    await settleAccepted(rolledBack.id, context.fixture.versionSet.id);
    expect(await tick()).toEqual([]);

    await bindDeclaredConfig("config/4", { replicas: "5" });
    await db.environment.update({
      where: { id: envId },
      data: { catalogRevision: "cat-4" },
    });
    const [fourthRebindId = ""] = await tick();
    expect(await rowById(fourthRebindId)).toMatchObject({
      kind: "rebind",
      pipelineRevisionId: "arcade/2",
      configurationId: "config/4",
    });
  });

  test("rollbackCandidates omits pre-cutover unselected and non-revisioned rows while preserving pointOfNoReturn exclusions", async () => {
    const db = context.cluster.database;
    const envId = context.fixture.environment.id;
    const v2First = await seedAcceptedFixtureBaseline();
    const sourceBuild = await db.build.findFirstOrThrow();
    await db.pipeline.createMany({
      data: [
        {
          id: "arcade/legacy-v1",
          definition: {
            kind: "argocd",
            application: "arcade",
            chartRepository: "https://chartmuseum.tailnet-1a49.ts.net",
            chartName: "arcade",
            chartComponent: "chart:arcade",
            parameters: {},
            artifactParameters: {},
            minecraftUpgrade: {
              imageComponent: "image:the-storm-server",
              releaseMode: "retained-volume-restart",
              runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
            },
          },
        },
        {
          id: "platform/tofu:tailscale/1",
          definition: {
            kind: "tofu",
            stack: "tailscale",
            runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
          },
        },
      ],
    });
    const seedRow = (
      id: string,
      kind: string,
      pipelineRevisionId: string,
      offsetMs: number,
    ) => ({
      id,
      requestId: `legacy/${id}`,
      environmentId: envId,
      serviceId: "arcade",
      versionSetRevisionId: context.fixture.versionSet.id,
      pipelineRevisionId,
      configurationId: "config/1",
      catalogRevision: "v1-backfill",
      expectedGeneration: 0,
      kind,
      status: "succeeded",
      requestedBy: testOperator.id,
      finishedAt: new Date(Date.now() + offsetMs),
      ...(kind === "tofu-apply"
        ? {
            platformSnapshot: { kind: "tofu", stack: "tailscale" },
            platformSourceBuildId: sourceBuild.id,
          }
        : {}),
    });
    await db.deployment.createMany({
      data: [
        seedRow(
          "legacy-tofu-apply",
          "tofu-apply",
          "platform/tofu:tailscale/1",
          1000,
        ),
        seedRow("legacy-unrevisioned-ponr", "deploy", "arcade/legacy-v1", 2000),
      ],
    });
    await bindDeclaredConfig("config/2", { replicas: "2" });
    const envBeforeRebind = await db.environment.findUniqueOrThrow({
      where: { id: envId },
    });
    const v2Latest = await context.delivery.createDeployment(
      {
        requestId: `rebind/${crypto.randomUUID()}`,
        environmentId: envId,
        expectedGeneration: envBeforeRebind.generation,
        kind: "rebind",
        configurationRevisionId: "config/2",
      },
      testOperator,
    );
    await settleAccepted(v2Latest.id, context.fixture.versionSet.id);
    await db.deployment.update({
      where: { id: v2Latest.id },
      data: { finishedAt: new Date(Date.now() + 3000) },
    });

    const candidates = await rollbackCandidates(db, envId);
    expect(
      candidates.map((c) => [c.deploymentId, c.eligible, c.reason]),
    ).toEqual([
      [v2Latest.id, true, null],
      [
        v2First.id,
        false,
        "deployment legacy-unrevisioned-ponr crossed point of no return minecraft-upgrade",
      ],
    ]);
  });
});
