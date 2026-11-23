import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import { seedDelivery, testExecutor, testOperator } from "#testing/seed.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createRecoveryInspector } from "#infrastructure/recovery.ts";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import {
  arcadePipeline,
  publishCiRunner,
  selectArcadeModelRecipe,
} from "#testing/model-fixture.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import type { DeploymentDetail } from "#shared/contract.ts";

const priorRequestId = "91078308-225c-4449-80f6-cc64a7b6e894";
const priorOperationId = "6b1c507d-fa26-4e72-9918-cd66d7f664db";
const reason =
  "Settled automatically by independent Application readback of the finished operation";

function priorSyncedApplication() {
  const source = {
    chart: "arcade",
    repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
    targetRevision: "2.0.0-1017374",
  };
  return {
    metadata: {
      name: "arcade",
      resourceVersion: "329899130",
      annotations: {
        "argocd.argoproj.io/hydrate": "hard",
        "argocd.argoproj.io/sync-options": "Prune=false",
        "ci.sjer.red/application-lifecycle": "retain",
        "delivery.shepherdjerred.com/environment": "arcade/prod",
      },
    },
    spec: {
      project: "workloads",
      destination: {
        namespace: "arcade",
        server: "https://kubernetes.default.svc",
      },
      source: structuredClone(source),
      syncPolicy: {
        automated: { enabled: true, prune: false, selfHeal: true },
        syncOptions: [
          "ApplyOutOfSyncOnly=true",
          "RespectIgnoreDifferences=true",
        ],
      },
    },
    operation: null,
    status: {
      history: [
        {
          id: 34,
          revision: "2.0.0-1014096",
          source: { ...source, targetRevision: "2.0.0-1014096" },
        },
        {
          id: 35,
          revision: "2.0.0-1017374",
          source: structuredClone(source),
        },
      ],
      operationState: {
        phase: "Succeeded" as const,
        finishedAt: "2026-11-19T05:23:17Z",
        operation: {
          info: [
            { name: "ci.sjer.red/request-id", value: priorRequestId },
            { name: "ci.sjer.red/operation-id", value: priorOperationId },
            { name: "ci.sjer.red/revision", value: "2.0.0-1017374" },
          ],
        },
      },
      resources: [
        { kind: "PersistentVolumeClaim" },
        { kind: "Deployment", health: { status: "Healthy" } },
        { kind: "NetworkPolicy" },
      ],
    },
  };
}

