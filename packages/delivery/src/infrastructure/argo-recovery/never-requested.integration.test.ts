import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import { seedDelivery, testExecutor, testOperator } from "#testing/seed.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createRecoveryInspector } from "#infrastructure/recovery.ts";
import {
  arcadeRegistration,
  publishCiRunner,
  selectArcadeModelRecipe,
} from "#testing/model-fixture.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import type { DeploymentDetail } from "#shared/contract.ts";

const priorRequestId = "91078308-225c-4449-80f6-cc64a7b6e894";
const priorOperationId = "6b1c507d-fa26-4e72-9918-cd66d7f664db";
const reason =
  "Settled automatically by independent Application readback of the finished operation";
const syncedSource = {
  chart: "arcade",
  repoURL: "https://charts.tailnet-1a49.ts.net",
  targetRevision: "0.9.0",
};

/** The Application after apply-safety wrote `source` and a pre-sync guard refused (AI-884). */
function refusedApplication(
  source: Record<string, string>,
  overrides: {
    finishedAt?: string;
    requestId?: string;
    operation?: unknown;
  } = {},
) {
  return {
    metadata: {
      name: "arcade",
      resourceVersion: "329899130",
      annotations: {
        "delivery.shepherdjerred.com/environment": "arcade/prod",
      },
    },
    spec: { project: "workloads", source: { ...source } },
    operation: overrides.operation ?? null,
    status: {
      history: [{ id: 35, revision: "0.9.0", source: { ...syncedSource } }],
      operationState: {
        phase: "Succeeded" as const,
        finishedAt: overrides.finishedAt ?? "2026-11-19T05:23:17Z",
        operation: {
          info: [
            {
              name: "ci.sjer.red/request-id",
              value: overrides.requestId ?? priorRequestId,
            },
            { name: "ci.sjer.red/operation-id", value: priorOperationId },
          ],
        },
      },
      resources: [{ kind: "Deployment", health: { status: "Healthy" } }],
    },
  };
}

describe("independent Argo recovery of a sync whose request never reached an operation (AI-884)", () => {
  let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
  let delivery: Delivery;
  let refused: DeploymentDetail;
  let ownSource: Record<string, string>;

  beforeAll(async () => {
    cluster = await createTestDatabase();
    delivery = new Delivery(cluster.database);
    const fixture = await seedDelivery(delivery, arcadeRegistration);
    await publishCiRunner(delivery);
    const modelDefinition = await selectArcadeModelRecipe(
      cluster.database,
      fixture.environment.id,
    );
    if (modelDefinition.kind !== "kubernetes-application")
      throw new Error("Expected an Application recipe");
    const deployment = await delivery.createDeployment(
      {
        requestId: "refused-sync-guard/1",
        environmentId: fixture.environment.id,
        versionSetRevisionId: fixture.versionSet.id,
        expectedGeneration: 0,
        kind: "deploy",
      },
      testOperator,
    );
    await delivery.claim(deployment.id, testExecutor);
    const operationId = deliveryOperationId(deployment.id);
    for (const [key, status] of [
      ["step-apply-safety", "succeeded"],
      ["step-sync", "running"],
    ] as const)
      await delivery.stage(
        deployment.id,
        {
          key,
          status,
          operationId,
          message: `${key}: ${status}`,
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
    refused = await delivery.detail(deployment.id);
    const selected =
      refused.versionSet.components[modelDefinition.chartComponent]?.version;
    if (selected === undefined) throw new Error("Expected the selected chart");
    ownSource = { ...syncedSource, targetRevision: selected };
  }, 60_000);

  afterAll(async () => {
    await cluster.close();
  });

  test("refuses a last operation that finished after the sync stage started", async () => {
    const inspect = createRecoveryInspector({
      readApplication: async () =>
        refusedApplication(ownSource, { finishedAt: "2099-01-01T00:00:00Z" }),
    });
    await expect(inspect(refused, { reason })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("finished after sync stage"),
    });
  });

  test("refuses a spec.source that is neither history nor this deployment's selected chart", async () => {
    const inspect = createRecoveryInspector({
      readApplication: async () =>
        refusedApplication({ ...syncedSource, targetRevision: "9.9.9" }),
    });
    await expect(inspect(refused, { reason })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("neither history"),
    });
  });

  test("refuses while an operation is pending on the Application", async () => {
    const inspect = createRecoveryInspector({
      readApplication: async () =>
        refusedApplication(ownSource, { operation: { sync: {} } }),
    });
    await expect(inspect(refused, { reason })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  test("keeps the synced readback when the Application carries this deployment's request", async () => {
    const inspect = createRecoveryInspector({
      readApplication: async () =>
        refusedApplication(ownSource, {
          requestId: deliveryOperationId(refused.deployment.id),
        }),
    });
    const evidence = await inspect(refused, { reason });
    expect(evidence[0]?.summary).not.toContain("never reached an operation");
  });

  test("auto-recovery settles a refused sync whose Application holds this deployment's own unsynced body", async () => {
    const inspect = createRecoveryInspector({
      readApplication: async () => refusedApplication(ownSource),
    });
    const opened = await delivery.openAutomaticRecoveryIntents();
    expect(opened.opened).toEqual([`argo/auto-${refused.deployment.id}`]);
    const settled = await delivery.settleAutomaticArgoIntents(inspect);
    expect(settled).toEqual([`argo/auto-${refused.deployment.id}`]);
    const recovered = await delivery.detail(refused.deployment.id);
    expect(recovered.deployment).toMatchObject({
      status: "failed",
      recoveryRequired: false,
    });
    expect(recovered.environment.activeDeploymentId).toBeNull();
    expect(
      recovered.evidence.some(
        (entry) =>
          entry.operationId === priorOperationId &&
          entry.summary.includes("never reached an operation") &&
          entry.summary.includes("own unsynced apply-safety body"),
      ),
    ).toBe(true);
  });
});
