import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import {
  arcadeRegistration,
  publishCiRunner,
  requestOnProd,
} from "#testing/model-fixture.ts";
import { deliveryMetrics } from "#server/metrics.ts";
import { createTestApp } from "#testing/http-app.ts";

const context = useDeliveryFixture({ registration: arcadeRegistration });
const reason = "The deployment ended without needing this recovery";

/**
 * A recovery-required arcade/prod deployment with a pending `argo` intent,
 * as delivery/prod, landing-pages/prod and seaweedfs/prod were left on
 * 2026-11-01 before their deployments stopped needing recovery.
 */
async function pendingIntent() {
  await publishCiRunner(context.delivery);
  const deployment = await requestOnProd(context, "deploy");
  await context.delivery.claim(deployment.id, testExecutor);
  await context.delivery.stage(
    deployment.id,
    {
      key: "step-sync",
      status: "running",
      operationId: crypto.randomUUID(),
      message: "Submitted the exact owned sync",
      evidence: [],
    },
    testExecutor,
  );
  await context.delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "External operation may still be active",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const detail = await context.delivery.detail(deployment.id);
  const intent = await context.delivery.requestRecoveryIntent(
    deployment.id,
    {
      requestId: crypto.randomUUID(),
      reason: "Inspect the recorded sync before settling ownership",
      expectedGeneration: detail.environment.generation,
    },
    testOperator,
  );
  return { deploymentId: deployment.id, intentId: intent.id };
}

/** The deployment stops needing recovery outside this intent. */
async function resolvedElsewhere(deploymentId: string) {
  await context.cluster.database.deployment.update({
    where: { id: deploymentId },
    data: { recoveryRequired: false },
  });
}

async function pendingObservations() {
  const metrics = await deliveryMetrics(context.cluster.database);
  return /^delivery_independent_recoveries_pending (\d+)$/mu.exec(metrics)?.[1];
}

const abandon = (intentId: string, why = reason) =>
  context.delivery.abandonRecoveryIntent(intentId, why, testOperator);

test("a deployment that still needs recovery keeps its intent", async () => {
  const { intentId } = await pendingIntent();
  await expect(abandon(intentId)).rejects.toThrow(
    "The deployment still needs this recovery",
  );
});

test("a stale intent closes as failed, releases nothing, and stops counting as pending", async () => {
  const { deploymentId, intentId } = await pendingIntent();
  await resolvedElsewhere(deploymentId);
  expect(await pendingObservations()).toBe("1");
  const before = await context.cluster.database.deployment.findUniqueOrThrow({
    where: { id: deploymentId },
  });

  const closed = await abandon(intentId);
  expect(closed).toMatchObject({ id: intentId, outcome: "failed" });
  expect(await pendingObservations()).toBe("0");
  expect(
    await context.cluster.database.deployment.findUniqueOrThrow({
      where: { id: deploymentId },
    }),
  ).toEqual(before);
  expect(
    await context.cluster.database.audit.findFirst({
      where: {
        action: "deployment.recovery_intent_abandoned",
        requestId: intentId,
      },
    }),
  ).not.toBeNull();

  // The same request repeats; a different one cannot rewrite the result.
  await expect(abandon(intentId)).resolves.toMatchObject({ outcome: "failed" });
  await expect(
    abandon(intentId, "A different reason for the same closed intent"),
  ).rejects.toThrow("already settled");
});

test("an intent holding an unrestored producer barrier stays open", async () => {
  const { deploymentId, intentId } = await pendingIntent();
  await resolvedElsewhere(deploymentId);
  await context.cluster.database.recoveryIntent.update({
    where: { id: intentId },
    data: { barrier: { producer: "static-site" }, barrierRestoredAt: null },
  });
  await expect(abandon(intentId)).rejects.toThrow(
    "unrestored producer barrier",
  );
});

test("an intent a recovery Workflow owns stays open", async () => {
  const { deploymentId, intentId } = await pendingIntent();
  await resolvedElsewhere(deploymentId);
  await context.cluster.database.recoveryIntent.update({
    where: { id: intentId },
    data: { workflowId: `delivery-recovery/${intentId}` },
  });
  await expect(abandon(intentId)).rejects.toThrow("A recovery Workflow owns");
});

test("only an administrator abandons an intent", async () => {
  const { deploymentId, intentId } = await pendingIntent();
  await resolvedElsewhere(deploymentId);
  await expect(
    context.delivery.abandonRecoveryIntent(intentId, reason, testExecutor),
  ).rejects.toThrow();
  expect(
    await context.cluster.database.recoveryIntent.findUniqueOrThrow({
      where: { id: intentId },
    }),
  ).toMatchObject({ status: "pending" });
});

const adminToken = "fixture-admin-credential-32-characters";

/** The real API with writes paused, as the ownership handover runs it. */
function pausedApi() {
  return createTestApp(context.delivery, {
    machineCredentials: [
      {
        token: adminToken,
        principal: {
          id: "fixture-admin",
          kind: "machine",
          scopes: ["read", "admin"],
        },
      },
    ],
    writesEnabled: async () => false,
    enabledEnvironments: async () => [],
  });
}

test("an administrator lists and closes a stale intent while writes are paused", async () => {
  const { deploymentId, intentId } = await pendingIntent();
  await resolvedElsewhere(deploymentId);
  const api = pausedApi();
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    "Content-Type": "application/json",
  };

  const pending = await api.request("/api/v1/recovery-intents?status=pending", {
    headers,
  });
  expect(pending.status).toBe(200);
  expect(await pending.json()).toMatchObject({
    intents: [{ id: intentId, outcome: "pending" }],
  });

  const closed = await api.request(
    `/api/v1/recovery-intents/${encodeURIComponent(intentId)}/abandon`,
    { method: "POST", headers, body: JSON.stringify({ reason }) },
  );
  expect(closed.status).toBe(200);
  expect(await closed.json()).toMatchObject({
    id: intentId,
    outcome: "failed",
  });

  const after = await api.request("/api/v1/recovery-intents?status=pending", {
    headers,
  });
  expect(await after.json()).toEqual({ intents: [] });
});

test("the intent list names its one supported filter", async () => {
  const response = await pausedApi().request("/api/v1/recovery-intents", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(response.status).toBe(400);
});