async function checkPlayerGatedRecovery(failedBeforeSync: DeploymentDetail) {
  const base = recipeFromPipeline(arcadePipeline);
  if (base.kind !== "kubernetes-application")
    throw new Error("Expected an Application recipe");
  const playerGated = RecipeDefinitionSchema.parse({
    ...base,
    steps: [
      { kind: "players-offline", instance: "application:arcade" },
      ...base.steps,
      {
        kind: "minecraft-upgrade",
        instance: "application:arcade",
        pointOfNoReturn: true,
        imageComponent: "image:arcade",
        releaseMode: "retained-volume-restart",
      },
    ],
    oracle: {
      ...base.oracle,
      tests: [{ suite: "smoke", resultPath: "packages/arcade/results.json" }],
    },
  });
  const stage = failedBeforeSync.stages[0];
  if (stage === undefined) throw new Error("Expected step-apply-safety");
  const playerGateStage = {
    ...stage,
    key: "step-players-offline",
    operationId: deliveryOperationId(
      `${failedBeforeSync.deployment.id}:players-offline`,
    ),
  };
  const inspectPrior = createRecoveryInspector({
    readApplication: async () => priorSyncedApplication(),
  });
  await expect(
    inspectPrior(
      { ...failedBeforeSync, stages: [playerGateStage, stage] },
      { reason },
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const gatedBeforeSync: DeploymentDetail = {
    ...failedBeforeSync,
    pipeline: { ...failedBeforeSync.pipeline, definition: playerGated },
    stages: [playerGateStage, stage],
  };
  expect(
    await inspectPrior(gatedBeforeSync, {
      operationId: priorOperationId,
      reason,
    }),
  ).toHaveLength(1);
  const ownRequestId = deliveryOperationId(failedBeforeSync.deployment.id);
  const ownOperationId = "77777777-7777-4777-8777-777777777777";
  const syncedApp = priorSyncedApplication();
  syncedApp.status.operationState.operation.info = [
    { name: "ci.sjer.red/request-id", value: ownRequestId },
    { name: "ci.sjer.red/operation-id", value: ownOperationId },
  ];
  const inspectSynced = createRecoveryInspector({
    readApplication: async () => syncedApp,
  });
  const gatedAfterSync: DeploymentDetail = {
    ...gatedBeforeSync,
    stages: [
      playerGateStage,
      { ...stage, status: "succeeded" },
      { ...stage, key: "step-sync", operationId: ownRequestId },
      { ...stage, key: "step-minecraft-upgrade" },
      { ...stage, key: "test-smoke" },
    ],
  };
  expect(
    await inspectSynced(gatedAfterSync, {
      operationId: ownOperationId,
      reason,
    }),
  ).toHaveLength(1);
}

describe("independent Argo recovery before step-sync", () => {
  let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
  let delivery: Delivery;
  let failedBeforeSync: DeploymentDetail;

  beforeAll(async () => {
    cluster = await createTestDatabase();
    delivery = new Delivery(cluster.database);
    const fixture = await seedDelivery(delivery);
    await publishCiRunner(delivery);
    await selectArcadeModelRecipe(cluster.database, fixture.environment.id);
    const deployment = await delivery.createDeployment(
      {
        requestId: "unsynced-apply-safety/1",
        environmentId: fixture.environment.id,
        versionSetRevisionId: fixture.versionSet.id,
        expectedGeneration: 0,
        kind: "deploy",
      },
      testOperator,
    );
    await delivery.claim(deployment.id, testExecutor);
    await delivery.stage(
      deployment.id,
      {
        key: "step-apply-safety",
        status: "running",
        operationId: deliveryOperationId(deployment.id),
        message: "step-apply-safety: running",
        evidence: [],
      },
      testExecutor,
    );
    await delivery.finish(
      deployment.id,
      {
        status: "failed",
        message:
          "External operation may still be active; inspect its recorded identity before releasing ownership",
        recoveryRequired: true,
        evidence: [],
      },
      testExecutor,
    );
    failedBeforeSync = await delivery.detail(deployment.id);
  }, 60_000);

  afterAll(async () => {
    await cluster.close();
  });

  test("refuses when writeBody left an unsynced candidate spec.source on the Application (AI-446)", async () => {
    const staleWritten = priorSyncedApplication();
    staleWritten.spec.source.targetRevision = "2.0.0-1017905";
    const inspect = createRecoveryInspector({
      readApplication: async () => staleWritten,
    });
    await expect(inspect(failedBeforeSync, { reason })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("unsynced spec.source"),
    });
  });

  test("refuses when the Application carries this deployment's own request without a recorded sync stage (I2)", async () => {
    const unrecordedSync = priorSyncedApplication();
    unrecordedSync.status.operationState.operation.info[0] = {
      name: "ci.sjer.red/request-id",
      value: deliveryOperationId(failedBeforeSync.deployment.id),
    };
    const inspect = createRecoveryInspector({
      readApplication: async () => unrecordedSync,
    });
    await expect(inspect(failedBeforeSync, { reason })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("without a recorded sync step"),
    });
  });

  test("refuses when an unexpected stage key is present or Application vanished after a prior release", async () => {
    const stage = failedBeforeSync.stages[0];
    if (stage === undefined) throw new Error("Expected step-apply-safety");
    const inspect = createRecoveryInspector({
      readApplication: async () => priorSyncedApplication(),
    });
    await expect(
      inspect(
        {
          ...failedBeforeSync,
          stages: [...failedBeforeSync.stages, { ...stage, key: "step-other" }],
        },
        { reason },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const missingReader = createRecoveryInspector({
      readApplication: async () => null,
    });
    await expect(
      missingReader(
        {
          ...failedBeforeSync,
          previousAcceptedVersionSet: failedBeforeSync.versionSet,
        },
        { reason },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("allows a declared players-offline gate before sync and preserves recovery once sync is recorded", async () => {
    await checkPlayerGatedRecovery(failedBeforeSync);
  });

  test("settles an absent Application before the environment's first accepted release", async () => {
    const inspect = createRecoveryInspector({
      readApplication: async () => null,
    });
    const evidence = await inspect(
      { ...failedBeforeSync, previousAcceptedVersionSet: null },
      { reason },
    );
    expect(evidence).toEqual([
      {
        kind: "reconciliation",
        operationId: deliveryOperationId(failedBeforeSync.deployment.id),
        summary: expect.stringContaining("absent before any accepted release"),
      },
    ]);
  });

  test("auto-recovery opens and settles an argo intent when writeBody failed before mutating spec.source (AI-423)", async () => {
    const inspect = createRecoveryInspector({
      readApplication: async () => priorSyncedApplication(),
    });
    expect(
      await inspect(failedBeforeSync, {
        operationId: priorOperationId,
        reason,
      }),
    ).toHaveLength(1);
    const opened = await delivery.openAutomaticRecoveryIntents();
    expect(opened.opened).toEqual([
      `argo/auto-${failedBeforeSync.deployment.id}`,
    ]);
    const settled = await delivery.settleAutomaticArgoIntents(inspect);
    expect(settled).toEqual([`argo/auto-${failedBeforeSync.deployment.id}`]);
    const recovered = await delivery.detail(failedBeforeSync.deployment.id);
    expect(recovered.deployment.recoveryRequired).toBe(false);
    expect(recovered.environment.activeDeploymentId).toBeNull();
    expect(
      recovered.evidence.some(
        (entry) =>
          entry.operationId === priorOperationId &&
          entry.summary.includes("spec.source matches history 35"),
      ),
    ).toBe(true);
  });
});
