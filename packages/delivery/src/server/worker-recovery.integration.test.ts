import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { freshWorkerProof, workerFixture } from "#testing/worker-fixture.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { createApp } from "./app.ts";
import { createDeliveryClient } from "#shared/client.ts";
import type { CompleteWorkerRecovery, Principal } from "#shared/contract.ts";

const context = useDeliveryFixture();
const admin: Principal = {
  id: "recovery-admin",
  kind: "machine",
  scopes: ["read", "admin"],
};
async function responseStatus(pending: Promise<Response> | Response) {
  const response = await pending;
  return response.status;
}

async function failedWorker() {
  const workers = await workerFixture(context.delivery);
  const baseline = await workers.acceptedPool();
  const deployment = await context.delivery.retireWorker(
    baseline.workerA.id,
    {
      requestId: "retire/ambiguous",
      expectedEnvironmentGeneration: baseline.env.generation,
      expectedWorkerGeneration: baseline.workerA.generation,
    },
    testOperator,
  );
  await context.delivery.claim(
    deployment.id,
    testExecutor,
    freshWorkerProof(baseline.workerA, baseline.workerB.buildId),
  );
  await context.delivery.stage(
    deployment.id,
    {
      key: "reconcile",
      status: "running",
      operationId: "recorded-operation",
      message: "Response lost after owned effect",
      evidence: [],
    },
    testExecutor,
  );
  await context.delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "Original ambiguous failure must remain immutable",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const pool = await context.delivery.workers(
    workers.environmentId,
    testOperator,
  );
  const before = await context.cluster.database.deployment.findUniqueOrThrow({
    where: { id: deployment.id },
  });
  return { workers, baseline, deployment, pool, before };
}
function api() {
  const app = createApp({
    delivery: context.delivery,
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    peerAddress: () => null,
    qualifyBuild: async () => "verified",
    config: {
      publicOrigin: "http://delivery.test",
      writesEnabled: async () => false,
      enabledEnvironments: async () => [],
      operatorLogins: async () => [],
      trustedProxyAddresses: async () => [],
      machineCredentials: [
        { token: "recovery-fixture-admin", principal: admin },
        { token: "recovery-fixture-executor", principal: testExecutor },
      ],
    },
  });
  const client = createDeliveryClient({
    baseUrl: "http://delivery.test",
    headers: { Authorization: "Bearer recovery-fixture-admin" },
    fetch: async (url, init) => app.request(url, init),
  });
  function post(path: string, body: unknown, executor = true) {
    return app.request(`/api/v1${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer recovery-fixture-${executor ? "executor" : "admin"}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }
  return { app, client, post };
}

test("independent recovery works through authenticated HTTP while workflows/writes are unavailable and preserves failed result", async () => {
  const { baseline, deployment, pool, before } = await failedWorker();
  const { client, post } = api();
  const input = {
    requestId: "independent-recovery",
    expectedEnvironmentGeneration: pool.generation,
    reason:
      "Inspect exact quarantined operation independently of the Workflow worker",
  };
  const intent = await client.requestWorkerRecovery(deployment.id, input);
  expect(await client.requestWorkerRecovery(deployment.id, input)).toEqual(
    intent,
  );
  const current = await client.workerRecovery(intent.id);
  expect(current.pool).toEqual(pool);
  expect(current.deployment.deployment.status).toBe("failed");
  const observation: CompleteWorkerRecovery = {
    expectedEnvironmentGeneration: intent.expectedEnvironmentGeneration,
    snapshotFingerprint: intent.snapshotFingerprint,
    poolFingerprint: intent.poolFingerprint,
    observedAt: new Date().toISOString(),
    routes: baseline.workerB.host.routes.map((route) => ({
      ...route,
      currentBuildId: baseline.workerB.buildId,
      rampingBuildId: null,
      routingConflictToken: "independently-observed-token",
    })),
    evidence: [
      {
        kind: "reconciliation",
        operationId: "recorded-operation",
        summary:
          "Independent observer fixture: exact operation finished and all bounded Jobs terminal",
      },
      {
        kind: "runtime",
        summary:
          "Independent observer fixture: exact retained hosts and stable routing read back",
      },
    ],
  };
  expect(
    await responseStatus(
      post(`/worker-recovery/${intent.id}/complete`, observation, false),
    ),
  ).toBe(403);
  expect(
    await responseStatus(
      post(`/worker-recovery/${intent.id}/submitted`, {
        workflowId: "unrelated-workflow",
      }),
    ),
  ).toBe(409);
  expect(
    await responseStatus(
      post(`/worker-recovery/${intent.id}/complete`, {
        ...observation,
        observedAt: new Date(Date.now() - 120_000).toISOString(),
      }),
    ),
  ).toBe(409);
  expect(
    await responseStatus(
      post(`/worker-recovery/${intent.id}/complete`, {
        ...observation,
        routes: observation.routes.slice(0, 1),
      }),
    ),
  ).toBe(409);
  const settled = await post(
    `/worker-recovery/${intent.id}/complete`,
    observation,
  );
  expect(settled.status).toBe(200);
  expect(
    await responseStatus(
      post(`/worker-recovery/${intent.id}/complete`, observation),
    ),
  ).toBe(200);
  expect(
    await responseStatus(
      post(`/worker-recovery/${intent.id}/complete`, {
        ...observation,
        observedAt: new Date(Date.now() + 1).toISOString(),
      }),
    ),
  ).toBe(409);
  const after = await context.cluster.database.deployment.findUniqueOrThrow({
    where: { id: deployment.id },
  });
  expect(after).toMatchObject({
    status: before.status,
    message: before.message,
    resultFingerprint: before.resultFingerprint,
    workerSnapshot: before.workerSnapshot,
    recoveryRequired: false,
  });
  expect(
    await context.delivery.workers(pool.environmentId, testOperator),
  ).toEqual(pool);
  expect(await context.cluster.database.applicationLock.count()).toBe(0);
  const env = await context.cluster.database.environment.findUniqueOrThrow({
    where: { id: pool.environmentId },
  });
  expect(env.acceptedVersionSetRevisionId).toBe(baseline.b.version.id);
  expect(env.activeDeploymentId).toBeNull();
});

test("pool CAS and immutable recovery failures keep original quarantine intact", async () => {
  const { baseline, deployment, pool } = await failedWorker();
  const intent = await context.delivery.requestWorkerRecovery(
    deployment.id,
    {
      requestId: "recovery/cas",
      expectedEnvironmentGeneration: pool.generation,
      reason:
        "Independently inspect exact original immutable worker identities",
    },
    admin,
  );
  await expect(
    context.delivery.requestWorkerRecovery(
      deployment.id,
      {
        requestId: "recovery/concurrent",
        expectedEnvironmentGeneration: pool.generation,
        reason: "A second inspection must not race an existing intent",
      },
      admin,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await context.cluster.database.workerVersion.update({
    where: { id: baseline.workerA.id },
    data: { generation: { increment: 1 } },
  });
  await expect(
    context.delivery.completeWorkerRecovery(
      intent.id,
      {
        expectedEnvironmentGeneration: intent.expectedEnvironmentGeneration,
        snapshotFingerprint: intent.snapshotFingerprint,
        poolFingerprint: intent.poolFingerprint,
        observedAt: new Date().toISOString(),
        routes: baseline.workerB.host.routes.map((route) => ({
          ...route,
          currentBuildId: baseline.workerB.buildId,
          rampingBuildId: null,
          routingConflictToken: "token",
        })),
        evidence: [
          {
            kind: "reconciliation",
            operationId: "recorded-operation",
            summary: "Read-only boundary fixture",
          },
          { kind: "runtime", summary: "Read-only host fixture" },
        ],
      },
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await context.delivery.failWorkerRecovery(
    intent.id,
    "Independent host/route proof unavailable; quarantine retained",
    testExecutor,
  );
  await context.delivery.failWorkerRecovery(
    intent.id,
    "Independent host/route proof unavailable; quarantine retained",
    testExecutor,
  );
  await expect(
    context.delivery.failWorkerRecovery(
      intent.id,
      "Different outcome",
      testExecutor,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await context.cluster.database.applicationLock.count()).toBe(1);
  const quarantined =
    await context.cluster.database.deployment.findUniqueOrThrow({
      where: { id: deployment.id },
    });
  expect(quarantined.recoveryRequired).toBe(true);
});
